import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { baghdadDayOf } from '@/lib/baghdad';
import { createPosArea, createPosTables } from '@/server/studio/actions/pos';
import { addPosLine, openPosOrder } from '@/server/studio/actions/pos-orders';
import { payPosOrder, reversePosPayment } from '@/server/studio/actions/pos-payments';
import { openPosShift } from '@/server/studio/actions/pos-shifts';
import { posDailyReport, posOrder, posReceipt } from '@/server/studio/queries/pos';
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
  a = await restaurant('Split Reports');
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  const menu = await prisma().menu.create({
    data: { restaurantId: a.id, name: 'm', slug: 'menu-s', currency: 'IQD', locales: ['ar', 'en'], defaultLocale: 'ar', timezone: 'Asia/Baghdad' },
  });
  await prisma().posSettings.upsert({
    where: { restaurantId: a.id },
    create: { restaurantId: a.id, catalogMenuId: menu.id, enabledPaymentMethods: ['CASH', 'FIB'] },
    update: { catalogMenuId: menu.id, enabledPaymentMethods: ['CASH', 'FIB'] },
  });
  const category = await prisma().category.create({ data: { menuId: menu.id, slug: 'food', sortOrder: 1, translations: names('أكل', 'Food') } });
  burger = (await prisma().product.create({ data: { menuId: menu.id, categoryId: category.id, slug: 'burger', sortOrder: 1, basePrice: 5000, translations: names('برغر', 'Burger') } })).id;
  const areaId = dataOf(await run(manager, createPosArea, { name: 'Hall' })).areaId;
  await run(manager, createPosTables, { areaId, from: 1, to: 1 });
  tableId = (await prisma().posTable.findFirstOrThrow({ where: { restaurantId: a.id } })).id;
  dataOf(await run(cashier, openPosShift, { openingFloat: 0 }));
  dataOf(await run(manager, openPosShift, { openingFloat: 0 }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

const view = async (orderId: string) => dataOf(await ask(cashier, posOrder, { orderId }));

/** Two burgers paid as two parts: the first guest in cash, the second with FIB. */
async function splitBill() {
  const opened = dataOf(await run(cashier, openPosOrder, { tableId }));
  const one = dataOf(await run(cashier, addPosLine, { orderId: opened.orderId, productId: burger, quantity: 1, note: '', optionIds: [], expectedVersion: opened.version }));
  const two = dataOf(await run(cashier, addPosLine, { orderId: opened.orderId, productId: burger, quantity: 1, note: '', optionIds: [], expectedVersion: one.version }));
  const first = dataOf(await run(cashier, payPosOrder, { orderId: opened.orderId, expectedVersion: two.version, expectedTotal: 5_000, lineIds: [one.lineId], amountReceived: 5_000 }));
  const version = (await view(opened.orderId)).version;
  const second = dataOf(await run(cashier, payPosOrder, { orderId: opened.orderId, expectedVersion: version, expectedTotal: 5_000, lineIds: [two.lineId], method: 'FIB', amountReceived: 5_000, reference: 'F-9' }));
  return { orderId: opened.orderId, first: first.paymentId, second: second.paymentId };
}

describe('reversing one part of a split bill', () => {
  it('takes back only the chosen part and leaves the other standing', async () => {
    const { orderId, first, second } = await splitBill();
    const version = (await view(orderId)).version;
    const done = dataOf(await run(manager, reversePosPayment, { orderId, paymentId: first, expectedVersion: version, reason: 'Wrong dish' }));
    expect(done).toMatchObject({ amount: 5_000, method: 'CASH' });
    expect(await prisma().posPaymentReversal.count({ where: { paymentId: first } })).toBe(1);
    expect(await prisma().posPaymentReversal.count({ where: { paymentId: second } })).toBe(0);
    const after = await view(orderId);
    expect(after.status).toBe('PAID');
    expect(after.parts.map((p) => p.reversed)).toEqual([true, false]);
  });

  it('asks which part when the order has several and none is named', async () => {
    const { orderId } = await splitBill();
    const version = (await view(orderId)).version;
    const refused = await run(manager, reversePosPayment, { orderId, expectedVersion: version, reason: 'Wrong dish' });
    expect(codeOf(refused)).toBe('CONFLICT');
    expect(await prisma().posPaymentReversal.count()).toBe(0);
  });

  it('reverses a part of an order that is still open', async () => {
    const opened = dataOf(await run(cashier, openPosOrder, { tableId }));
    const one = dataOf(await run(cashier, addPosLine, { orderId: opened.orderId, productId: burger, quantity: 1, note: '', optionIds: [], expectedVersion: opened.version }));
    const two = dataOf(await run(cashier, addPosLine, { orderId: opened.orderId, productId: burger, quantity: 1, note: '', optionIds: [], expectedVersion: one.version }));
    const part = dataOf(await run(cashier, payPosOrder, { orderId: opened.orderId, expectedVersion: two.version, expectedTotal: 5_000, lineIds: [one.lineId], amountReceived: 5_000 }));
    const version = (await view(opened.orderId)).version;
    dataOf(await run(manager, reversePosPayment, { orderId: opened.orderId, paymentId: part.paymentId, expectedVersion: version, reason: 'Changed mind' }));
    expect((await view(opened.orderId)).status).toBe('OPEN');
  });

  it('keeps the day report in step: gross for both parts, the refund for one, the net for the other', async () => {
    const { orderId, first } = await splitBill();
    const version = (await view(orderId)).version;
    dataOf(await run(manager, reversePosPayment, { orderId, paymentId: first, expectedVersion: version, reason: 'Wrong dish' }));
    const day = dataOf(await ask(manager, posDailyReport, { day: baghdadDayOf(new Date()) }));
    expect(day.totals).toMatchObject({ grossSales: 10_000, refundsTotal: 5_000, netSales: 5_000 });
    expect(day.totals.refundsByMethod.CASH).toEqual({ count: 1, total: 5_000 });
    expect(day.totals.byMethod.FIB).toMatchObject({ count: 1, total: 5_000 });
  });
});

describe('receipts of a split bill', () => {
  it('gives each part its own receipt, newest by default, and lists the parts', async () => {
    const { orderId, first, second } = await splitBill();
    const latest = dataOf(await ask(cashier, posReceipt, { orderId }));
    expect(latest.paymentId).toBe(second);
    expect(latest.snapshot.total).toBe(5_000);
    expect(latest.parts.map((p) => p.part)).toEqual([1, 2]);
    const firstReceipt = dataOf(await ask(cashier, posReceipt, { orderId, paymentId: first }));
    expect(firstReceipt).toMatchObject({ paymentId: first, method: 'CASH' });
    expect(firstReceipt.snapshot.lines).toHaveLength(1);
  });
});
