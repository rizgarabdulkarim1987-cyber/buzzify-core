import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPosArea, createPosTables } from '@/server/studio/actions/pos';
import { addPosLine, cancelPosOrder, openPosOrder, requestPosBill } from '@/server/studio/actions/pos-orders';
import { payPosOrder } from '@/server/studio/actions/pos-payments';
import { openPosShift } from '@/server/studio/actions/pos-shifts';
import { sendPosToKitchen } from '@/server/studio/actions/pos-kitchen';
import { runAction, type ActionDef, type OperationClaim } from '@/server/studio/framework/action';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { findStoredOperation, payloadHash } from '@/server/pos/sync-operation';
import { codeOf, dataOf, META, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };
let b: { id: string };
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
  a = await restaurant('Sync A');
  b = await restaurant('Sync B');
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  const menu = await prisma().menu.create({
    data: { restaurantId: a.id, name: 'm', slug: 'menu-a', currency: 'IQD', locales: ['ar', 'en'], defaultLocale: 'ar', timezone: 'Asia/Baghdad' },
  });
  await prisma().posSettings.upsert({
    where: { restaurantId: a.id },
    create: { restaurantId: a.id, catalogMenuId: menu.id, kitchenPrintEnabled: true },
    update: { catalogMenuId: menu.id, kitchenPrintEnabled: true },
  });
  const category = await prisma().category.create({ data: { menuId: menu.id, slug: 'food', sortOrder: 1, translations: names('أكل', 'Food') } });
  burger = (await prisma().product.create({ data: { menuId: menu.id, categoryId: category.id, slug: 'burger', sortOrder: 1, basePrice: 5000, translations: names('برغر', 'Burger') } })).id;
  const areaId = dataOf(await run(manager, createPosArea, { name: 'Hall' })).areaId;
  await run(manager, createPosTables, { areaId, from: 1, to: 2 });
  tableId = (await prisma().posTable.findFirstOrThrow({ where: { restaurantId: a.id }, orderBy: { number: 'asc' } })).id;
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
const claim = (kind: string, payload: unknown = {}): OperationClaim => ({
  operationId: `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
  kind,
  deviceId: '11111111-1111-4111-8111-111111111111',
  clientAt: new Date('2026-10-25T08:00:00Z'),
  payloadHash: payloadHash(payload),
});

const withClaim = async <I, O>(who: Person, def: ActionDef<I, O>, input: unknown, operation: OperationClaim) =>
  runAction(prisma(), (await loadActor(prisma(), who.userId)) as Actor, def, input, META, { operation });

async function orderOf(quantity = 2) {
  const opened = dataOf(await run(cashier, openPosOrder, { tableId }));
  const added = dataOf(await run(cashier, addPosLine, { orderId: opened.orderId, productId: burger, quantity, note: '', optionIds: [], expectedVersion: opened.version }));
  return { orderId: opened.orderId, version: added.version, total: quantity * 5000 };
}

describe('an operation recorded with its change', () => {
  it('stores the answer and one audit row carrying the device and the client time', async () => {
    const op = claim('openOrder');
    const opened = dataOf(await withClaim(cashier, openPosOrder, { tableId }, op));
    const stored = await findStoredOperation(prisma(), a.id, op.operationId);
    expect(stored).toMatchObject({ kind: 'openOrder', userId: cashier.userId, deviceId: op.deviceId, payloadHash: op.payloadHash });
    expect(stored?.result).toEqual(opened);
    const audit = await prisma().auditLog.findMany({ where: { action: 'pos.sync.apply' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ restaurantId: a.id, entityType: 'PosSyncOperation', entityId: op.operationId });
    expect(audit[0]?.changes).toMatchObject({ clientAt: { after: '2026-10-25T08:00:00.000Z' }, deviceId: { after: op.deviceId } });
  });

  it('applies a payment once: the same operation again changes nothing', async () => {
    const o = await orderOf();
    const pay = claim('payCash');
    const input = { orderId: o.orderId, expectedVersion: o.version, expectedTotal: o.total, amountReceived: 12_000, method: 'CASH' };
    const first = dataOf(await withClaim(cashier, payPosOrder, input, pay));
    expect(first.change).toBe(2_000);
    expect((await withClaim(cashier, payPosOrder, input, pay)).ok).toBe(false);
    expect(await prisma().posPayment.count({ where: { restaurantId: a.id } })).toBe(1);
    expect(await prisma().auditLog.count({ where: { action: 'pos.payment.take' } })).toBe(1);
    expect((await findStoredOperation(prisma(), a.id, pay.operationId))?.result).toEqual(first);
  });

  it('applies a payment once when two sends race', async () => {
    const o = await orderOf();
    const pay = claim('payCash');
    const input = { orderId: o.orderId, expectedVersion: o.version, expectedTotal: o.total, amountReceived: 10_000, method: 'CASH' };
    const results = await Promise.all([withClaim(cashier, payPosOrder, input, pay), withClaim(cashier, payPosOrder, input, pay)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await prisma().posPayment.count({ where: { restaurantId: a.id } })).toBe(1);
    expect(await prisma().posSyncOperation.count({ where: { restaurantId: a.id } })).toBe(1);
  });

  it('stores nothing when the action fails, so a fixed retry can reuse the id', async () => {
    const o = await orderOf();
    const op = claim('payCash');
    const input = { orderId: o.orderId, expectedVersion: o.version, expectedTotal: o.total + 1, amountReceived: 20_000, method: 'CASH' };
    expect(codeOf(await withClaim(cashier, payPosOrder, input, op))).toBe('CONFLICT');
    expect(await findStoredOperation(prisma(), a.id, op.operationId)).toBeNull();
    expect(dataOf(await withClaim(cashier, payPosOrder, { ...input, expectedTotal: o.total }, op)).total).toBe(o.total);
  });

  it('is exactly one version step for each queueable action', async () => {
    const opened = dataOf(await withClaim(cashier, openPosOrder, { tableId }, claim('openOrder')));
    expect(opened.version).toBe(1);
    const added = dataOf(await withClaim(cashier, addPosLine, { orderId: opened.orderId, productId: burger, quantity: 1, note: '', optionIds: [], expectedVersion: 1 }, claim('addLine')));
    expect(added.version).toBe(2);
    const sent = dataOf(await withClaim(cashier, sendPosToKitchen, { orderId: opened.orderId, expectedVersion: 2 }, claim('sendToKitchen')));
    expect(sent.version).toBe(3);
    const billed = dataOf(await withClaim(cashier, requestPosBill, { orderId: opened.orderId, expectedVersion: 3 }, claim('requestBill')));
    expect(billed.version).toBe(4);
    const paid = dataOf(await withClaim(cashier, payPosOrder, { orderId: opened.orderId, expectedVersion: 4, expectedTotal: 5000, amountReceived: 5000, method: 'CASH' }, claim('payCash')));
    expect(paid.total).toBe(5000);
    expect((await prisma().posOrder.findUniqueOrThrow({ where: { id: opened.orderId } })).version).toBe(5);
    const second = dataOf(await run(cashier, openPosOrder, { tableId }));
    const cancelled = dataOf(await withClaim(cashier, cancelPosOrder, { orderId: second.orderId, expectedVersion: 1, reason: '' }, claim('cancelOrder')));
    expect(cancelled.version).toBe(2);
  });

  it('writes no operation row without a claim', async () => {
    await orderOf();
    expect(await prisma().posSyncOperation.count()).toBe(0);
    expect(await prisma().auditLog.count({ where: { action: 'pos.sync.apply' } })).toBe(0);
  });

  it('never finds the operation of one restaurant from another', async () => {
    const op = claim('openOrder');
    dataOf(await withClaim(cashier, openPosOrder, { tableId }, op));
    expect(await findStoredOperation(prisma(), b.id, op.operationId)).toBeNull();
    expect(await findStoredOperation(prisma(), a.id, op.operationId)).not.toBeNull();
  });
});

describe('payloadHash', () => {
  it('ignores key order and tells a changed amount apart', () => {
    expect(payloadHash({ a: 1, b: { c: [1, 2], d: 'x' } })).toBe(payloadHash({ b: { d: 'x', c: [1, 2] }, a: 1 }));
    expect(payloadHash({ amountReceived: 5000 })).not.toBe(payloadHash({ amountReceived: 6000 }));
    expect(payloadHash({ a: 1, b: undefined })).toBe(payloadHash({ a: 1 }));
  });
});
