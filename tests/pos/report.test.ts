import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { baghdadDayOf } from '@/lib/baghdad';
import { createPosArea, createPosTables } from '@/server/studio/actions/pos';
import { addPosLine, cancelPosLine, cancelPosOrder, openPosOrder, setPosInvoiceDiscount, updatePosLine } from '@/server/studio/actions/pos-orders';
import { payPosOrder } from '@/server/studio/actions/pos-payments';
import { addPosExpense, closePosShift, openPosShift } from '@/server/studio/actions/pos-shifts';
import { posDailyReport, posShift, posShiftReport } from '@/server/studio/queries/pos';
import { ask, codeOf, dataOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };
let b: { id: string };
let cashier: Person;
let other: Person;
let manager: Person;
let bManager: Person;
let burger: string;
let tables: { id: string }[];
let next = 0;

const names = (ar: string, en = ar) => ({ ar: { name: ar }, en: { name: en } });
const today = () => baghdadDayOf(new Date());

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await resetWorld();
  next = 0;
  a = await restaurant('Report A');
  b = await restaurant('Report B');
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  other = await person('other', { staff: [a.id, 'CASHIER'] });
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  bManager = await person('bmanager', { staff: [b.id, 'MANAGER'] });
  const menu = await prisma().menu.create({
    data: { restaurantId: a.id, name: 'm', slug: 'menu-a', currency: 'IQD', locales: ['ar', 'en'], defaultLocale: 'ar', timezone: 'Asia/Baghdad' },
  });
  await prisma().posSettings.upsert({ where: { restaurantId: a.id }, create: { restaurantId: a.id, requireApproval: false, catalogMenuId: menu.id }, update: { requireApproval: false, catalogMenuId: menu.id } });
  const category = await prisma().category.create({ data: { menuId: menu.id, slug: 'food', sortOrder: 1, translations: names('أكل', 'Food') } });
  burger = (await prisma().product.create({ data: { menuId: menu.id, categoryId: category.id, slug: 'burger', sortOrder: 1, basePrice: 5000, translations: names('برغر', 'Burger') } })).id;
  const areaId = dataOf(await run(manager, createPosArea, { name: 'Hall' })).areaId;
  await run(manager, createPosTables, { areaId, from: 1, to: 6 });
  tables = await prisma().posTable.findMany({ where: { restaurantId: a.id }, orderBy: { number: 'asc' }, select: { id: true } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

/** An order of `quantity` burgers at the next free table, with the setup the test wants (discounts), left unpaid. */
async function order(who: Person, quantity: number) {
  const opened = dataOf(await run(who, openPosOrder, { tableId: tables[next++]!.id }));
  const added = dataOf(await run(who, addPosLine, { orderId: opened.orderId, productId: burger, quantity, note: '', optionIds: [], expectedVersion: opened.version }));
  return { orderId: opened.orderId, lineId: added.lineId, version: added.version };
}

async function paid(who: Person, quantity: number) {
  const o = await order(who, quantity);
  const total = quantity * 5000;
  dataOf(await run(who, payPosOrder, { orderId: o.orderId, expectedVersion: o.version, expectedTotal: total, amountReceived: total }));
}

describe('the daily report', () => {
  it('adds two shifts up: sales, discounts from the snapshots, an expense and an exact count', async () => {
    const s1 = dataOf(await run(cashier, openPosShift, { openingFloat: 10_000 })).shiftId;
    const s2 = dataOf(await run(other, openPosShift, { openingFloat: 5_000 })).shiftId;
    // Shift 1: 30,000 from six burgers where 10% is taken off the invoice -> 27,000.
    const big = await order(cashier, 6);
    const discounted = dataOf(await run(cashier, setPosInvoiceDiscount, { orderId: big.orderId, discount: { kind: 'PERCENT', value: 10, reason: 'MANAGER_DECISION' }, expectedVersion: big.version }));
    dataOf(await run(cashier, payPosOrder, { orderId: big.orderId, expectedVersion: discounted.version, expectedTotal: 27_000, amountReceived: 27_000 }));
    // Shift 1 also: 10,000 from two burgers where one line has 1,000 off -> 9,000.
    const small = await order(cashier, 2);
    const lined = dataOf(await run(cashier, updatePosLine, { lineId: small.lineId, discount: { kind: 'AMOUNT', value: 1_000, reason: 'MANAGER_DECISION' }, expectedVersion: small.version }));
    dataOf(await run(cashier, payPosOrder, { orderId: small.orderId, expectedVersion: lined.version, expectedTotal: 9_000, amountReceived: 9_000 }));
    // Shift 2: 10,000 from two burgers.
    await paid(other, 2);
    dataOf(await run(other, addPosExpense, { shiftId: s2, amount: 2_000, reason: 'ice' }));
    // Close both: shift 1 holds 10,000 + 36,000, shift 2 holds 5,000 + 10,000 - 2,000.
    dataOf(await run(cashier, closePosShift, { shiftId: s1, countedCash: 46_000, note: '' }));
    dataOf(await run(other, closePosShift, { shiftId: s2, countedCash: 13_000, note: '' }));

    const report = dataOf(await ask(manager, posDailyReport, { day: today() }));
    expect(report.shifts.map((s) => s.cashierName)).toEqual(['cashier person', 'other person']);
    expect(report.shifts[0]).toMatchObject({ grossSales: 36_000, discountsTotal: 4_000, netSales: 36_000, expectedCash: 46_000, countedCash: 46_000, difference: 0 });
    expect(report.shifts[1]).toMatchObject({ grossSales: 10_000, expectedCash: 13_000, expenses: [{ reason: 'ice', amount: 2_000 }] });
    expect(report.totals).toMatchObject({ grossSales: 46_000, discountsTotal: 4_000, netSales: 46_000, expensesTotal: 2_000, differenceTotal: 0 });
    expect(report.totals.byMethod.CASH).toEqual({ count: 3, total: 46_000 });
  });

  it('keeps a shift opened at 23:00 Baghdad and closed after midnight in its opening day', async () => {
    await prisma().posShift.create({
      data: { restaurantId: a.id, userId: cashier.userId, openedAt: new Date('2026-10-24T20:00:00Z'), closedAt: new Date('2026-10-24T22:30:00Z'), openingFloat: 0, countedCash: 0, expectedCashAtClose: 0, difference: 0 },
    });
    expect(dataOf(await ask(manager, posDailyReport, { day: '2026-10-24' })).shifts).toHaveLength(1);
    expect(dataOf(await ask(manager, posDailyReport, { day: '2026-10-25' })).shifts).toHaveLength(0);
  });

  it('groups cancellations with and without reasons, and keeps a cancel by someone with no shift apart', async () => {
    dataOf(await run(cashier, openPosShift, { openingFloat: 0 }));
    const one = await order(cashier, 1);
    const two = await order(cashier, 1);
    dataOf(await run(cashier, cancelPosLine, { lineId: one.lineId, reason: 'wrong item', expectedVersion: one.version }));
    dataOf(await run(cashier, cancelPosOrder, { orderId: two.orderId, reason: 'wrong item', expectedVersion: two.version }));
    const three = await order(manager, 1);
    dataOf(await run(manager, cancelPosOrder, { orderId: three.orderId, reason: 'manager call', expectedVersion: three.version }));

    const report = dataOf(await ask(manager, posDailyReport, { day: today() }));
    expect(report.shifts[0]).toMatchObject({ cancelledOrders: 1, cancelledLines: 1, cancelReasons: [{ reason: 'wrong item', count: 2 }] });
    expect(report.outsideShifts).toMatchObject({ cancelledOrders: 1, cancelledLines: 0, reasons: [{ reason: 'manager call', count: 1 }], byActor: [{ name: 'manager person', orders: 1, lines: 0 }] });
    expect(report.totals).toMatchObject({ cancelledOrders: 2, cancelledLines: 1 });
  });

  it('is all zeros on a quiet day, and refuses a day that is not a date', async () => {
    const report = dataOf(await ask(manager, posDailyReport, { day: '2026-01-01' }));
    expect(report).toMatchObject({ shifts: [], outsideShifts: null, totals: { grossSales: 0, netSales: 0, cancelledOrders: 0 } });
    for (const day of ['2026-02-30', '25/10/2026', '', '2026-13-01']) {
      expect(codeOf(await ask(manager, posDailyReport, { day }) as never)).toBe('INVALID');
    }
  });

  it('matches the shift screen: the same numbers for the same shift', async () => {
    const shiftId = dataOf(await run(cashier, openPosShift, { openingFloat: 7_000 })).shiftId;
    await paid(cashier, 3);
    dataOf(await run(cashier, addPosExpense, { shiftId, amount: 500, reason: 'tape' }));
    const summary = dataOf(await ask(cashier, posShift, { shiftId }));
    const report = dataOf(await ask(manager, posShiftReport, { shiftId }));
    expect(report.expectedCash).toBe(summary.expectedCash);
    expect(report.grossSales).toBe(summary.cashSales);
    expect(report.expenses.reduce((sum, e) => sum + e.amount, 0)).toBe(summary.expensesTotal);
  });

  it('is for report readers only, and never crosses restaurants', async () => {
    const shiftId = dataOf(await run(cashier, openPosShift, { openingFloat: 0 })).shiftId;
    expect(codeOf(await ask(cashier, posDailyReport, { day: today() }) as never)).toBe('FORBIDDEN');
    expect(codeOf(await ask(cashier, posShiftReport, { shiftId }) as never)).toBe('FORBIDDEN');
    expect(codeOf(await ask(bManager, posShiftReport, { shiftId }) as never)).toBe('NOT_FOUND');
    expect(dataOf(await ask(bManager, posDailyReport, { day: today() })).shifts).toEqual([]);
  });
});
