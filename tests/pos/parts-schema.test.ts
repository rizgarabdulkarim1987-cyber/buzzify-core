import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { person, prisma, resetWorld, restaurant, useTestDatabase } from './fixture';

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  await resetWorld();
  a = await restaurant('Parts Schema');
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

async function setup() {
  const who = await person('payer', { staff: [a.id, 'CASHIER'] });
  const order = await prisma().posOrder.create({ data: { restaurantId: a.id, kind: 'DINE_IN', status: 'OPEN', number: 1 } });
  const pay = (part?: number) =>
    prisma().posPayment.create({ data: { restaurantId: a.id, orderId: order.id, method: 'CASH', amountReceived: 1000, totalsSnapshot: {}, userId: who.userId, ...(part ? { part } : {}) } });
  return { order, pay };
}

describe('payment parts', () => {
  it('lets one order carry several payments with different parts, and refuses a repeated part', async () => {
    const { order, pay } = await setup();
    const first = await pay();
    const second = await pay(2);
    expect(first.part).toBe(1);
    expect(second.part).toBe(2);
    await expect(pay(2)).rejects.toThrow();
    const read = await prisma().posOrder.findFirstOrThrow({ where: { id: order.id }, include: { payments: true } });
    expect(read.payments).toHaveLength(2);
  });

  it('lets a line carry the payment that paid it', async () => {
    const { order, pay } = await setup();
    const paid = await pay();
    const line = await prisma().posOrderLine.create({ data: { restaurantId: a.id, orderId: order.id, nameSnapshot: 'Tea', unitPriceSnapshot: 1000, paymentId: paid.id } });
    expect(line.paymentId).toBe(paid.id);
  });
});
