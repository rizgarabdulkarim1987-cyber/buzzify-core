import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POS_LEG_METHODS, POS_PAYMENT_METHODS } from '@/server/domain/pos/payment-methods';
import { person, prisma, resetWorld, restaurant, useTestDatabase } from './fixture';

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  await resetWorld();
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

describe('the dollar columns', () => {
  it('keeps dollars out of the methods an owner can switch on, and in the methods a payment can use', () => {
    expect(POS_PAYMENT_METHODS).not.toContain('CASH_USD');
    expect(POS_LEG_METHODS).toEqual([...POS_PAYMENT_METHODS, 'CASH_USD']);
  });

  it('stores a dollar leg with the dollars handed over and the rate it was taken at', async () => {
    const a = await restaurant('Usd A');
    const cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
    const shift = await prisma().posShift.create({ data: { restaurantId: a.id, userId: cashier.userId, openingFloat: 0 } });
    const order = await prisma().posOrder.create({ data: { restaurantId: a.id, number: 1, status: 'PAID' } });
    const payment = await prisma().posPayment.create({
      data: { restaurantId: a.id, orderId: order.id, method: 'CASH_USD', amountReceived: 15_000, totalsSnapshot: {}, shiftId: shift.id, userId: cashier.userId },
    });
    await prisma().posPaymentLeg.create({ data: { restaurantId: a.id, paymentId: payment.id, method: 'CASH_USD', amount: 15_000, tendered: 15_000, tenderedUsd: 10, rate: 1500 } });
    const leg = await prisma().posPaymentLeg.findFirstOrThrow({ where: { paymentId: payment.id } });
    expect(leg).toMatchObject({ method: 'CASH_USD', amount: 15_000, tenderedUsd: 10, rate: 1500 });
  });

  it('stores the dollars counted at close beside the dinars', async () => {
    const a = await restaurant('Usd B');
    const cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
    const shift = await prisma().posShift.create({
      data: { restaurantId: a.id, userId: cashier.userId, openingFloat: 0, closedAt: new Date(), countedUsd: 12, expectedUsdAtClose: 10, differenceUsd: 2 },
    });
    expect(await prisma().posShift.findUniqueOrThrow({ where: { id: shift.id } })).toMatchObject({ countedUsd: 12, expectedUsdAtClose: 10, differenceUsd: 2 });
  });

  it('leaves the dollar columns empty on an old leg and an old shift', async () => {
    const a = await restaurant('Usd C');
    const cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
    const shift = await prisma().posShift.create({ data: { restaurantId: a.id, userId: cashier.userId, openingFloat: 0 } });
    expect(shift).toMatchObject({ countedUsd: null, expectedUsdAtClose: null, differenceUsd: null });
  });
});
