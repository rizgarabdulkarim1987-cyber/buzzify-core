import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPosArea, createPosTables } from '@/server/studio/actions/pos';
import { addPosLine, cancelPosOrder, openPosOrder } from '@/server/studio/actions/pos-orders';
import { payPosOrder } from '@/server/studio/actions/pos-payments';
import { openPosShift } from '@/server/studio/actions/pos-shifts';
import { posSyncSnapshot } from '@/server/studio/queries/pos-sync';
import { ask, codeOf, dataOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };
let b: { id: string };
let cashier: Person;
let manager: Person;
let kitchen: Person;
let bCashier: Person;
let tables: { id: string }[];
let burger: string;

const names = (ar: string, en = ar) => ({ ar: { name: ar }, en: { name: en } });

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await resetWorld();
  a = await restaurant('Snap A');
  b = await restaurant('Snap B');
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  kitchen = await person('kitchen', { staff: [a.id, 'KITCHEN'] });
  bCashier = await person('bcashier', { staff: [b.id, 'CASHIER'] });
  const menu = await prisma().menu.create({
    data: { restaurantId: a.id, name: 'm', slug: 'menu-a', currency: 'IQD', locales: ['ar', 'en'], defaultLocale: 'ar', timezone: 'Asia/Baghdad' },
  });
  await prisma().posSettings.upsert({
    where: { restaurantId: a.id },
    create: { restaurantId: a.id, requireApproval: false, catalogMenuId: menu.id, taxRatePercent: 10, kitchenPrintEnabled: true },
    update: { requireApproval: false, catalogMenuId: menu.id, taxRatePercent: 10, kitchenPrintEnabled: true },
  });
  const category = await prisma().category.create({ data: { menuId: menu.id, slug: 'food', sortOrder: 1, translations: names('أكل', 'Food') } });
  burger = (await prisma().product.create({ data: { menuId: menu.id, categoryId: category.id, slug: 'burger', sortOrder: 1, basePrice: 5000, translations: names('برغر', 'Burger') } })).id;
  const areaId = dataOf(await run(manager, createPosArea, { name: 'Hall' })).areaId;
  await run(manager, createPosTables, { areaId, from: 1, to: 4 });
  tables = await prisma().posTable.findMany({ where: { restaurantId: a.id }, orderBy: { number: 'asc' }, select: { id: true } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

async function liveOrder(tableId: string, who: Person = cashier) {
  const opened = dataOf(await run(who, openPosOrder, { tableId }));
  const added = dataOf(await run(who, addPosLine, { orderId: opened.orderId, productId: burger, quantity: 2, note: 'no onion', optionIds: [], expectedVersion: opened.version }));
  return { orderId: opened.orderId, version: added.version };
}

const snapshot = async (who: Person = cashier) => dataOf(await ask(who, posSyncSnapshot, {}));

describe('the offline read cache', () => {
  it('holds the floor, the catalog, the rates and the live orders with their versions', async () => {
    const o = await liveOrder(tables[0]!.id);
    const s = await snapshot();
    expect(s.restaurantId).toBe(a.id);
    expect(s.areas).toHaveLength(1);
    expect(s.areas[0]?.tables).toHaveLength(4);
    expect(s.rates).toEqual({ serviceRatePercent: 0, taxRatePercent: 10 });
    expect(s.catalog?.products.map((p) => p.id)).toEqual([burger]);
    expect(s.orders).toHaveLength(1);
    expect(s.orders[0]).toMatchObject({ id: o.orderId, version: o.version, tableId: tables[0]!.id, status: 'OPEN' });
    expect(s.orders[0]?.lines[0]).toMatchObject({ name: 'برغر', quantity: 2, unitPrice: 5000, note: 'no onion', sent: false, cancelled: false });
  });

  it('leaves out paid and cancelled orders, and the orders of another restaurant', async () => {
    dataOf(await run(cashier, openPosShift, { openingFloat: 0 }));
    const paid = await liveOrder(tables[0]!.id);
    dataOf(await run(cashier, payPosOrder, { orderId: paid.orderId, expectedVersion: paid.version, expectedTotal: 11_000, amountReceived: 11_000, method: 'CASH' }));
    const cancelled = await liveOrder(tables[1]!.id);
    dataOf(await run(cashier, cancelPosOrder, { orderId: cancelled.orderId, expectedVersion: cancelled.version, reason: 'left' }));
    const kept = await liveOrder(tables[2]!.id);
    expect((await snapshot()).orders.map((o) => o.id)).toEqual([kept.orderId]);
    const other = await snapshot(bCashier);
    expect(other.restaurantId).toBe(b.id);
    expect(other.orders).toEqual([]);
    expect(other.areas).toEqual([]);
  });

  it('carries the own open shift of the person, and none for someone without one', async () => {
    expect((await snapshot()).openShift).toBeNull();
    const shiftId = dataOf(await run(cashier, openPosShift, { openingFloat: 0 })).shiftId;
    expect((await snapshot()).openShift).toEqual({ id: shiftId });
    expect((await snapshot(manager)).openShift).toBeNull();
  });

  it('says what the role may do, and refuses a kitchen member', async () => {
    expect((await snapshot()).user.can).toEqual({ discount: true, cancel: true, pay: true });
    expect((await snapshot(manager)).user.can).toEqual({ discount: true, cancel: true, pay: true });
    expect(codeOf(await ask(kitchen, posSyncSnapshot, {}))).toBe('FORBIDDEN');
  });

  it('is refused while the Cashier subscription is not live', async () => {
    await prisma().subscription.updateMany({ where: { restaurantId: a.id }, data: { status: 'CANCELLED' } });
    expect(codeOf(await ask(cashier, posSyncSnapshot, {}))).not.toBe('OK');
  });

  it('holds no secret at any depth', async () => {
    await liveOrder(tables[0]!.id);
    const text = JSON.stringify(await snapshot());
    expect(text).not.toMatch(/"(token|password|secret|session|cookie)[A-Za-z]*"\s*:/i);
  });
});
