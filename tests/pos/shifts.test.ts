import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { addPosExpense, closePosShift, openPosShift } from '@/server/studio/actions/pos-shifts';
import { posMyShift, posOpenShifts, posShift } from '@/server/studio/queries/pos';
import { ask, codeOf, dataOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };
let b: { id: string };
let cashier: Person;
let other: Person;
let manager: Person;
let kitchen: Person;
let owner: Person;
let bManager: Person;

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await resetWorld();
  a = await restaurant('Shift A');
  b = await restaurant('Shift B');
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  other = await person('other', { staff: [a.id, 'CASHIER'] });
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  kitchen = await person('kitchen', { staff: [a.id, 'KITCHEN'] });
  owner = await person('owner', { membership: [a.id, 'OWNER'] });
  bManager = await person('bmanager', { staff: [b.id, 'MANAGER'] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

const open = async (who: Person = cashier, openingFloat = 50_000) => dataOf(await run(who, openPosShift, { openingFloat })).shiftId;

/** A finished cash sale on the shift, as the payment step will write it. */
async function sale(shiftId: string, who: Person, total: number, number: number) {
  const order = await prisma().posOrder.create({ data: { restaurantId: a.id, kind: 'DINE_IN', status: 'PAID', number } });
  await prisma().posPayment.create({
    data: { restaurantId: a.id, orderId: order.id, method: 'CASH', amountReceived: total, totalsSnapshot: { total }, userId: who.userId, shiftId },
  });
}

describe('opening a shift', () => {
  it('opens with a float and refuses a second open shift for the same person', async () => {
    const shiftId = await open();
    expect(await prisma().posShift.findUnique({ where: { id: shiftId } })).toMatchObject({ openingFloat: 50_000, closedAt: null });
    expect(codeOf(await run(cashier, openPosShift, { openingFloat: 0 }))).toBe('CONFLICT');
    expect(await open(other, 0)).not.toBe(shiftId);
  });

  it('lets two simultaneous opens by one person produce exactly one shift', async () => {
    const results = await Promise.all([run(cashier, openPosShift, { openingFloat: 1 }), run(cashier, openPosShift, { openingFloat: 2 })]);
    expect(results.map(codeOf).sort()).toEqual(['CONFLICT', 'OK']);
    expect(await prisma().posShift.count({ where: { restaurantId: a.id, userId: cashier.userId } })).toBe(1);
  });

  it('lets the Studio owner, who has no staff row, open a shift', async () => {
    expect(codeOf(await run(owner, openPosShift, { openingFloat: 10 }))).toBe('OK');
  });

  it('keeps the kitchen out, and refuses a negative or fractional float', async () => {
    expect(codeOf(await run(kitchen, openPosShift, { openingFloat: 0 }))).toBe('FORBIDDEN');
    expect(codeOf(await run(cashier, openPosShift, { openingFloat: -1 }))).toBe('INVALID');
    expect(codeOf(await run(cashier, openPosShift, { openingFloat: 1.5 }))).toBe('INVALID');
  });

  it('refuses a deactivated person', async () => {
    await prisma().posStaff.updateMany({ where: { userId: cashier.userId }, data: { deactivatedAt: new Date() } });
    expect(codeOf(await run(cashier, openPosShift, { openingFloat: 0 }))).not.toBe('OK');
  });
});

describe('expenses and the count', () => {
  it('counts float + cash sales - expenses and freezes the difference at close', async () => {
    const shiftId = await open();
    await sale(shiftId, cashier, 41_250, 1);
    await sale(shiftId, cashier, 8_750, 2);
    dataOf(await run(cashier, addPosExpense, { shiftId, amount: 5_000, reason: 'ice' }));
    const mid = dataOf(await ask(cashier, posShift, { shiftId }));
    // The count is blind: an open shift does not say what the drawer should hold.
    expect(mid).toMatchObject({ cashSales: 50_000, expensesTotal: 5_000, expectedCash: null });
    // 95,000 expected, 93,000 counted.
    const closed = dataOf(await run(cashier, closePosShift, { shiftId, countedCash: 93_000, note: 'short' }));
    expect(closed).toMatchObject({ expected: 95_000, difference: -2_000 });
    expect(await prisma().posShift.findUnique({ where: { id: shiftId } })).toMatchObject({ expectedCashAtClose: 95_000, difference: -2_000, countedCash: 93_000, note: 'short' });
    // A later sale on another shift does not move the frozen figures.
    const again = dataOf(await ask(cashier, posShift, { shiftId }));
    expect(again).toMatchObject({ expectedCash: 95_000 });
    expect(again.shift.closedAt).not.toBeNull();
  });

  it('refuses an expense or a second close on a closed shift', async () => {
    const shiftId = await open();
    dataOf(await run(cashier, closePosShift, { shiftId, countedCash: 50_000, note: '' }));
    expect(codeOf(await run(cashier, addPosExpense, { shiftId, amount: 100, reason: 'x' }))).toBe('CONFLICT');
    expect(codeOf(await run(cashier, closePosShift, { shiftId, countedCash: 1, note: '' }))).toBe('CONFLICT');
    expect(await open()).toBeTruthy();
  });

  it('refuses a missing reason, a zero amount and an amount past the limit', async () => {
    const shiftId = await open();
    expect(codeOf(await run(cashier, addPosExpense, { shiftId, amount: 100, reason: '  ' }))).toBe('INVALID');
    expect(codeOf(await run(cashier, addPosExpense, { shiftId, amount: 0, reason: 'x' }))).toBe('INVALID');
    expect(codeOf(await run(cashier, addPosExpense, { shiftId, amount: 2_147_483_648, reason: 'x' }))).toBe('INVALID');
  });

  it("lets a manager close another's shift but not another cashier", async () => {
    const shiftId = await open();
    expect(codeOf(await run(other, closePosShift, { shiftId, countedCash: 0, note: '' }))).toBe('FORBIDDEN');
    expect(codeOf(await run(other, addPosExpense, { shiftId, amount: 1, reason: 'x' }))).toBe('FORBIDDEN');
    const closed = dataOf(await run(manager, closePosShift, { shiftId, countedCash: 50_000, note: '' }));
    expect(closed.difference).toBe(0);
    expect((await prisma().posShift.findUnique({ where: { id: shiftId } }))!.closedByUserId).toBe(manager.userId);
    expect(dataOf(await ask(manager, posShift, { shiftId })).closedByName).toBe('manager person');
  });
});

describe('reading shifts', () => {
  it('gives the person their own open shift, and lists open shifts for those who may see reports', async () => {
    expect(dataOf(await ask(cashier, posMyShift, {})).shiftId).toBeNull();
    const shiftId = await open();
    expect(dataOf(await ask(cashier, posMyShift, {})).shiftId).toBe(shiftId);
    expect(dataOf(await ask(manager, posOpenShifts, {})).shifts.map((s) => s.id)).toEqual([shiftId]);
    expect(codeOf(await ask(cashier, posOpenShifts, {}))).toBe('FORBIDDEN');
  });

  it("never shows or touches another restaurant's shift", async () => {
    const shiftId = await open();
    expect(codeOf(await ask(bManager, posShift, { shiftId }))).toBe('NOT_FOUND');
    expect(codeOf(await run(bManager, closePosShift, { shiftId, countedCash: 0, note: '' }))).toBe('NOT_FOUND');
    expect(dataOf(await ask(bManager, posOpenShifts, {})).shifts).toEqual([]);
  });

  it('audits opening, expenses and closing', async () => {
    const shiftId = await open();
    dataOf(await run(cashier, addPosExpense, { shiftId, amount: 100, reason: 'x' }));
    dataOf(await run(cashier, closePosShift, { shiftId, countedCash: 49_900, note: '' }));
    const actions = (await prisma().auditLog.findMany({ where: { restaurantId: a.id }, select: { action: true } })).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['pos.shift.open', 'pos.shift.expense', 'pos.shift.close']));
  });
});
