import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { drawerShouldKick, receiptPrintOptions, refundOpensDrawer } from '@/server/domain/pos/drawer';
import { createPosArea, createPosTables, logPosReprint, openPosDrawer } from '@/server/studio/actions/pos';
import { addPosLine, openPosOrder } from '@/server/studio/actions/pos-orders';
import { payPosOrder } from '@/server/studio/actions/pos-payments';
import { openPosShift } from '@/server/studio/actions/pos-shifts';
import { codeOf, dataOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };
let b: { id: string };
let cashier: Person;
let manager: Person;
let kitchen: Person;
let bManager: Person;
let tableId: string;
let productId: string;

const names = (ar: string, en = ar) => ({ ar: { name: ar }, en: { name: en } });

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await resetWorld();
  a = await restaurant('Print A');
  b = await restaurant('Print B');
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  kitchen = await person('kitchen', { staff: [a.id, 'KITCHEN'] });
  bManager = await person('bmanager', { staff: [b.id, 'MANAGER'] });
  const menu = await prisma().menu.create({
    data: { restaurantId: a.id, name: 'm', slug: 'menu-a', currency: 'IQD', locales: ['ar', 'en'], defaultLocale: 'ar', timezone: 'Asia/Baghdad' },
  });
  await prisma().posSettings.upsert({ where: { restaurantId: a.id }, create: { restaurantId: a.id, requireApproval: false, catalogMenuId: menu.id }, update: {} });
  const category = await prisma().category.create({ data: { menuId: menu.id, slug: 'food', sortOrder: 1, translations: names('أكل', 'Food') } });
  productId = (await prisma().product.create({ data: { menuId: menu.id, categoryId: category.id, slug: 'plate', sortOrder: 1, basePrice: 5000, translations: names('طبق', 'Plate') } })).id;
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

async function paymentId(): Promise<string> {
  const opened = dataOf(await run(cashier, openPosOrder, { tableId }));
  const added = dataOf(await run(cashier, addPosLine, { orderId: opened.orderId, productId, quantity: 1, note: '', optionIds: [], expectedVersion: opened.version }));
  dataOf(await run(cashier, payPosOrder, { orderId: opened.orderId, expectedVersion: added.version, expectedTotal: 5000, amountReceived: 5000 }));
  return (await prisma().posPayment.findFirstOrThrow({ where: { orderId: opened.orderId } })).id;
}

describe('drawerShouldKick', () => {
  it('is true when any leg is cash or dollars', () => {
    expect(drawerShouldKick([{ method: 'CASH' }])).toBe(true);
    expect(drawerShouldKick([{ method: 'CASH_USD' }])).toBe(true);
    expect(drawerShouldKick([{ method: 'QICARD' }, { method: 'CASH' }])).toBe(true);
  });

  it('is false for card-only and for nothing', () => {
    expect(drawerShouldKick([{ method: 'QICARD' }, { method: 'ZAINCASH' }])).toBe(false);
    expect(drawerShouldKick([])).toBe(false);
  });
});

describe('receiptPrintOptions', () => {
  it('opens the drawer for a cash original only, never for a copy', () => {
    expect(receiptPrintOptions(false, [{ method: 'CASH' }])).toEqual({ copy: false, drawer: true });
    expect(receiptPrintOptions(true, [{ method: 'CASH' }])).toEqual({ copy: true, drawer: false });
    expect(receiptPrintOptions(false, [{ method: 'QICARD' }])).toEqual({ copy: false, drawer: false });
  });

  it('keeps the drawer shut for a split part of 0 (the rounding carried by an earlier part)', () => {
    expect(receiptPrintOptions(false, [{ method: 'CASH', amount: 0 }])).toEqual({ copy: false, drawer: false });
    expect(receiptPrintOptions(false, [{ method: 'CASH', amount: 1000 }])).toEqual({ copy: false, drawer: true });
    expect(refundOpensDrawer([{ method: 'CASH', amount: 0 }])).toBe(false);
  });
});

describe('openPosDrawer', () => {
  it('needs a reason and writes an audit row with it', async () => {
    expect(codeOf(await run(cashier, openPosDrawer, { reason: '   ' }))).toBe('INVALID');
    expect(codeOf(await run(cashier, openPosDrawer, { reason: 'Change for a customer' }))).toBe('OK');
    const row = await prisma().auditLog.findFirstOrThrow({ where: { action: 'pos.drawer.open', restaurantId: a.id } });
    expect(JSON.stringify(row.changes)).toContain('Change for a customer');
  });

  it('is not for the kitchen', async () => {
    expect(codeOf(await run(kitchen, openPosDrawer, { reason: 'x' }))).toBe('FORBIDDEN');
  });
});

describe('logPosReprint', () => {
  it('writes an audit row for a payment of this restaurant', async () => {
    const id = await paymentId();
    expect(codeOf(await run(cashier, logPosReprint, { paymentId: id }))).toBe('OK');
    const row = await prisma().auditLog.findFirstOrThrow({ where: { action: 'pos.receipt.reprint', entityId: id } });
    expect(row.restaurantId).toBe(a.id);
  });

  it('refuses a payment of another restaurant', async () => {
    const id = await paymentId();
    expect(codeOf(await run(bManager, logPosReprint, { paymentId: id }))).toBe('NOT_FOUND');
  });

  it('is not for the kitchen', async () => {
    const id = await paymentId();
    expect(codeOf(await run(kitchen, logPosReprint, { paymentId: id }))).toBe('FORBIDDEN');
  });
});

describe('the drawer on a refund', () => {
  it('opens for a refund whose payment had cash and a larger card leg', () => {
    expect(refundOpensDrawer([{ method: 'CARD' }, { method: 'CASH' }])).toBe(true);
    expect(refundOpensDrawer([{ method: 'CASH_USD' }])).toBe(true);
  });

  it('stays shut for a card-only refund', () => {
    expect(refundOpensDrawer([{ method: 'CARD' }])).toBe(false);
  });
});
