import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpAnswer } from '@/lib/pos-sync/op-schema';
import { applyOperations } from '@/server/pos/sync';
import { createPosArea, createPosTables } from '@/server/studio/actions/pos';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { dataOf, META, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';
import { addPosLine, openPosOrder } from '@/server/studio/actions/pos-orders';
import { payPosOrder } from '@/server/studio/actions/pos-payments';
import { openPosShift } from '@/server/studio/actions/pos-shifts';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };
let b: { id: string };
let cashier: Person;
let manager: Person;
let bCashier: Person;
let paidOrder = '';
const device = randomUUID();
const at = '2026-10-29T08:00:00.000Z';

const names = (ar: string, en = ar) => ({ ar: { name: ar }, en: { name: en } });

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await resetWorld();
  a = await restaurant('Print Sync A');
  b = await restaurant('Print Sync B');
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  bCashier = await person('bcashier', { staff: [b.id, 'CASHIER'] });
  const menu = await prisma().menu.create({
    data: { restaurantId: a.id, name: 'm', slug: 'menu-a', currency: 'IQD', locales: ['ar', 'en'], defaultLocale: 'ar', timezone: 'Asia/Baghdad' },
  });
  await prisma().posSettings.upsert({ where: { restaurantId: a.id }, create: { restaurantId: a.id, catalogMenuId: menu.id, requireApproval: false }, update: { catalogMenuId: menu.id, requireApproval: false } });
  const category = await prisma().category.create({ data: { menuId: menu.id, slug: 'food', sortOrder: 1, translations: names('أكل', 'Food') } });
  const burger = (await prisma().product.create({ data: { menuId: menu.id, categoryId: category.id, slug: 'burger', sortOrder: 1, basePrice: 5000, translations: names('برغر', 'Burger') } })).id;
  const areaId = dataOf(await run(manager, createPosArea, { name: 'Hall' })).areaId;
  await run(manager, createPosTables, { areaId, from: 1, to: 1 });
  const tableId = (await prisma().posTable.findFirstOrThrow({ where: { restaurantId: a.id } })).id;
  dataOf(await run(cashier, openPosShift, { openingFloat: 0 }));
  const opened = dataOf(await run(cashier, openPosOrder, { tableId }));
  const added = dataOf(await run(cashier, addPosLine, { orderId: opened.orderId, productId: burger, quantity: 1, note: '', optionIds: [], expectedVersion: opened.version }));
  dataOf(await run(cashier, payPosOrder, { orderId: opened.orderId, expectedVersion: added.version, expectedTotal: 5000, amountReceived: 5000, method: 'CASH' }));
  paidOrder = opened.orderId;
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

const send = async (who: Person, ops: Record<string, unknown>[]): Promise<OpAnswer[]> => {
  const actor = (await loadActor(prisma(), who.userId)) as Actor;
  return (await applyOperations({ prisma: prisma(), actor, meta: META }, device, ops)) ?? [];
};
const codes = (answers: OpAnswer[]) => answers.map((x) => (x.status === 'error' ? x.code : x.status === 'done' ? (x.replayed ? 'replayed' : 'done') : 'skipped'));

const drawerOpen = (reason: string, operationId: string = randomUUID()) => ({ operationId, deviceId: device, clientAt: at, kind: 'drawerOpen', payload: { reason } });
const receiptCopy = (orderId: string, operationId: string = randomUUID()) => ({ operationId, deviceId: device, clientAt: at, kind: 'receiptCopy', orderRef: { id: orderId }, expectedVersion: 1, payload: {} });

describe('drawerOpen', () => {
  it('writes the drawer audit row once, also when the same operation is replayed', async () => {
    const op = drawerOpen('change for a customer');
    expect(codes(await send(cashier, [op]))).toEqual(['done']);
    expect(codes(await send(cashier, [op]))).toEqual(['replayed']);
    expect(await prisma().auditLog.count({ where: { action: 'pos.drawer.open', restaurantId: a.id } })).toBe(1);
  });

  it('needs a reason', async () => {
    expect(codes(await send(cashier, [drawerOpen('')]))).toEqual(['invalid']);
    expect(await prisma().auditLog.count({ where: { action: 'pos.drawer.open' } })).toBe(0);
  });
});

describe('receiptCopy', () => {
  it('writes the reprint audit row for a paid order', async () => {
    expect(codes(await send(cashier, [receiptCopy(paidOrder)]))).toEqual(['done']);
    const payment = await prisma().posPayment.findFirstOrThrow({ where: { orderId: paidOrder } });
    expect(await prisma().auditLog.count({ where: { action: 'pos.receipt.reprint', entityId: payment.id } })).toBe(1);
  });

  it('answers unknownRef for an order the server never saw', async () => {
    expect(codes(await send(cashier, [receiptCopy('ghost')]))).toEqual(['unknownRef']);
  });

  it("answers unknownRef for another restaurant's order", async () => {
    expect(codes(await send(bCashier, [receiptCopy(paidOrder)]))).toEqual(['unknownRef']);
    expect(await prisma().auditLog.count({ where: { action: 'pos.receipt.reprint' } })).toBe(0);
  });
});
