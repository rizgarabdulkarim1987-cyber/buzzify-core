import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closePosShift, openPosShift } from '@/server/studio/actions/pos-shifts';
import { posShiftReport } from '@/server/studio/queries/pos';
import { ask, codeOf, dataOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };
let b: { id: string };
let cashier: Person;
let manager: Person;
let bManager: Person;

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await resetWorld();
  a = await restaurant('XZ A');
  b = await restaurant('XZ B');
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
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

async function sale(shiftId: string, who: Person, total: number, number: number) {
  const order = await prisma().posOrder.create({ data: { restaurantId: a.id, kind: 'DINE_IN', status: 'PAID', number } });
  return prisma().posPayment.create({
    data: {
      restaurantId: a.id,
      orderId: order.id,
      method: 'CASH',
      amountReceived: total,
      totalsSnapshot: { subtotal: total, invoiceDiscount: 0, service: 0, tax: 0, deliveryFee: 0, total, invoiceDiscountInput: null, rates: { serviceRatePercent: 0, taxRatePercent: 0 }, lines: [] },
      userId: who.userId,
      shiftId,
    },
    select: { id: true, orderId: true },
  });
}

describe('X and Z reports', () => {
  it('calls the report of an open shift X, live and unnumbered, and writes nothing', async () => {
    const shiftId = dataOf(await run(cashier, openPosShift, { openingFloat: 10_000 })).shiftId;
    await sale(shiftId, cashier, 4_000, 1);
    const before = await prisma().posShift.findUniqueOrThrow({ where: { id: shiftId } });
    const x = dataOf(await ask(manager, posShiftReport, { shiftId }));
    expect(x).toMatchObject({ kind: 'X', grossSales: 4_000, expectedCash: 14_000 });
    expect(x.shift.zNumber).toBeNull();
    expect(await prisma().posShift.findUniqueOrThrow({ where: { id: shiftId } })).toEqual(before);
    expect(await prisma().posCounter.count({ where: { restaurantId: a.id } })).toBe(0);
  });

  it('calls the report of a closed shift Z and gives it its number', async () => {
    const shiftId = dataOf(await run(cashier, openPosShift, { openingFloat: 0 })).shiftId;
    await sale(shiftId, cashier, 3_000, 1);
    dataOf(await run(cashier, closePosShift, { shiftId, countedCash: 3_000, note: '' }));
    const z = dataOf(await ask(manager, posShiftReport, { shiftId }));
    expect(z).toMatchObject({ kind: 'Z', expectedCash: 3_000, countedCash: 3_000, difference: 0 });
    expect(z.shift.zNumber).toBe(1);
  });

  it('keeps a Z report as it was when a refund is recorded on a later shift', async () => {
    const first = dataOf(await run(cashier, openPosShift, { openingFloat: 0 })).shiftId;
    const paid = await sale(first, cashier, 6_000, 1);
    dataOf(await run(cashier, closePosShift, { shiftId: first, countedCash: 6_000, note: '' }));
    const zBefore = dataOf(await ask(manager, posShiftReport, { shiftId: first }));
    const later = dataOf(await run(manager, openPosShift, { openingFloat: 0 })).shiftId;
    await prisma().posPaymentReversal.create({
      data: { restaurantId: a.id, paymentId: paid.id, orderId: paid.orderId, method: 'CASH', amount: 6_000, reason: 'wrong order', userId: manager.userId, shiftId: later },
    });
    expect(dataOf(await ask(manager, posShiftReport, { shiftId: first }))).toEqual(zBefore);
  });

  it('is for report readers only and never shows another restaurant its shifts', async () => {
    const shiftId = dataOf(await run(cashier, openPosShift, { openingFloat: 0 })).shiftId;
    expect(codeOf(await ask(cashier, posShiftReport, { shiftId }) as never)).toBe('FORBIDDEN');
    expect(codeOf(await ask(bManager, posShiftReport, { shiftId }) as never)).toBe('NOT_FOUND');
  });
});
