import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPosArea, createPosTables } from '@/server/studio/actions/pos';
import { addPosLine, cancelPosLine, openPosOrder, requestPosBill, setPosInvoiceDiscount } from '@/server/studio/actions/pos-orders';
import { payPosOrder } from '@/server/studio/actions/pos-payments';
import { closePosShift, openPosShift } from '@/server/studio/actions/pos-shifts';
import { posOrder, posReceipt, posShift } from '@/server/studio/queries/pos';
import { ask, codeOf, dataOf, failureOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };
let cashier: Person;
let manager: Person;
let kitchen: Person;
let tableId: string;
let burger: string;

const names = (ar: string, en = ar) => ({ ar: { name: ar }, en: { name: en } });

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await resetWorld();
  a = await restaurant('Pay A');
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  kitchen = await person('kitchen', { staff: [a.id, 'KITCHEN'] });
  const menu = await prisma().menu.create({
    data: { restaurantId: a.id, name: 'm', slug: 'menu-a', currency: 'IQD', locales: ['ar', 'en'], defaultLocale: 'ar', timezone: 'Asia/Baghdad' },
  });
  await prisma().posSettings.upsert({ where: { restaurantId: a.id }, create: { restaurantId: a.id, catalogMenuId: menu.id }, update: { catalogMenuId: menu.id } });
  const category = await prisma().category.create({ data: { menuId: menu.id, slug: 'food', sortOrder: 1, translations: names('أكل', 'Food') } });
  burger = (await prisma().product.create({ data: { menuId: menu.id, categoryId: category.id, slug: 'burger', sortOrder: 1, basePrice: 5000, translations: names('برغر', 'Burger') } })).id;
  const areaId = dataOf(await run(manager, createPosArea, { name: 'Hall' })).areaId;
  await run(manager, createPosTables, { areaId, from: 1, to: 2 });
  tableId = (await prisma().posTable.findFirstOrThrow({ where: { restaurantId: a.id }, orderBy: { number: 'asc' } })).id;
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

/** An order of `quantity` burgers (5,000 each) at the table, ready to pay. */
async function orderOf(quantity: number, table = tableId) {
  const opened = dataOf(await run(cashier, openPosOrder, { tableId: table }));
  const added = dataOf(await run(cashier, addPosLine, { orderId: opened.orderId, productId: burger, quantity, note: '', optionIds: [], expectedVersion: opened.version }));
  return { orderId: opened.orderId, lineId: added.lineId, version: added.version };
}

const shift = async (who: Person = cashier) => dataOf(await run(who, openPosShift, { openingFloat: 10_000 })).shiftId;

