import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { baghdadDayOf } from '@/lib/baghdad';
import { createPosArea, createPosTables } from '@/server/studio/actions/pos';
import { addPosLine, openPosOrder } from '@/server/studio/actions/pos-orders';
import { payPosOrder, reversePosPayment } from '@/server/studio/actions/pos-payments';
import { closePosShift, openPosShift } from '@/server/studio/actions/pos-shifts';
import { posDailyReport, posReceipt, posShift, posShiftReport } from '@/server/studio/queries/pos';
import { ask, codeOf, dataOf, failureOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };
let b: { id: string };
let cashier: Person;
let manager: Person;
let owner: Person;
let bManager: Person;
let burger: string;
let tables: string[];

const names = (ar: string, en = ar) => ({ ar: { name: ar }, en: { name: en } });

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await resetWorld();
  a = await restaurant('Refund A');
  b = await restaurant('Refund B');
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  owner = await person('owner', { staff: [a.id, 'OWNER'] });
  bManager = await person('bmanager', { staff: [b.id, 'MANAGER'] });
  const menu = await prisma().menu.create({
    data: { restaurantId: a.id, name: 'm', slug: 'menu-r', currency: 'IQD', locales: ['ar', 'en'], defaultLocale: 'ar', timezone: 'Asia/Baghdad' },
  });
  await prisma().posSettings.upsert({
    where: { restaurantId: a.id },
    create: { restaurantId: a.id, catalogMenuId: menu.id, enabledPaymentMethods: ['CASH', 'FIB'] },
    update: { catalogMenuId: menu.id, enabledPaymentMethods: ['CASH', 'FIB'] },
  });
  const category = await prisma().category.create({ data: { menuId: menu.id, slug: 'food', sortOrder: 1, translations: names('أكل', 'Food') } });
  burger = (await prisma().product.create({ data: { menuId: menu.id, categoryId: category.id, slug: 'burger', sortOrder: 1, basePrice: 5000, translations: names('برغر', 'Burger') } })).id;
  const areaId = dataOf(await run(manager, createPosArea, { name: 'Hall' })).areaId;
  await run(manager, createPosTables, { areaId, from: 1, to: 4 });
  tables = (await prisma().posTable.findMany({ where: { restaurantId: a.id }, orderBy: { number: 'asc' } })).map((t) => t.id);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

const open = async (who: Person, openingFloat = 10_000) => dataOf(await run(who, openPosShift, { openingFloat })).shiftId;

/** A paid order of `quantity` burgers (5,000 each) at the nth table, paid by the cashier with `method`. */
async function paid(payer: Person, quantity = 1, method: 'CASH' | 'FIB' = 'CASH', table = 0) {
  const opened = dataOf(await run(cashier, openPosOrder, { tableId: tables[table]! }));
  const added = dataOf(await run(cashier, addPosLine, { orderId: opened.orderId, productId: burger, quantity, note: '', optionIds: [], expectedVersion: opened.version }));
  const total = quantity * 5_000;
  dataOf(
    await run(payer, payPosOrder, {
      orderId: opened.orderId,
      expectedVersion: added.version,
      expectedTotal: total,
      amountReceived: total,
      method,
      reference: method === 'FIB' ? 'TX-1' : undefined,
    }),
  );
  const order = await prisma().posOrder.findUniqueOrThrow({ where: { id: opened.orderId } });
  return { orderId: opened.orderId, version: order.version, total };
}

const reverse = (who: Person, orderId: string, expectedVersion: number, extra: Record<string, unknown> = {}) =>
  run(who, reversePosPayment, { orderId, expectedVersion, reason: 'Wrong table', ...extra });

