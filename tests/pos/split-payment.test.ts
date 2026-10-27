import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPosArea, createPosTables } from '@/server/studio/actions/pos';
import { addPosLine, cancelPosLine, openPosOrder, setPosInvoiceDiscount, updatePosLine } from '@/server/studio/actions/pos-orders';
import { payPosOrder } from '@/server/studio/actions/pos-payments';
import { openPosShift } from '@/server/studio/actions/pos-shifts';
import { posOrder } from '@/server/studio/queries/pos';
import { ask, codeOf, dataOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };
let cashier: Person;
let manager: Person;
let tableId: string;
let burger: string;

const names = (ar: string, en = ar) => ({ ar: { name: ar }, en: { name: en } });

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await resetWorld();
  a = await restaurant('Split A');
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  const menu = await prisma().menu.create({
    data: { restaurantId: a.id, name: 'm', slug: 'menu-a', currency: 'IQD', locales: ['ar', 'en'], defaultLocale: 'ar', timezone: 'Asia/Baghdad' },
  });
  await prisma().posSettings.upsert({
    where: { restaurantId: a.id },
    create: { restaurantId: a.id, requireApproval: false, catalogMenuId: menu.id, serviceRatePercent: 10, taxRatePercent: 5 },
    update: { requireApproval: false, catalogMenuId: menu.id, serviceRatePercent: 10, taxRatePercent: 5 },
  });
  const category = await prisma().category.create({ data: { menuId: menu.id, slug: 'food', sortOrder: 1, translations: names('أكل', 'Food') } });
  burger = (await prisma().product.create({ data: { menuId: menu.id, categoryId: category.id, slug: 'burger', sortOrder: 1, basePrice: 5000, translations: names('برغر', 'Burger') } })).id;
  const areaId = dataOf(await run(manager, createPosArea, { name: 'Hall' })).areaId;
  await run(manager, createPosTables, { areaId, from: 1, to: 1 });
  tableId = (await prisma().posTable.findFirstOrThrow({ where: { restaurantId: a.id } })).id;
  dataOf(await run(cashier, openPosShift, { openingFloat: 0 }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

/** Three burgers (5,000 each) as three lines, with a 10% invoice discount, 10% service and 5% tax on top. */
async function threeLines() {
  const opened = dataOf(await run(cashier, openPosOrder, { tableId }));
  let version = opened.version;
  const lineIds: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    const added = dataOf(await run(cashier, addPosLine, { orderId: opened.orderId, productId: burger, quantity: 1, note: '', optionIds: [], expectedVersion: version }));
    lineIds.push(added.lineId);
    version = added.version;
  }
  version = dataOf(await run(cashier, setPosInvoiceDiscount, { orderId: opened.orderId, discount: { kind: 'PERCENT', value: 10, reason: 'MANAGER_DECISION' }, expectedVersion: version })).version;
  return { orderId: opened.orderId, lineIds, version };
}

const view = async (orderId: string) => dataOf(await ask(cashier, posOrder, { orderId }));

describe('paying part of an order', () => {
  it('takes the chosen lines share, leaves the order open and marks those lines paid', async () => {
    const { orderId, lineIds } = await threeLines();
    const now = await view(orderId);
    const expected = await partTotalFor(orderId, 2);
    const paid = dataOf(await run(cashier, payPosOrder, { orderId, expectedVersion: now.version, expectedTotal: expected, lineIds: lineIds.slice(0, 2), amountReceived: 99_999 }));
    expect(paid.total).toBe(expected);
    expect(paid.total).toBeLessThan(now.totals.total);
    const after = await view(orderId);
    expect(after.status).toBe('OPEN');
    expect(after.lines.map((l) => l.paid)).toEqual([true, true, false]);
    expect(after.parts).toHaveLength(1);
  });

  it('marks the order PAID when the last lines are paid, and the parts add up to the whole bill exactly', async () => {
    const { orderId, lineIds } = await threeLines();
    const whole = (await view(orderId)).totals.total;
    const first = dataOf(await run(cashier, payPosOrder, { orderId, expectedVersion: (await view(orderId)).version, expectedTotal: await partTotalFor(orderId, 1), lineIds: [lineIds[0]!], amountReceived: 99_999 }));
    const second = dataOf(await run(cashier, payPosOrder, { orderId, expectedVersion: (await view(orderId)).version, expectedTotal: await partTotalFor(orderId, 1), lineIds: [lineIds[1]!], amountReceived: 99_999 }));
    expect((await view(orderId)).status).toBe('OPEN');
    const rest = (await view(orderId)).version;
    const last = dataOf(await run(cashier, payPosOrder, { orderId, expectedVersion: rest, expectedTotal: whole - first.total - second.total, amountReceived: 99_999 }));
    const final = await view(orderId);
    expect(final.status).toBe('PAID');
    expect(first.total + second.total + last.total).toBe(whole);
    expect(final.parts.map((p) => p.part)).toEqual([1, 2, 3]);
  });

  it('refuses a line that is already paid', async () => {
    const { orderId, lineIds } = await threeLines();
    dataOf(await run(cashier, payPosOrder, { orderId, expectedVersion: (await view(orderId)).version, expectedTotal: await partTotalFor(orderId, 1), lineIds: [lineIds[0]!], amountReceived: 99_999 }));
    const again = await run(cashier, payPosOrder, { orderId, expectedVersion: (await view(orderId)).version, expectedTotal: await partTotalFor(orderId, 1), lineIds: [lineIds[0]!], amountReceived: 99_999 });
    expect(codeOf(again)).toBe('CONFLICT');
    expect(await prisma().posPayment.count({ where: { orderId } })).toBe(1);
  });

  it('lets only one of two cashiers pay the same line at once', async () => {
    const { orderId, lineIds } = await threeLines();
    const version = (await view(orderId)).version;
    const total = await partTotalFor(orderId, 1);
    const other = await person('cashier2', { staff: [a.id, 'CASHIER'] });
    dataOf(await run(other, openPosShift, { openingFloat: 0 }));
    const results = await Promise.all([cashier, other].map((who) => run(who, payPosOrder, { orderId, expectedVersion: version, expectedTotal: total, lineIds: [lineIds[0]!], amountReceived: 99_999 })));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await prisma().posPayment.count({ where: { orderId } })).toBe(1);
  });

  it('refuses a cancelled line and a line that is not in the order', async () => {
    const { orderId, lineIds, version } = await threeLines();
    const cancelled = dataOf(await run(cashier, cancelPosLine, { lineId: lineIds[2]!, reason: 'oops', expectedVersion: version }));
    const refused = await run(cashier, payPosOrder, { orderId, expectedVersion: cancelled.version, expectedTotal: 1000, lineIds: [lineIds[2]!], amountReceived: 99_999 });
    expect(codeOf(refused)).toBe('CONFLICT');
    const stranger = await run(cashier, payPosOrder, { orderId, expectedVersion: cancelled.version, expectedTotal: 1000, lineIds: ['not-a-line-of-this-order'], amountReceived: 99_999 });
    expect(codeOf(stranger)).toBe('CONFLICT');
  });

  it('lets a line be added to a partly paid order, but not changed once paid', async () => {
    const { orderId, lineIds } = await threeLines();
    dataOf(await run(cashier, payPosOrder, { orderId, expectedVersion: (await view(orderId)).version, expectedTotal: await partTotalFor(orderId, 1), lineIds: [lineIds[0]!], amountReceived: 99_999 }));
    const added = dataOf(await run(cashier, addPosLine, { orderId, productId: burger, quantity: 1, note: '', optionIds: [], expectedVersion: (await view(orderId)).version }));
    expect((await view(orderId)).lines.find((l) => l.id === added.lineId)?.paid).toBe(false);
    const edit = await run(cashier, updatePosLine, { lineId: lineIds[0]!, quantity: 2, note: '', expectedVersion: (await view(orderId)).version });
    expect(codeOf(edit)).toBe('CONFLICT');
    const cancel = await run(cashier, cancelPosLine, { lineId: lineIds[0]!, reason: 'oops', expectedVersion: (await view(orderId)).version });
    expect(codeOf(cancel)).toBe('CONFLICT');
  });

  it('checks the expected total against the part, not the whole bill', async () => {
    const { orderId, lineIds } = await threeLines();
    const whole = (await view(orderId)).totals.total;
    const wrong = await run(cashier, payPosOrder, { orderId, expectedVersion: (await view(orderId)).version, expectedTotal: whole, lineIds: [lineIds[0]!], amountReceived: 99_999 });
    expect(codeOf(wrong)).toBe('CONFLICT');
  });
});

/** The total of `count` of the three equal lines, the way the server spreads the bill (the part of an unpaid share). */
async function partTotalFor(orderId: string, count: number) {
  const order = await view(orderId);
  const unpaid = order.lines.filter((l) => !l.cancelled && !l.paid).length;
  if (count === unpaid) return order.totals.total - order.parts.reduce((sum, p) => sum + p.total, 0);
  const { totals } = order;
  const share = count / order.lines.filter((l) => !l.cancelled).length;
  const discount = Math.round(totals.invoiceDiscount * share);
  const service = Math.round(totals.service * share);
  const tax = Math.round(totals.tax * share);
  return Math.round(totals.subtotal * share) - discount + service + tax;
}
