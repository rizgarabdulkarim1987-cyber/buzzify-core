import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpAnswer } from '@/lib/pos-sync/op-schema';
import { applyOperations } from '@/server/pos/sync';
import { localClock } from '@/server/domain/schedule';
import { createPosArea, createPosTables } from '@/server/studio/actions/pos';
import { addPosLine, cancelPosOrder, openPosOrder } from '@/server/studio/actions/pos-orders';
import { closePosShift, openPosShift } from '@/server/studio/actions/pos-shifts';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { dataOf, META, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };
let b: { id: string };
let cashier: Person;
let cashier2: Person;
let manager: Person;
let kitchen: Person;
let bCashier: Person;
let tables: { id: string; number: number }[];
let burger: string;
const device = randomUUID();

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
  cashier2 = await person('cashier2', { staff: [a.id, 'CASHIER'] });
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  kitchen = await person('kitchen', { staff: [a.id, 'KITCHEN'] });
  bCashier = await person('bcashier', { staff: [b.id, 'CASHIER'] });
  const menu = await prisma().menu.create({
    data: { restaurantId: a.id, name: 'm', slug: 'menu-a', currency: 'IQD', locales: ['ar', 'en'], defaultLocale: 'ar', timezone: 'Asia/Baghdad' },
  });
  await prisma().posSettings.upsert({
    where: { restaurantId: a.id },
    create: { restaurantId: a.id, catalogMenuId: menu.id, kitchenPrintEnabled: true, taxRatePercent: 10 },
    update: { catalogMenuId: menu.id, kitchenPrintEnabled: true, taxRatePercent: 10 },
  });
  const category = await prisma().category.create({ data: { menuId: menu.id, slug: 'food', sortOrder: 1, translations: names('أكل', 'Food') } });
  burger = (await prisma().product.create({ data: { menuId: menu.id, categoryId: category.id, slug: 'burger', sortOrder: 1, basePrice: 5000, translations: names('برغر', 'Burger') } })).id;
  const areaId = dataOf(await run(manager, createPosArea, { name: 'Hall' })).areaId;
  await run(manager, createPosTables, { areaId, from: 1, to: 3 });
  tables = await prisma().posTable.findMany({ where: { restaurantId: a.id }, orderBy: { number: 'asc' }, select: { id: true, number: true } });
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

const at = '2026-10-25T08:00:00.000Z';
const uuid = () => randomUUID();

type Draft = Record<string, unknown>;
const open = (tableId: string, operationId = uuid()): Draft => ({ operationId, deviceId: device, clientAt: at, kind: 'openOrder', payload: { tableId } });
const onOrder = (kind: string, ref: { id: string } | { op: string }, expectedVersion: number, payload: object = {}, operationId = uuid()): Draft => ({
  operationId,
  deviceId: device,
  clientAt: at,
  kind,
  orderRef: ref,
  expectedVersion,
  payload,
});
const line = (ref: { id: string } | { op: string }, version: number, quantity = 1) =>
  onOrder('addLine', ref, version, { productId: burger, quantity, note: '', optionIds: [] });

const send = async (who: Person, ops: Draft[]): Promise<OpAnswer[]> => {
  const actor = (await loadActor(prisma(), who.userId)) as Actor;
  return (await applyOperations({ prisma: prisma(), actor, meta: META }, device, ops)) ?? [];
};
const codes = (answers: OpAnswer[]) => answers.map((x) => (x.status === 'error' ? x.code : x.status === 'done' ? (x.replayed ? 'replayed' : 'done') : 'skipped'));

/** An offline sale: open a table, two burgers, send to the kitchen, pay cash (with 10% tax the total is 11,000). */
function sale(tableId: string) {
  const openId = uuid();
  return {
    openId,
    ops: [
      open(tableId, openId),
      line({ op: openId }, 1, 2),
      onOrder('sendToKitchen', { op: openId }, 2),
      onOrder('payCash', { op: openId }, 3, { expectedTotal: 11_000, amountReceived: 12_000 }),
    ],
  };
}

