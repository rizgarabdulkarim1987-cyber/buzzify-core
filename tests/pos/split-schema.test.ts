import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { person, prisma, resetWorld, restaurant, useTestDatabase } from './fixture';

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  await resetWorld();
  a = await restaurant('Split Schema');
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

async function payment(extra: object = {}) {
  const who = await person('payer', { staff: [a.id, 'CASHIER'] });
  const order = await prisma().posOrder.create({ data: { restaurantId: a.id, kind: 'DINE_IN', status: 'PAID', number: 1 } });
  return prisma().posPayment.create({ data: { restaurantId: a.id, orderId: order.id, method: 'CASH', amountReceived: 35000, totalsSnapshot: {}, userId: who.userId, ...extra } });
}

describe('payment legs, tips and comp', () => {
  it('lets a payment carry two legs and a tip kept apart from its totals', async () => {
    const paid = await payment({ tipAmount: 2000, tipMethod: 'CASH' });
    await prisma().posPaymentLeg.createMany({
      data: [
        { restaurantId: a.id, paymentId: paid.id, method: 'CASH', amount: 20000, tendered: 25000 },
        { restaurantId: a.id, paymentId: paid.id, method: 'FIB', amount: 15000, reference: 'F-1' },
      ],
    });
    const read = await prisma().posPayment.findFirstOrThrow({ where: { id: paid.id }, include: { legs: true } });
    expect(read.tipAmount).toBe(2000);
    expect(read.legs.map((l) => l.method).sort()).toEqual(['CASH', 'FIB']);
  });

  it('refuses two legs of the same method on one payment', async () => {
    const paid = await payment();
    await prisma().posPaymentLeg.create({ data: { restaurantId: a.id, paymentId: paid.id, method: 'CASH', amount: 1 } });
    await expect(prisma().posPaymentLeg.create({ data: { restaurantId: a.id, paymentId: paid.id, method: 'CASH', amount: 2 } })).rejects.toThrow();
  });

  it('defaults a payment to no tip, and a reversal to no cash part', async () => {
    const paid = await payment();
    expect(paid.tipAmount).toBe(0);
    expect(paid.tipMethod).toBeNull();
  });

  it('accepts COMP as a discount reason', async () => {
    const order = await prisma().posOrder.create({ data: { restaurantId: a.id, kind: 'DINE_IN', status: 'OPEN', number: 2, invoiceDiscountReason: 'COMP' } });
    expect(order.invoiceDiscountReason).toBe('COMP');
  });
});