describe('paying in cash', () => {
  it('takes exact cash with no change, and marks the order paid', async () => {
    await shift();
    const { orderId, version } = await orderOf(2);
    const paid = dataOf(await run(cashier, payPosOrder, { orderId, expectedVersion: version, expectedTotal: 10_000, amountReceived: 10_000 }));
    expect(paid).toMatchObject({ change: 0, total: 10_000 });
    expect(dataOf(await ask(cashier, posOrder, { orderId })).status).toBe('PAID');
  });

  it('gives change and stores the totals as they were', async () => {
    await shift();
    await prisma().posSettings.update({ where: { restaurantId: a.id }, data: { serviceRatePercent: 10, taxRatePercent: 5 } });
    const { orderId, version } = await orderOf(2);
    // 10,000 + 1,000 service + 550 tax.
    const paid = dataOf(await run(cashier, payPosOrder, { orderId, expectedVersion: version, expectedTotal: 11_550, amountReceived: 20_000 }));
    expect(paid.change).toBe(8_450);
    // Changing the rates afterwards leaves the receipt alone.
    await prisma().posSettings.update({ where: { restaurantId: a.id }, data: { serviceRatePercent: 0, taxRatePercent: 0 } });
    const receipt = dataOf(await ask(cashier, posReceipt, { orderId }));
    expect(receipt).toMatchObject({ amountReceived: 20_000, change: 8_450, orderNumber: 1, tableNumber: 1, cashierName: 'cashier person' });
    expect(receipt.snapshot).toMatchObject({ subtotal: 10_000, service: 1_000, tax: 550, total: 11_550, rates: { serviceRatePercent: 10, taxRatePercent: 5 } });
    expect(receipt.snapshot.lines).toHaveLength(1);
  });

  it('refuses short cash and takes nothing', async () => {
    await shift();
    const { orderId, version } = await orderOf(1);
    expect(failureOf(await run(cashier, payPosOrder, { orderId, expectedVersion: version, expectedTotal: 5_000, amountReceived: 4_999 }))).toMatchObject({ code: 'INVALID' });
    expect(await prisma().posPayment.count()).toBe(0);
  });

  it('needs an open shift', async () => {
    const { orderId, version } = await orderOf(1);
    expect(codeOf(await run(cashier, payPosOrder, { orderId, expectedVersion: version, expectedTotal: 5_000, amountReceived: 5_000 }))).toBe('CONFLICT');
  });

  it('writes exactly one payment when two people tap pay on the same version', async () => {
    await shift();
    await shift(manager);
    const { orderId, version } = await orderOf(1);
    const input = { orderId, expectedVersion: version, expectedTotal: 5_000, amountReceived: 5_000 };
    const results = await Promise.all([run(cashier, payPosOrder, input), run(manager, payPosOrder, input)]);
    expect(results.map(codeOf).sort()).toEqual(['CONFLICT', 'OK']);
    expect(await prisma().posPayment.count({ where: { orderId } })).toBe(1);
  });

  it('pays a free order (everything discounted) with nothing received', async () => {
    await shift();
    const { orderId, version } = await orderOf(1);
    const free = dataOf(await run(cashier, setPosInvoiceDiscount, { orderId, discount: { kind: 'PERCENT', value: 100 }, expectedVersion: version }));
    expect(dataOf(await run(cashier, payPosOrder, { orderId, expectedVersion: free.version, expectedTotal: 0, amountReceived: 0 })).total).toBe(0);
  });

  it('refuses a method other than cash', async () => {
    await shift();
    const { orderId, version } = await orderOf(1);
    expect(codeOf(await run(cashier, payPosOrder, { orderId, expectedVersion: version, expectedTotal: 5_000, amountReceived: 5_000, method: 'ZAINCASH' }))).toBe('INVALID');
  });

  it('refuses an empty order and one whose lines are all cancelled', async () => {
    await shift();
    const empty = dataOf(await run(cashier, openPosOrder, { tableId }));
    expect(codeOf(await run(cashier, payPosOrder, { orderId: empty.orderId, expectedVersion: empty.version, expectedTotal: 0, amountReceived: 0 }))).toBe('CONFLICT');
    const { orderId, lineId, version } = await orderOf(1, (await prisma().posTable.findFirstOrThrow({ where: { restaurantId: a.id, number: 2 } })).id);
    const cancelled = dataOf(await run(cashier, cancelPosLine, { lineId, reason: 'oops', expectedVersion: version }));
    expect(codeOf(await run(cashier, payPosOrder, { orderId, expectedVersion: cancelled.version, expectedTotal: 0, amountReceived: 0 }))).toBe('CONFLICT');
  });

  it('refuses a stale screen: a line added after it loaded, or a total that moved', async () => {
    await shift();
    const { orderId, version } = await orderOf(1);
    dataOf(await run(cashier, addPosLine, { orderId, productId: burger, quantity: 1, note: '', optionIds: [], expectedVersion: version }));
    expect(codeOf(await run(cashier, payPosOrder, { orderId, expectedVersion: version, expectedTotal: 5_000, amountReceived: 5_000 }))).toBe('CONFLICT');
    expect(codeOf(await run(cashier, payPosOrder, { orderId, expectedVersion: version + 1, expectedTotal: 5_000, amountReceived: 20_000 }))).toBe('CONFLICT');
    expect(await prisma().posPayment.count()).toBe(0);
  });

  it('pays after the bill was requested, and keeps the kitchen out', async () => {
    await shift();
    const { orderId, version } = await orderOf(1);
    const billed = dataOf(await run(cashier, requestPosBill, { orderId, expectedVersion: version }));
    expect(codeOf(await run(kitchen, payPosOrder, { orderId, expectedVersion: billed.version, expectedTotal: 5_000, amountReceived: 5_000 }))).toBe('FORBIDDEN');
    expect(codeOf(await run(cashier, payPosOrder, { orderId, expectedVersion: billed.version, expectedTotal: 5_000, amountReceived: 5_000 }))).toBe('OK');
  });

  it("feeds the shift's expected cash from the stored total, not from the cash handed over", async () => {
    const shiftId = await shift();
    const { orderId, version } = await orderOf(1);
    dataOf(await run(cashier, payPosOrder, { orderId, expectedVersion: version, expectedTotal: 5_000, amountReceived: 20_000 }));
    expect(dataOf(await ask(cashier, posShift, { shiftId })).expectedCash).toBe(15_000);
    expect(dataOf(await run(cashier, closePosShift, { shiftId, countedCash: 15_000, note: '' })).difference).toBe(0);
  });

  it('shows no receipt before payment, and audits the payment', async () => {
    await shift();
    const { orderId, version } = await orderOf(1);
    expect(codeOf(await ask(cashier, posReceipt, { orderId }) as never)).toBe('NOT_FOUND');
    dataOf(await run(cashier, payPosOrder, { orderId, expectedVersion: version, expectedTotal: 5_000, amountReceived: 5_000 }));
    const actions = (await prisma().auditLog.findMany({ where: { restaurantId: a.id }, select: { action: true } })).map((r) => r.action);
    expect(actions).toContain('pos.payment.take');
  });
});
