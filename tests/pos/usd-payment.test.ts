import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPosArea, createPosTables } from '@/server/studio/actions/pos';
import { addPosLine, openPosOrder } from '@/server/studio/actions/pos-orders';
import { payPosOrder } from '@/server/studio/actions/pos-payments';
import { openPosShift } from '@/server/studio/actions/pos-shifts';
import { posReceipt } from '@/server/studio/queries/pos';
import { ask, codeOf, dataOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };
let cashier: Person;
let manager: Person;
let tableId: string;
let menuId: string;
let categoryId: string;
let counter = 0;

const names = (ar: string, en = ar) => ({ ar: { name: ar }, en: { name: en } });

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await resetWorld();
  a = await restaurant('Usd Pay A');
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  const menu = await prisma().menu.create({
    data: { restaurantId: a.id, name: 'm', slug: 'menu-a', currency: 'IQD', locales: ['ar', 'en'], defaultLocale: 'ar', timezone: 'Asia/Baghdad' },
  });
  menuId = menu.id;
  await prisma().posSettings.upsert({
    where: { restaurantId: a.id },
    create: { restaurantId: a.id, requireApproval: false, catalogMenuId: menu.id, usdEnabled: true, usdRate: 1500 },
    update: { requireApproval: false, catalogMenuId: menu.id, usdEnabled: true, usdRate: 1500 },
  });
  categoryId = (await prisma().category.create({ data: { menuId, slug: 'food', sortOrder: 1, translations: names('أكل', 'Food') } })).id;
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

/** An open order for one product of the given price. */
async function orderOf(price: number) {
  counter += 1;
  const productId = (await prisma().product.create({ data: { menuId, categoryId, slug: `p${counter}`, sortOrder: counter, basePrice: price, translations: names('طبق', 'Plate') } })).id;
  const opened = dataOf(await run(cashier, openPosOrder, { tableId }));
  const added = dataOf(await run(cashier, addPosLine, { orderId: opened.orderId, productId, quantity: 1, note: '', optionIds: [], expectedVersion: opened.version }));
  return { orderId: opened.orderId, version: added.version };
}

const legsOfPayment = (paymentId: string) => prisma().posPaymentLeg.findMany({ where: { paymentId }, orderBy: { method: 'asc' } });

describe('taking dollars', () => {
  it('takes the exact dollars for a bill and freezes the rate on the leg', async () => {
    const { orderId, version } = await orderOf(15_000);
    const paid = dataOf(await run(cashier, payPosOrder, { orderId, expectedVersion: version, expectedTotal: 15_000, legs: [{ method: 'CASH_USD', amount: 15_000, tenderedUsd: 10, rate: 1500 }] }));
    expect(paid.change).toBe(0);
    expect(await legsOfPayment(paid.paymentId)).toMatchObject([{ method: 'CASH_USD', amount: 15_000, tenderedUsd: 10, rate: 1500, tendered: null }]);
    const payment = await prisma().posPayment.findUniqueOrThrow({ where: { id: paid.paymentId } });
    expect(payment).toMatchObject({ method: 'CASH_USD', amountReceived: 15_000 });
  });

  it('gives the overpayment back in dinars', async () => {
    const { orderId, version } = await orderOf(15_000);
    const paid = dataOf(await run(cashier, payPosOrder, { orderId, expectedVersion: version, expectedTotal: 15_000, legs: [{ method: 'CASH_USD', amount: 15_000, tenderedUsd: 12, rate: 1500 }] }));
    expect(paid.change).toBe(3_000);
    expect(dataOf(await ask(cashier, posReceipt, { orderId })).change).toBe(3_000);
  });

  it('adds up part dollars and part dinars', async () => {
    const { orderId, version } = await orderOf(15_000);
    const paid = dataOf(
      await run(cashier, payPosOrder, {
        orderId,
        expectedVersion: version,
        expectedTotal: 15_000,
        legs: [
          { method: 'CASH_USD', amount: 9_000, tenderedUsd: 6, rate: 1500 },
          { method: 'CASH', amount: 6_000, tendered: 10_000 },
        ],
      }),
    );
    expect(paid.change).toBe(4_000);
    expect(await legsOfPayment(paid.paymentId)).toMatchObject([
      { method: 'CASH', amount: 6_000, tendered: 10_000 },
      { method: 'CASH_USD', amount: 9_000, tenderedUsd: 6, rate: 1500 },
    ]);
  });

  it('rounds the dollars needed up and gives the rest in dinars', async () => {
    const { orderId, version } = await orderOf(10_000);
    const short = await run(cashier, payPosOrder, { orderId, expectedVersion: version, expectedTotal: 10_000, legs: [{ method: 'CASH_USD', amount: 10_000, tenderedUsd: 6, rate: 1500 }] });
    expect(codeOf(short)).toBe('INVALID');
    const paid = dataOf(await run(cashier, payPosOrder, { orderId, expectedVersion: version, expectedTotal: 10_000, legs: [{ method: 'CASH_USD', amount: 10_000, tenderedUsd: 7, rate: 1500 }] }));
    expect(paid.change).toBe(500);
  });

  it('refuses dollars when the restaurant has them switched off', async () => {
    await prisma().posSettings.update({ where: { restaurantId: a.id }, data: { usdEnabled: false } });
    const { orderId, version } = await orderOf(15_000);
    const refused = await run(cashier, payPosOrder, { orderId, expectedVersion: version, expectedTotal: 15_000, legs: [{ method: 'CASH_USD', amount: 15_000, tenderedUsd: 10, rate: 1500 }] });
    expect(codeOf(refused)).toBe('CONFLICT');
    expect(await prisma().posPayment.count({ where: { orderId } })).toBe(0);
  });

  it('refuses a rate that differs from the one the server holds', async () => {
    const { orderId, version } = await orderOf(15_000);
    await prisma().posSettings.update({ where: { restaurantId: a.id }, data: { usdRate: 1400 } });
    const refused = await run(cashier, payPosOrder, { orderId, expectedVersion: version, expectedTotal: 15_000, legs: [{ method: 'CASH_USD', amount: 15_000, tenderedUsd: 10, rate: 1500 }] });
    expect(codeOf(refused)).toBe('CONFLICT');
    expect(await prisma().posPayment.count({ where: { orderId } })).toBe(0);
  });

  it('refuses a dollar leg with no dollars or no rate', async () => {
    const { orderId, version } = await orderOf(15_000);
    expect(codeOf(await run(cashier, payPosOrder, { orderId, expectedVersion: version, expectedTotal: 15_000, legs: [{ method: 'CASH_USD', amount: 15_000, rate: 1500 }] }))).toBe('INVALID');
    expect(codeOf(await run(cashier, payPosOrder, { orderId, expectedVersion: version, expectedTotal: 15_000, legs: [{ method: 'CASH_USD', amount: 15_000, tenderedUsd: 10 }] }))).toBe('INVALID');
  });

  it('refuses dollars on a plain cash leg and a rate with no dollars', async () => {
    const { orderId, version } = await orderOf(15_000);
    const refused = await run(cashier, payPosOrder, { orderId, expectedVersion: version, expectedTotal: 15_000, legs: [{ method: 'CASH', amount: 15_000, tendered: 15_000, tenderedUsd: 10 }] });
    expect(codeOf(refused)).toBe('INVALID');
  });
});
