import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPosArea, createPosTables } from '@/server/studio/actions/pos';
import { addPosLine, openPosOrder } from '@/server/studio/actions/pos-orders';
import { payPosOrder } from '@/server/studio/actions/pos-payments';
import { openPosShift } from '@/server/studio/actions/pos-shifts';
import { parseTotalsSnapshot } from '@/server/pos/totals-snapshot';
import { baghdadDayOf } from '@/lib/baghdad';
import { posDailyReport, posOrder } from '@/server/studio/queries/pos';
import { ask, codeOf, dataOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };
let cashier: Person;
let manager: Person;
let tableId: string;
let menuId: string;
let categoryId: string;

const names = (ar: string, en = ar) => ({ ar: { name: ar }, en: { name: en } });

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await resetWorld();
  a = await restaurant('Round A');
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  const menu = await prisma().menu.create({
    data: { restaurantId: a.id, name: 'm', slug: 'menu-a', currency: 'IQD', locales: ['ar', 'en'], defaultLocale: 'ar', timezone: 'Asia/Baghdad' },
  });
  menuId = menu.id;
  await prisma().posSettings.upsert({
    where: { restaurantId: a.id },
    create: { restaurantId: a.id, requireApproval: false, catalogMenuId: menu.id, roundingStep: 250 },
    update: { requireApproval: false, catalogMenuId: menu.id, roundingStep: 250 },
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

let counter = 0;
async function product(basePrice: number): Promise<string> {
  counter += 1;
  return (await prisma().product.create({ data: { menuId, categoryId, slug: `p${counter}`, sortOrder: counter, basePrice, translations: names('طبق', 'Plate') } })).id;
}

/** An open order with one line per price. */
async function orderOf(prices: number[]) {
  const opened = dataOf(await run(cashier, openPosOrder, { tableId }));
  let version = opened.version;
  const lineIds: string[] = [];
  for (const price of prices) {
    const added = dataOf(await run(cashier, addPosLine, { orderId: opened.orderId, productId: await product(price), quantity: 1, note: '', optionIds: [], expectedVersion: version }));
    lineIds.push(added.lineId);
    version = added.version;
  }
  return { orderId: opened.orderId, lineIds, version };
}

const view = async (orderId: string) => dataOf(await ask(cashier, posOrder, { orderId }));

async function snapshotOf(paymentId: string) {
  const row = await prisma().posPayment.findUniqueOrThrow({ where: { id: paymentId } });
  return parseTotalsSnapshot(paymentId, row.totalsSnapshot);
}

describe('rounding at payment', () => {
  it('shows and takes the rounded total, and freezes the difference', async () => {
    const { orderId, version } = await orderOf([10_124]);
    const now = await view(orderId);
    expect(now.totals).toMatchObject({ total: 10_000, rounding: -124 });
    expect(now.leftToPay).toBe(10_000);
    const paid = dataOf(await run(cashier, payPosOrder, { orderId, expectedVersion: version, expectedTotal: 10_000, amountReceived: 10_000 }));
    expect(paid.total).toBe(10_000);
    expect(await snapshotOf(paid.paymentId)).toMatchObject({ subtotal: 10_124, total: 10_000, rounding: -124 });
  });

  it('rounds half up and records the amount added', async () => {
    const { orderId, version } = await orderOf([10_125]);
    const paid = dataOf(await run(cashier, payPosOrder, { orderId, expectedVersion: version, expectedTotal: 10_250, amountReceived: 10_500 }));
    expect(paid.change).toBe(250);
    expect(await snapshotOf(paid.paymentId)).toMatchObject({ total: 10_250, rounding: 125 });
  });

  it('refuses the unrounded total the screen no longer shows', async () => {
    const { orderId, version } = await orderOf([10_124]);
    expect(codeOf(await run(cashier, payPosOrder, { orderId, expectedVersion: version, expectedTotal: 10_124, amountReceived: 10_124 }))).toBe('CONFLICT');
    expect(await prisma().posPayment.count({ where: { orderId } })).toBe(0);
  });

  it('needs the legs to add up to the rounded total', async () => {
    const { orderId, version } = await orderOf([10_124]);
    const short = await run(cashier, payPosOrder, { orderId, expectedVersion: version, expectedTotal: 10_000, legs: [{ method: 'CASH', amount: 9_750, tendered: 9_750 }] });
    expect(codeOf(short)).toBe('INVALID');
    const exact = await run(cashier, payPosOrder, { orderId, expectedVersion: version, expectedTotal: 10_000, legs: [{ method: 'CASH', amount: 10_000, tendered: 10_000 }] });
    expect(codeOf(exact)).toBe('OK');
  });

  it('leaves a bill on a step boundary alone', async () => {
    const { orderId, version } = await orderOf([10_250]);
    const paid = dataOf(await run(cashier, payPosOrder, { orderId, expectedVersion: version, expectedTotal: 10_250, amountReceived: 10_250 }));
    expect(await snapshotOf(paid.paymentId)).toMatchObject({ total: 10_250, rounding: 0 });
  });

  it('rounds each guest part on its own, so every part is a multiple of the step', async () => {
    const { orderId, lineIds } = await orderOf([3_333, 3_333, 3_333]);
    const first = dataOf(await run(cashier, payPosOrder, { orderId, expectedVersion: (await view(orderId)).version, expectedTotal: 3_250, lineIds: [lineIds[0]!], amountReceived: 3_250 }));
    const second = dataOf(await run(cashier, payPosOrder, { orderId, expectedVersion: (await view(orderId)).version, expectedTotal: 3_250, lineIds: [lineIds[1]!], amountReceived: 3_250 }));
    expect((await view(orderId)).leftToPay).toBe(3_250);
    const last = dataOf(await run(cashier, payPosOrder, { orderId, expectedVersion: (await view(orderId)).version, expectedTotal: 3_250, amountReceived: 3_250 }));
    for (const paid of [first, second, last]) expect((await snapshotOf(paid.paymentId)).total % 250).toBe(0);
    expect((await snapshotOf(last.paymentId)).rounding).toBe(-83);
    expect((await view(orderId)).status).toBe('PAID');
  });

  it('never turns a small real bill into a free one', async () => {
    const { orderId, version } = await orderOf([100]);
    // 100 dinars is under half a step: it pays one step, never nothing.
    expect((await view(orderId)).totals.total).toBe(250);
    expect(codeOf(await run(cashier, payPosOrder, { orderId, expectedVersion: version, expectedTotal: 250, amountReceived: 250 }))).toBe('OK');
  });

  it('sums the rounded total as sales and shows the rounding apart in the shift and day reports', async () => {
    const first = await orderOf([10_124]);
    dataOf(await run(cashier, payPosOrder, { orderId: first.orderId, expectedVersion: first.version, expectedTotal: 10_000, amountReceived: 10_000 }));
    const second = await orderOf([10_125]);
    dataOf(await run(cashier, payPosOrder, { orderId: second.orderId, expectedVersion: second.version, expectedTotal: 10_250, amountReceived: 10_250 }));
    const report = dataOf(await ask(manager, posDailyReport, { day: baghdadDayOf(new Date()) }));
    expect(report.totals).toMatchObject({ grossSales: 20_250, roundingTotal: 1 });
    expect(report.shifts[0]).toMatchObject({ grossSales: 20_250, roundingTotal: 1 });
  });

  it('keeps old snapshots without a rounding reading as 0', () => {
    const old = { subtotal: 5000, invoiceDiscount: 0, service: 0, tax: 0, total: 5000, invoiceDiscountInput: null, rates: { serviceRatePercent: 0, taxRatePercent: 0 }, lines: [] };
    expect(parseTotalsSnapshot('p', old).rounding).toBe(0);
  });
});