describe('reversing a payment', () => {
  it('records one counter-entry for the whole payment, keeps the order paid, bumps the version and audits it', async () => {
    await open(cashier);
    const reverserShift = await open(manager, 0);
    const { orderId, version, total } = await paid(cashier, 2);
    const done = dataOf(await reverse(manager, orderId, version));
    expect(done).toMatchObject({ amount: total, method: 'CASH' });
    const row = await prisma().posPaymentReversal.findFirstOrThrow({ where: { orderId } });
    expect(row).toMatchObject({ restaurantId: a.id, amount: 10_000, method: 'CASH', reason: 'Wrong table', userId: manager.userId, shiftId: reverserShift, reference: null });
    const order = await prisma().posOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(order).toMatchObject({ status: 'PAID', version: version + 1 });
    expect(await prisma().posPayment.count({ where: { orderId } })).toBe(1);
    const audit = await prisma().auditLog.findFirstOrThrow({ where: { action: 'pos.payment.reverse', restaurantId: a.id } });
    expect(audit.changes).toMatchObject({ amount: { after: 10_000 }, method: { after: 'CASH' }, reason: { after: 'Wrong table' } });
  });

  it('is for payment.refund holders only: a cashier is refused and nothing is written', async () => {
    await open(cashier);
    const { orderId, version } = await paid(cashier);
    expect(codeOf(await reverse(cashier, orderId, version))).toBe('FORBIDDEN');
    expect(await prisma().posPaymentReversal.count()).toBe(0);
  });

  it('needs the reverser’s own open shift', async () => {
    await open(cashier);
    const { orderId, version } = await paid(cashier);
    expect(failureOf(await reverse(manager, orderId, version))).toMatchObject({ code: 'CONFLICT' });
    expect(await prisma().posPaymentReversal.count()).toBe(0);
  });

  it('refuses a second reversal of the same payment, and two at once leave exactly one row', async () => {
    await open(cashier);
    await open(manager, 0);
    await open(owner, 0);
    const { orderId, version } = await paid(cashier);
    const results = await Promise.all([reverse(manager, orderId, version), reverse(owner, orderId, version)]);
    expect(results.map(codeOf).sort()).toEqual(['CONFLICT', 'OK']);
    expect(await prisma().posPaymentReversal.count({ where: { orderId } })).toBe(1);
    const later = await prisma().posOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(codeOf(await reverse(manager, orderId, later.version))).toBe('CONFLICT');
    expect(await prisma().posPaymentReversal.count({ where: { orderId } })).toBe(1);
  });

  it('refuses a stale version, an unpaid order and a blank reason', async () => {
    await open(cashier);
    await open(manager, 0);
    const { orderId, version } = await paid(cashier);
    expect(codeOf(await reverse(manager, orderId, version - 1))).toBe('CONFLICT');
    expect(codeOf(await reverse(manager, orderId, version, { reason: '   ' }))).toBe('INVALID');
    const opened = dataOf(await run(cashier, openPosOrder, { tableId: tables[1]! }));
    expect(codeOf(await reverse(manager, opened.orderId, opened.version))).toBe('CONFLICT');
    expect(await prisma().posPaymentReversal.count()).toBe(0);
  });

  it('never reaches another restaurant’s order', async () => {
    await open(cashier);
    await open(bManager, 0);
    const { orderId, version } = await paid(cashier);
    expect(codeOf(await reverse(bManager, orderId, version))).toBe('NOT_FOUND');
    expect(await prisma().posPaymentReversal.count()).toBe(0);
  });

  it('records a terminal reversal with its reference and moves no cash', async () => {
    await open(cashier);
    const reverserShift = await open(manager, 5_000);
    const { orderId, version } = await paid(cashier, 1, 'FIB');
    dataOf(await reverse(manager, orderId, version, { reference: ' RF-9 ' }));
    expect(await prisma().posPaymentReversal.findFirstOrThrow({ where: { orderId } })).toMatchObject({ method: 'FIB', reference: 'RF-9', amount: 5_000 });
    const summary = dataOf(await ask(manager, posShift, { shiftId: reverserShift }));
    expect(summary.expectedCash).toBeNull();
    expect(summary.cashRefunds).toBe(0);
    expect(summary.refundsByMethod.FIB).toBe(5_000);
  });

  it('is refused while the subscription has lapsed', async () => {
    await open(cashier);
    await open(manager, 0);
    const { orderId, version } = await paid(cashier);
    await prisma().subscription.updateMany({ where: { restaurantId: a.id }, data: { status: 'CANCELLED' } });
    expect(codeOf(await reverse(manager, orderId, version))).not.toBe('OK');
    expect(await prisma().posPaymentReversal.count()).toBe(0);
  });
});

describe('what a reversal does to the drawer and the reports', () => {
  it('lowers the reverser’s expected cash, leaves the sale’s closed shift frozen and keeps gross sales', async () => {
    const saleShift = await open(cashier, 10_000);
    const { orderId, version } = await paid(cashier, 2);
    dataOf(await run(cashier, closePosShift, { shiftId: saleShift, countedCash: 20_000, note: '' }));
    const closed = await prisma().posShift.findUniqueOrThrow({ where: { id: saleShift } });
    const reverserShift = await open(manager, 30_000);
    dataOf(await reverse(manager, orderId, version));

    const mine = dataOf(await ask(manager, posShift, { shiftId: reverserShift }));
    expect(mine).toMatchObject({ cashRefunds: 10_000, expectedCash: null });
    const frozen = await prisma().posShift.findUniqueOrThrow({ where: { id: saleShift } });
    expect(frozen).toMatchObject({ expectedCashAtClose: closed.expectedCashAtClose, difference: closed.difference, countedCash: 20_000 });

    const report = dataOf(await ask(manager, posShiftReport, { shiftId: reverserShift }));
    expect(report).toMatchObject({ grossSales: 0, refundsTotal: 10_000, netSales: -10_000, expectedCash: 20_000 });
    expect(report.refundsByMethod.CASH).toEqual({ count: 1, total: 10_000 });
    const sold = dataOf(await ask(manager, posShiftReport, { shiftId: saleShift }));
    expect(sold).toMatchObject({ grossSales: 10_000, refundsTotal: 0, netSales: 10_000 });
  });

  it('adds refunds per method into the day’s totals and the net', async () => {
    await open(cashier);
    await open(manager, 0);
    const cash = await paid(cashier, 2, 'CASH', 0);
    const card = await paid(cashier, 1, 'FIB', 1);
    dataOf(await reverse(manager, cash.orderId, cash.version));
    dataOf(await reverse(manager, card.orderId, card.version));
    const day = dataOf(await ask(manager, posDailyReport, { day: baghdadDayOf(new Date()) }));
    expect(day.totals).toMatchObject({ grossSales: 15_000, refundsTotal: 15_000, netSales: 0 });
    expect(day.totals.refundsByMethod.CASH).toEqual({ count: 1, total: 10_000 });
    expect(day.totals.refundsByMethod.FIB).toEqual({ count: 1, total: 5_000 });
    expect(day.totals.refundsByMethod.QICARD).toEqual({ count: 0, total: 0 });
  });

  it('puts the reversal on the receipt', async () => {
    await open(cashier);
    await open(manager, 0);
    const { orderId, version } = await paid(cashier);
    expect(dataOf(await ask(cashier, posReceipt, { orderId }))).toMatchObject({ reversal: null, orderVersion: version });
    dataOf(await reverse(manager, orderId, version, { reason: 'Customer left' }));
    const receipt = dataOf(await ask(cashier, posReceipt, { orderId }));
    expect(receipt.reversal).toMatchObject({ amount: 5_000, reason: 'Customer left', byName: 'manager person', reference: null });
    expect(receipt.orderVersion).toBe(version + 1);
  });
});
