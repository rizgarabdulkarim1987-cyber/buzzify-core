import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPosArea, createPosTables } from '@/server/studio/actions/pos';
import { addPosLine, mergePosOrders, openPosOrder } from '@/server/studio/actions/pos-orders';
import { payPosOrder } from '@/server/studio/actions/pos-payments';
import { openPosShift } from '@/server/studio/actions/pos-shifts';
import { codeOf, dataOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };
let b: { id: string };
let cashier: Person;
let kitchen: Person;
let manager: Person;
let burger: string;
let tables: string[];

const names = (ar: string, en = ar) => ({ ar: { name: ar }, en: { name: en } });

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await resetWorld();
  a = await restaurant('Merge A');
  b = await restaurant('Merge B');
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  kitchen = await person('kitchen', { staff: [a.id, 'KITCHEN'] });
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  const menu = await prisma().menu.create({
    data: { restaurantId: a.id, name: 'm', slug: 'menu-m', currency: 'IQD', locales: ['ar', 'en'], defaultLocale: 'ar', timezone: 'Asia/Baghdad' },
  });
  await prisma().posSettings.upsert({ where: { restaurantId: a.id }, create: { restaurantId: a.id, catalogMenuId: menu.id }, update: { catalogMenuId: menu.id } });
  const category = await prisma().category.create({ data: { menuId: menu.id, slug: 'food', sortOrder: 1, translations: names('أكل', 'Food') } });
  burger = (await prisma().product.create({ data: { menuId: menu.id, categoryId: category.id, slug: 'burger', sortOrder: 1, basePrice: 5000, translations: names('برغر', 'Burger') } })).id;
  const areaId = dataOf(await run(manager, createPosArea, { name: 'Hall' })).areaId;
  await run(manager, createPosTables, { areaId, from: 1, to: 3 });
  tables = (await prisma().posTable.findMany({ where: { restaurantId: a.id }, orderBy: { number: 'asc' } })).map((t) => t.id);
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

/** An order at the nth table with `quantity` burgers. */
async function orderAt(table: number, quantity = 1) {
  const opened = dataOf(await run(cashier, openPosOrder, { tableId: tables[table]! }));
  const added = dataOf(await run(cashier, addPosLine, { orderId: opened.orderId, productId: burger, quantity, note: '', optionIds: [], expectedVersion: opened.version }));
  return { orderId: opened.orderId, lineId: added.lineId, version: added.version };
}

const merge = (who: Person, from: { orderId: string; version: number }, into: { orderId: string; version: number }) =>
  run(who, mergePosOrders, { fromOrderId: from.orderId, intoOrderId: into.orderId, fromVersion: from.version, intoVersion: into.version });

describe('merging two tables', () => {
  it('moves the lines (kitchen state kept) into the other order and cancels the emptied one', async () => {
    const from = await orderAt(0, 2);
    const into = await orderAt(1, 1);
    await prisma().posOrderLine.update({ where: { id: from.lineId }, data: { sentAt: new Date(), batch: 1 } });
    const done = dataOf(await merge(cashier, from, into));
    expect(done.moved).toBe(1);
    const moved = await prisma().posOrderLine.findUniqueOrThrow({ where: { id: from.lineId } });
    expect(moved.orderId).toBe(into.orderId);
    expect(moved.sentAt).not.toBeNull();
    expect(moved.batch).not.toBeNull();
    const target = await prisma().posOrder.findUniqueOrThrow({ where: { id: into.orderId } });
    expect(target.version).toBe(into.version + 1);
    const source = await prisma().posOrder.findUniqueOrThrow({ where: { id: from.orderId } });
    expect(source.status).toBe('CANCELLED');
  });

  it('writes one audit row that names both orders', async () => {
    const from = await orderAt(0);
    const into = await orderAt(1);
    dataOf(await merge(cashier, from, into));
    const rows = await prisma().auditLog.findMany({ where: { action: 'pos.order.merge', restaurantId: a.id } });
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0]!.changes)).toContain(from.orderId);
    expect(rows[0]!.entityId).toBe(into.orderId);
  });

  it('refuses the same order, a stale version, and an order that has payments', async () => {
    const from = await orderAt(0);
    const into = await orderAt(1);
    expect(codeOf(await merge(cashier, from, from))).toBe('CONFLICT');
    expect(codeOf(await merge(cashier, { ...from, version: from.version + 5 }, into))).toBe('CONFLICT');
    const paidOrder = await orderAt(2);
    dataOf(await run(cashier, payPosOrder, { orderId: paidOrder.orderId, expectedVersion: paidOrder.version, expectedTotal: 5000, amountReceived: 5000 }));
    expect(codeOf(await merge(cashier, from, { orderId: paidOrder.orderId, version: paidOrder.version + 1 }))).toBe('CONFLICT');
    expect(await prisma().posOrderLine.count({ where: { orderId: into.orderId } })).toBe(1);
  });

  it('refuses another restaurant’s order and leaves the source open', async () => {
    const from = await orderAt(0);
    const stranger = await prisma().posOrder.create({ data: { restaurantId: b.id, kind: 'DINE_IN', status: 'OPEN', number: 1 } });
    const result = await merge(cashier, from, { orderId: stranger.id, version: stranger.version });
    expect(['NOT_FOUND', 'FORBIDDEN']).toContain(codeOf(result));
    expect(await prisma().posOrder.count({ where: { id: from.orderId, status: 'OPEN' } })).toBe(1);
  });

  it('is for people who handle orders: a cashier merges, the kitchen cannot', async () => {
    const from = await orderAt(0);
    const into = await orderAt(1);
    expect(codeOf(await merge(kitchen, from, into))).toBe('FORBIDDEN');
    expect(codeOf(await merge(cashier, from, into))).toBe('OK');
  });
});
