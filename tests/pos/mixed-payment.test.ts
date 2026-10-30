import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPosArea, createPosTables } from '@/server/studio/actions/pos';
import { addPosLine, openPosOrder } from '@/server/studio/actions/pos-orders';
import { payPosOrder } from '@/server/studio/actions/pos-payments';
import { openPosShift } from '@/server/studio/actions/pos-shifts';
import { posShift } from '@/server/studio/queries/pos';
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
  a = await restaurant('Mixed A');
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  const menu = await prisma().menu.create({
    data: { restaurantId: a.id, name: 'm', slug: 'menu-mixed', currency: 'IQD', locales: ['ar', 'en'], defaultLocale: 'ar', timezone: 'Asia/Baghdad' },
  });
  await prisma().posSettings.upsert({
    where: { restaurantId: a.id },
    create: { restaurantId: a.id, requireApproval: false, catalogMenuId: menu.id, enabledPaymentMethods: ['CASH', 'FIB', 'ZAINCASH'] },
    update: { requireApproval: false, catalogMenuId: menu.id, enabledPaymentMethods: ['CASH', 'FIB', 'ZAINCASH'] },
  });
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

/** An order of seven burgers (35,000), ready to pay. */
async function bill() {
  const opened = dataOf(await run(cashier, openPosOrder, { tableId }));
  const added = dataOf(await run(cashier, addPosLine, { orderId: opened.orderId, productId: burger, quantity: 7, note: '', optionIds: [], expectedVersion: opened.version }));
  return { orderId: opened.orderId, version: added.version };
}

const start = async () => dataOf(await run(cashier, openPosShift, { openingFloat: 10_000 })).shiftId;

const pay = async (input: object) => {
  const { orderId, version } = await bill();
  return run(cashier, payPosOrder, { orderId, expectedVersion: version, expectedTotal: 35_000, ...input });
};

describe('mixed payment', () => {
  it('pays one bill with cash and FIB, keeping a leg for each', async () => {
    await start();
    const done = dataOf(await pay({ legs: [{ method: 'CASH', amount: 20_000, tendered: 20_000 }, { method: 'FIB', amount: 15_000, reference: 'F-9' }] }));
    expect(done.change).toBe(0);
    const legs = await prisma().posPaymentLeg.findMany({ where: { paymentId: done.paymentId }, orderBy: { method: 'asc' } });
    expect(legs.map((l) => [l.method, l.amount, l.reference])).toEqual([['CASH', 20_000, null], ['FIB', 15_000, 'F-9']]);
    const payment = await prisma().posPayment.findFirstOrThrow({ where: { id: done.paymentId } });
    expect(payment.method).toBe('CASH');
  });

  it('gives change on the cash leg only, and the drawer keeps what was applied', async () => {
    const shiftId = await start();
    const done = dataOf(await pay({ legs: [{ method: 'CASH', amount: 20_000, tendered: 50_000 }, { method: 'FIB', amount: 15_000 }] }));
    expect(done.change).toBe(30_000);
    expect(dataOf(await ask(cashier, posShift, { shiftId })).cashSales).toBe(20_000);
  });

  it.each([
    ['legs that add up to less than the bill', [{ method: 'CASH', amount: 20_000, tendered: 20_000 }, { method: 'FIB', amount: 10_000 }]],
    ['legs that add up to more than the bill', [{ method: 'CASH', amount: 30_000, tendered: 30_000 }, { method: 'FIB', amount: 10_000 }]],
    ['two legs of the same method', [{ method: 'FIB', amount: 20_000 }, { method: 'FIB', amount: 15_000 }]],
    ['a change on a non-cash leg', [{ method: 'FIB', amount: 35_000, tendered: 40_000 }]],
    ['a cash leg handed less than it applies', [{ method: 'CASH', amount: 35_000, tendered: 30_000 }]],
    ['a method that is switched off', [{ method: 'QICARD', amount: 35_000 }]],
  ])('refuses %s', async (_label, legs) => {
    await start();
    const result = await pay({ legs });
    expect(['INVALID', 'CONFLICT']).toContain(codeOf(result));
    expect(await prisma().posPayment.count({ where: { restaurantId: a.id } })).toBe(0);
  });

  it('still takes the old single-method call as one leg', async () => {
    await start();
    const done = dataOf(await pay({ method: 'CASH', amountReceived: 40_000 }));
    expect(done.change).toBe(5_000);
    expect(await prisma().posPaymentLeg.count({ where: { paymentId: done.paymentId } })).toBe(1);
  });
});

describe('tips', () => {
  it('keeps a tip outside the bill total', async () => {
    await start();
    const done = dataOf(await pay({ legs: [{ method: 'FIB', amount: 35_000 }], tip: { amount: 3_000, method: 'FIB' } }));
    const payment = await prisma().posPayment.findFirstOrThrow({ where: { id: done.paymentId } });
    expect(payment.tipAmount).toBe(3_000);
    expect(payment.tipMethod).toBe('FIB');
    expect((payment.totalsSnapshot as { total: number }).total).toBe(35_000);
  });

  it('counts a cash tip in the drawer but not a FIB tip', async () => {
    const shiftId = await start();
    dataOf(await pay({ legs: [{ method: 'CASH', amount: 35_000, tendered: 40_000 }], tip: { amount: 2_000, method: 'CASH' } }));
    const withCashTip = dataOf(await ask(cashier, posShift, { shiftId }));
    expect(withCashTip.cashSales).toBe(37_000);
    dataOf(await pay({ legs: [{ method: 'FIB', amount: 35_000 }], tip: { amount: 5_000, method: 'FIB' } }));
    expect(dataOf(await ask(cashier, posShift, { shiftId })).cashSales).toBe(37_000);
  });

  it.each([
    ['a negative tip', { amount: -1, method: 'CASH' }],
    ['a tip above the bill', { amount: 35_001, method: 'CASH' }],
  ])('refuses %s', async (_label, tip) => {
    await start();
    expect(codeOf(await pay({ legs: [{ method: 'CASH', amount: 35_000, tendered: 35_000 }], tip }))).toBe('INVALID');
  });
});
