import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { baghdadDayOf } from '@/lib/baghdad';
import { readRangeReport } from '@/server/pos/range-report';
import { readShiftReport } from '@/server/pos/report';
import { createPosArea, createPosTables } from '@/server/studio/actions/pos';
import { addPosLine, openPosOrder } from '@/server/studio/actions/pos-orders';
import { payPosOrder, reversePosPayment } from '@/server/studio/actions/pos-payments';
import { openPosShift } from '@/server/studio/actions/pos-shifts';
import { posBreakdown } from '@/server/studio/queries/pos-breakdown';
import { posShift } from '@/server/studio/queries/pos';
import { ask, dataOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

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
  a = await restaurant('Legs Reports');
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  const menu = await prisma().menu.create({
    data: { restaurantId: a.id, name: 'm', slug: 'menu-legs', currency: 'IQD', locales: ['ar', 'en'], defaultLocale: 'ar', timezone: 'Asia/Baghdad' },
  });
  await prisma().posSettings.upsert({
    where: { restaurantId: a.id },
    create: { restaurantId: a.id, requireApproval: false, catalogMenuId: menu.id, enabledPaymentMethods: ['CASH', 'FIB'] },
    update: { requireApproval: false, catalogMenuId: menu.id, enabledPaymentMethods: ['CASH', 'FIB'] },
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

/** A 35,000 bill paid 20,000 cash and 15,000 FIB with a 2,000 cash tip, in the cashier's shift. */
async function mixedSale() {
  const shiftId = dataOf(await run(cashier, openPosShift, { openingFloat: 10_000 })).shiftId;
  const opened = dataOf(await run(cashier, openPosOrder, { tableId }));
  const added = dataOf(await run(cashier, addPosLine, { orderId: opened.orderId, productId: burger, quantity: 7, note: '', optionIds: [], expectedVersion: opened.version }));
  const done = dataOf(
    await run(cashier, payPosOrder, {
      orderId: opened.orderId,
      expectedVersion: added.version,
      expectedTotal: 35_000,
      legs: [{ method: 'CASH', amount: 20_000, tendered: 22_000 }, { method: 'FIB', amount: 15_000 }],
      tip: { amount: 2_000, method: 'CASH' },
    }),
  );
  const order = await prisma().posOrder.findUniqueOrThrow({ where: { id: opened.orderId } });
  return { shiftId, orderId: opened.orderId, version: order.version, paymentId: done.paymentId };
}

describe('reports read the legs', () => {
  it('lists a mixed sale under both methods, with the tip apart from gross sales', async () => {
    const { shiftId } = await mixedSale();
    const report = await readShiftReport(prisma(), a.id, shiftId);
    expect(report.salesByMethod.CASH).toEqual({ count: 1, total: 20_000 });
    expect(report.salesByMethod.FIB).toEqual({ count: 1, total: 15_000 });
    expect(report.grossSales).toBe(35_000);
    expect(report.tipsTotal).toBe(2_000);
    expect(report.expectedCash).toBe(10_000 + 20_000 + 2_000);
  });

  it('adds up the same in the range report and every breakdown table', async () => {
    await mixedSale();
    const day = baghdadDayOf(new Date());
    const gross = (await readRangeReport(prisma(), a.id, { from: day, to: day })).totals.grossSales;
    const breakdown = dataOf(await ask(manager, posBreakdown, { from: day, to: day }));
    expect(gross).toBe(35_000);
    for (const key of ['byHour', 'byItem', 'byStaff', 'byMethod'] as const) {
      expect(breakdown[key].reduce((sum, row) => sum + row.total, 0), key).toBe(gross);
    }
    expect(breakdown.byMethod.map((r) => [r.method, r.total])).toEqual([['CASH', 20_000], ['FIB', 15_000]]);
  });

  it('refunds a mixed payment leg by leg: only the cash leg leaves the drawer', async () => {
    const { orderId, version } = await mixedSale();
    const managerShift = dataOf(await run(manager, openPosShift, { openingFloat: 0 })).shiftId;
    dataOf(await run(manager, reversePosPayment, { orderId, expectedVersion: version, reason: 'Wrong order' }));
    const reversal = await prisma().posPaymentReversal.findFirstOrThrow({ where: { orderId } });
    expect(reversal.cashPart).toBe(20_000);
    const summary = dataOf(await ask(manager, posShift, { shiftId: managerShift }));
    expect(summary.cashRefunds).toBe(20_000);
    expect(summary.refundsByMethod.CASH).toBe(20_000);
    expect(summary.refundsByMethod.FIB).toBe(15_000);
  });
});
