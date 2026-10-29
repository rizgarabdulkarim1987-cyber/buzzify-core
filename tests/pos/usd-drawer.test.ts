import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPosArea, createPosTables } from '@/server/studio/actions/pos';
import { addPosLine, openPosOrder } from '@/server/studio/actions/pos-orders';
import { payPosOrder, reversePosPayment } from '@/server/studio/actions/pos-payments';
import { closePosShift, openPosShift } from '@/server/studio/actions/pos-shifts';
import { posShift, posShiftReport } from '@/server/studio/queries/pos';
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
  a = await restaurant('Usd Drawer A');
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
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

async function orderOf(price: number) {
  counter += 1;
  const productId = (await prisma().product.create({ data: { menuId, categoryId, slug: `p${counter}`, sortOrder: counter, basePrice: price, translations: names('طبق', 'Plate') } })).id;
  const opened = dataOf(await run(cashier, openPosOrder, { tableId }));
  const added = dataOf(await run(cashier, addPosLine, { orderId: opened.orderId, productId, quantity: 1, note: '', optionIds: [], expectedVersion: opened.version }));
  return { orderId: opened.orderId, version: added.version };
}

/** Opens the cashier's shift with 50,000 and sells a 15,000 bill for 12 dollars (3,000 dinars of change). */
async function soldForTwelveDollars() {
  const { shiftId } = dataOf(await run(cashier, openPosShift, { openingFloat: 50_000 }));
  const { orderId, version } = await orderOf(15_000);
  const paid = dataOf(await run(cashier, payPosOrder, { orderId, expectedVersion: version, expectedTotal: 15_000, legs: [{ method: 'CASH_USD', amount: 15_000, tenderedUsd: 12, rate: 1500 }] }));
  return { shiftId, orderId, paymentId: paid.paymentId };
}

describe('the drawer in two currencies', () => {
  it('expects the dollars handed over and the dinars minus the change given', async () => {
    const { shiftId } = await soldForTwelveDollars();
    const report = dataOf(await ask(manager, posShiftReport, { shiftId }));
    expect(report).toMatchObject({ expectedCash: 47_000, expectedUsd: 12, usdReceived: 12, usdRefunded: 0 });
    expect(report.salesByMethod.CASH_USD).toEqual({ count: 1, total: 15_000 });
    expect(report.grossSales).toBe(15_000);
  });

  it('closes with both counts and stores both differences', async () => {
    const { shiftId } = await soldForTwelveDollars();
    const closed = dataOf(await run(cashier, closePosShift, { shiftId, countedCash: 46_000, countedUsd: 13, note: '' }));
    expect(closed).toMatchObject({ expected: 47_000, difference: -1_000, expectedUsd: 12, countedUsd: 13, differenceUsd: 1 });
    expect(await prisma().posShift.findUniqueOrThrow({ where: { id: shiftId } })).toMatchObject({ countedUsd: 13, expectedUsdAtClose: 12, differenceUsd: 1 });
  });

  it('refuses to close without counting the dollars when dollars are on', async () => {
    const { shiftId } = await soldForTwelveDollars();
    const refused = await run(cashier, closePosShift, { shiftId, countedCash: 47_000, note: '' });
    expect(codeOf(refused)).toBe('INVALID');
    expect((await prisma().posShift.findUniqueOrThrow({ where: { id: shiftId } })).closedAt).toBeNull();
  });

  it('asks for dollars when dollars were taken even if they are switched off since', async () => {
    const { shiftId } = await soldForTwelveDollars();
    await prisma().posSettings.update({ where: { restaurantId: a.id }, data: { usdEnabled: false } });
    expect(codeOf(await run(cashier, closePosShift, { shiftId, countedCash: 47_000, note: '' }))).toBe('INVALID');
    expect(codeOf(await run(cashier, closePosShift, { shiftId, countedCash: 47_000, countedUsd: 12, note: '' }))).toBe('OK');
  });

  it('does not ask for dollars when none were taken and dollars are off', async () => {
    await prisma().posSettings.update({ where: { restaurantId: a.id }, data: { usdEnabled: false } });
    const { shiftId } = dataOf(await run(cashier, openPosShift, { openingFloat: 0 }));
    const closed = dataOf(await run(cashier, closePosShift, { shiftId, countedCash: 0, note: '' }));
    expect(closed.countedUsd).toBeNull();
    expect(await prisma().posShift.findUniqueOrThrow({ where: { id: shiftId } })).toMatchObject({ countedUsd: null, expectedUsdAtClose: null, differenceUsd: null });
  });

  it('reverses a dollar payment in dollars from the reverser drawer, taking the dinar change back', async () => {
    const { orderId, paymentId } = await soldForTwelveDollars();
    const managerShift = dataOf(await run(manager, openPosShift, { openingFloat: 10_000 })).shiftId;
    const version = (await prisma().posOrder.findUniqueOrThrow({ where: { id: orderId } })).version;
    dataOf(await run(manager, reversePosPayment, { orderId, paymentId, expectedVersion: version, reason: 'wrong order' }));
    const report = dataOf(await ask(manager, posShiftReport, { shiftId: managerShift }));
    // The manager's drawer took no dollars, so the 12 came from outside it: the count expects none, and the 12 are flagged.
    expect(report).toMatchObject({ expectedUsd: 0, usdBeyondDrawer: 12, usdRefunded: 12, usdReceived: 0, expectedCash: 13_000 });
    expect(report.refundsByMethod.CASH_USD).toEqual({ count: 1, total: 15_000 });
  });

  it('never expects a negative dollar count when a shift refunds more dollars than it took', async () => {
    const { orderId, paymentId } = await soldForTwelveDollars();
    const managerShift = dataOf(await run(manager, openPosShift, { openingFloat: 10_000 })).shiftId;
    const version = (await prisma().posOrder.findUniqueOrThrow({ where: { id: orderId } })).version;
    dataOf(await run(manager, reversePosPayment, { orderId, paymentId, expectedVersion: version, reason: 'wrong order' }));
    // The count is blind: while the shift is open the screen must not hint at the dollars it expects.
    expect(dataOf(await ask(manager, posShift, { shiftId: managerShift })).usdBeyondDrawer).toBeNull();
    const closed = dataOf(await run(manager, closePosShift, { shiftId: managerShift, countedCash: 13_000, countedUsd: 0, note: '' }));
    expect(closed).toMatchObject({ expectedUsd: 0, countedUsd: 0, differenceUsd: 0 });
    expect(dataOf(await ask(manager, posShift, { shiftId: managerShift })).usdBeyondDrawer).toBe(12);
  });

  it('keeps shifts without dollars exactly as before', async () => {
    await prisma().posSettings.update({ where: { restaurantId: a.id }, data: { usdEnabled: false } });
    const { shiftId } = dataOf(await run(cashier, openPosShift, { openingFloat: 50_000 }));
    const report = dataOf(await ask(manager, posShiftReport, { shiftId }));
    expect(report).toMatchObject({ expectedCash: 50_000, expectedUsd: 0, usdBeyondDrawer: 0, usdReceived: 0, usdRefunded: 0, countedUsd: null });
  });
});