describe('replaying an offline sale', () => {
  it('opens, adds, sends and pays in order, in the cashier open shift, on the server clock', async () => {
    const { ops } = sale(tables[0]!.id);
    const answers = await send(cashier, ops);
    expect(codes(answers)).toEqual(['done', 'done', 'done', 'done']);
    const order = await prisma().posOrder.findFirstOrThrow({ where: { restaurantId: a.id }, include: { payment: true, lines: true } });
    expect(order.status).toBe('PAID');
    expect(order.lines).toHaveLength(1);
    expect(order.lines[0]?.sentAt).not.toBeNull();
    expect(order.payment?.amountReceived).toBe(12_000);
    const shift = await prisma().posShift.findFirstOrThrow({ where: { restaurantId: a.id, userId: cashier.userId } });
    expect(order.payment?.shiftId).toBe(shift.id);
    expect(order.payment!.paidAt.getTime()).toBeGreaterThan(new Date(at).getTime());
    const stored = await prisma().posSyncOperation.findMany({ where: { restaurantId: a.id } });
    expect(stored).toHaveLength(4);
    expect(stored.every((row) => row.clientAt.toISOString() === at)).toBe(true);
    expect(await prisma().auditLog.count({ where: { action: 'pos.sync.apply' } })).toBe(4);
  });

  it('sends the whole batch again: every answer is the stored one and nothing changes', async () => {
    const { ops } = sale(tables[0]!.id);
    const first = await send(cashier, ops);
    const before = { orders: await prisma().posOrder.count(), lines: await prisma().posOrderLine.count(), payments: await prisma().posPayment.count(), audit: await prisma().auditLog.count() };
    const again = await send(cashier, ops);
    expect(codes(again)).toEqual(['replayed', 'replayed', 'replayed', 'replayed']);
    expect(again.map((x) => (x.status === 'done' ? x.result : null))).toEqual(first.map((x) => (x.status === 'done' ? x.result : null)));
    expect({ orders: await prisma().posOrder.count(), lines: await prisma().posOrderLine.count(), payments: await prisma().posPayment.count(), audit: await prisma().auditLog.count() }).toEqual(before);
  });

  it('refuses the same operation id with another amount, and changes nothing', async () => {
    const { ops } = sale(tables[0]!.id);
    await send(cashier, ops);
    const changed = { ...(ops[3] as Draft), payload: { expectedTotal: 11_000, amountReceived: 20_000 } };
    expect(codes(await send(cashier, [changed]))).toEqual(['operationMismatch']);
    expect((await prisma().posPayment.findFirstOrThrow()).amountReceived).toBe(12_000);
  });

  it('refuses another person replaying the id', async () => {
    const { ops } = sale(tables[0]!.id);
    await send(cashier, ops);
    dataOf(await run(cashier2, openPosShift, { openingFloat: 0 }));
    expect(codes(await send(cashier2, [ops[3]!]))).toEqual(['wrongActor']);
  });
});

describe('conflicts', () => {
  it('stops an order on a stale version, skips its later operations and still applies another order', async () => {
    const opened = dataOf(await run(cashier, openPosOrder, { tableId: tables[0]!.id }));
    // Someone else added a line: the device still holds version 1.
    dataOf(await run(manager, addPosLine, { orderId: opened.orderId, productId: burger, quantity: 1, note: '', optionIds: [], expectedVersion: 1 }));
    const other = sale(tables[1]!.id);
    const answers = await send(cashier, [
      line({ id: opened.orderId }, 1),
      onOrder('sendToKitchen', { id: opened.orderId }, 2),
      ...other.ops,
    ]);
    expect(codes(answers)).toEqual(['stale', 'skipped', 'done', 'done', 'done', 'done']);
    expect(answers[0]).toMatchObject({ currentVersion: 2 });
    expect(await prisma().posOrderLine.count({ where: { orderId: opened.orderId } })).toBe(1);
  });

  it('says locked, with the status, for an order cancelled elsewhere', async () => {
    const opened = dataOf(await run(cashier, openPosOrder, { tableId: tables[0]!.id }));
    const added = dataOf(await run(cashier, addPosLine, { orderId: opened.orderId, productId: burger, quantity: 1, note: '', optionIds: [], expectedVersion: 1 }));
    dataOf(await run(manager, cancelPosOrder, { orderId: opened.orderId, expectedVersion: added.version, reason: 'left' }));
    const answers = await send(cashier, [line({ id: opened.orderId }, added.version), onOrder('payCash', { id: opened.orderId }, added.version, { expectedTotal: 5500, amountReceived: 6000 })]);
    expect(codes(answers)).toEqual(['locked', 'skipped']);
    expect(answers[0]).toMatchObject({ orderStatus: 'CANCELLED' });
    expect(await prisma().posPayment.count()).toBe(0);
  });

  it('says totalChanged with both amounts when the rate moved meanwhile, and takes nothing', async () => {
    const openId = uuid();
    const ops = [open(tables[0]!.id, openId), line({ op: openId }, 1, 2)];
    await send(cashier, ops);
    await prisma().posSettings.update({ where: { restaurantId: a.id }, data: { taxRatePercent: 20 } });
    const answers = await send(cashier, [onOrder('payCash', { op: openId }, 2, { expectedTotal: 11_000, amountReceived: 12_000 })]);
    expect(codes(answers)).toEqual(['totalChanged']);
    expect(answers[0]).toMatchObject({ detail: { expectedTotal: 11_000, total: 12_000 } });
    expect(await prisma().posPayment.count()).toBe(0);
  });

  it('says tableOccupied when another device opened the table first', async () => {
    dataOf(await run(cashier2, openPosOrder, { tableId: tables[0]!.id }));
    const answers = await send(cashier, sale(tables[0]!.id).ops);
    expect(codes(answers)).toEqual(['tableOccupied', 'skipped', 'skipped', 'skipped']);
  });

  it('says shiftRequired without an open shift, and applies the same operation id once a shift is open', async () => {
    const shift = await prisma().posShift.findFirstOrThrow({ where: { userId: cashier.userId } });
    dataOf(await run(cashier, closePosShift, { shiftId: shift.id, countedCash: 0, note: '' }));
    const { ops } = sale(tables[0]!.id);
    expect(codes(await send(cashier, ops))).toEqual(['done', 'done', 'done', 'shiftRequired']);
    dataOf(await run(cashier, openPosShift, { openingFloat: 0 }));
    expect(codes(await send(cashier, ops))).toEqual(['replayed', 'replayed', 'replayed', 'done']);
    expect(await prisma().posPayment.count()).toBe(1);
  });

  it('says unknownRef for an order opened by an operation the server never saw', async () => {
    expect(codes(await send(cashier, [onOrder('requestBill', { op: uuid() }, 2)]))).toEqual(['unknownRef']);
  });

  it('says invalid for a malformed operation and keeps going', async () => {
    const answers = await send(cashier, [{ operationId: uuid(), kind: 'openShift' }, ...sale(tables[0]!.id).ops]);
    expect(codes(answers)).toEqual(['invalid', 'done', 'done', 'done', 'done']);
  });

  it('refuses a kitchen member on every kind', async () => {
    const answers = await send(kitchen, sale(tables[0]!.id).ops);
    expect(codes(answers)).toEqual(['forbidden', 'skipped', 'skipped', 'skipped']);
  });
});

describe('another restaurant', () => {
  it('can neither reach an order by id nor find an operation by its id', async () => {
    const { ops } = sale(tables[0]!.id);
    await send(cashier, ops);
    const order = await prisma().posOrder.findFirstOrThrow({ where: { restaurantId: a.id } });
    const attempt = await send(bCashier, [onOrder('requestBill', { id: order.id }, 1)]);
    expect(codes(attempt)).toEqual(['unknownRef']);
    // The same operation id in restaurant B is a fresh operation there (its table does not exist: invalid), never A's stored answer.
    const replayed = await send(bCashier, [ops[0]!]);
    expect(codes(replayed)).toEqual(['invalid']);
    expect(await prisma().posSyncOperation.count({ where: { restaurantId: b.id } })).toBe(0);
  });

  it('answers a person without a till with null', async () => {
    const nobody = await person('nobody');
    const actor = (await loadActor(prisma(), nobody.userId)) as Actor;
    expect(await applyOperations({ prisma: prisma(), actor, meta: META }, device, [open(tables[0]!.id)])).toBeNull();
  });
});


describe('replaying a sale whose menu offer ended while the device was offline', () => {
  it('prices the line at the time it was tapped, so the total the device showed is the total the server asks for', async () => {
    await prisma().restaurant.update({ where: { id: a.id }, data: { plan: 'PRO' } });
    const menu = await prisma().menu.findFirstOrThrow({ where: { restaurantId: a.id } });
    // Live from two hours to half an hour ago, in the menu's own clock: over by the time the device is back online.
    const minute = localClock(new Date(), 'Asia/Baghdad').minute;
    const wrap = (m: number) => (m + 1440) % 1440;
    await prisma().promotion.create({
      data: { menuId: menu.id, kind: 'DISCOUNT', percentOff: 20, productIds: [burger], startMinute: wrap(minute - 120), endMinute: wrap(minute - 30), translations: { en: { title: 'Lunch', text: '' } } },
    });
    const tapped = new Date(Date.now() - 60 * 60_000).toISOString();
    const openId = uuid();
    const withTime = (draft: Draft): Draft => ({ ...draft, clientAt: tapped });
    const answers = await send(cashier, [
      withTime(open(tables[0]!.id, openId)),
      withTime(line({ op: openId }, 1, 2)),
      // 2 x 5,000 less 20% = 8,000, plus 10% tax = 8,800.
      withTime(onOrder('payCash', { op: openId }, 2, { expectedTotal: 8_800, amountReceived: 9_000 })),
    ]);
    expect(codes(answers)).toEqual(['done', 'done', 'done']);
    const stored = await prisma().posOrderLine.findFirstOrThrow({ where: { restaurantId: a.id } });
    expect(stored).toMatchObject({ unitPriceSnapshot: 5000, promoDiscountPerUnit: 1000 });
  });
});
