import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { advancePosFulfillment, assignPosDriver, openPosOffPremiseOrder } from '@/server/studio/actions/pos-delivery';
import { sendPosToKitchen, markPosLinesReady } from '@/server/studio/actions/pos-kitchen';
import { addPosLine, cancelPosOrder } from '@/server/studio/actions/pos-orders';
import { payPosOrder } from '@/server/studio/actions/pos-payments';
import { closePosShift, openPosShift } from '@/server/studio/actions/pos-shifts';
import { posOffPremiseBoard, posOffPremiseFlags } from '@/server/studio/queries/pos-delivery';
import { posKitchenQueue, posShift } from '@/server/studio/queries/pos';
import { ask, codeOf, dataOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };
let b: { id: string };
let cashier: Person;
let kitchen: Person;
let bCashier: Person;
let burger: string;
let driverId: string;

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  await resetWorld();
  a = await restaurant('Fulfil A');
  b = await restaurant('Fulfil B');
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  kitchen = await person('kitchen', { staff: [a.id, 'KITCHEN'] });
  bCashier = await person('bcashier', { staff: [b.id, 'CASHIER'] });
  const menu = await prisma().menu.create({
    data: { restaurantId: a.id, name: 'm', slug: 'menu-a', currency: 'IQD', locales: ['ar', 'en'], defaultLocale: 'ar', timezone: 'Asia/Baghdad' },
  });
  await prisma().posSettings.upsert({
    where: { restaurantId: a.id },
    create: { restaurantId: a.id, requireApproval: false, catalogMenuId: menu.id, takeawayEnabled: true, deliveryEnabled: true },
    update: { requireApproval: false, catalogMenuId: menu.id, takeawayEnabled: true, deliveryEnabled: true },
  });
  const category = await prisma().category.create({ data: { menuId: menu.id, slug: 'food', sortOrder: 1, translations: { ar: { name: 'أكل' }, en: { name: 'Food' } } } });
  burger = (await prisma().product.create({ data: { menuId: menu.id, categoryId: category.id, slug: 'burger', sortOrder: 1, basePrice: 5000, translations: { ar: { name: 'برغر' }, en: { name: 'Burger' } } } })).id;
  driverId = (await prisma().posDriver.create({ data: { restaurantId: a.id, name: 'Ali' } })).id;
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

const takeaway = { kind: 'TAKEAWAY', customerName: '', customerPhone: '' };
const delivery = { kind: 'DELIVERY', customerName: 'Sara', customerPhone: '07701234567', address: 'Street 5', addressNote: '', zoneId: null, deliveryFee: 2000 };

async function open(input: Record<string, unknown>) {
  const opened = dataOf(await run(cashier, openPosOffPremiseOrder, input));
  const added = dataOf(await run(cashier, addPosLine, { orderId: opened.orderId, productId: burger, quantity: 1, note: '', optionIds: [], expectedVersion: opened.version }));
  return { orderId: opened.orderId, version: added.version };
}

const version = async (orderId: string) => (await prisma().posOrder.findUniqueOrThrow({ where: { id: orderId } })).version;

describe('advancing', () => {
  it('walks a delivery through the road: a driver first, then out and delivered, with times', async () => {
    const d = await open(delivery);
    let v = dataOf(await run(cashier, advancePosFulfillment, { orderId: d.orderId, expectedVersion: d.version, to: 'PREPARING' })).version;
    v = dataOf(await run(cashier, advancePosFulfillment, { orderId: d.orderId, expectedVersion: v, to: 'READY' })).version;
    expect(codeOf(await run(cashier, advancePosFulfillment, { orderId: d.orderId, expectedVersion: v, to: 'OUT' }))).toBe('CONFLICT');
    v = dataOf(await run(cashier, assignPosDriver, { orderId: d.orderId, expectedVersion: v, driverId })).version;
    v = dataOf(await run(cashier, advancePosFulfillment, { orderId: d.orderId, expectedVersion: v, to: 'OUT' })).version;
    expect(codeOf(await run(cashier, assignPosDriver, { orderId: d.orderId, expectedVersion: v, driverId: null }))).toBe('CONFLICT');
    v = dataOf(await run(cashier, advancePosFulfillment, { orderId: d.orderId, expectedVersion: v, to: 'READY' })).version;
    v = dataOf(await run(cashier, advancePosFulfillment, { orderId: d.orderId, expectedVersion: v, to: 'OUT' })).version;
    dataOf(await run(cashier, advancePosFulfillment, { orderId: d.orderId, expectedVersion: v, to: 'DELIVERED' }));
    const row = await prisma().posOrder.findUniqueOrThrow({ where: { id: d.orderId } });
    expect(row).toMatchObject({ fulfillment: 'DELIVERED', driverNameSnapshot: 'Ali' });
    expect(row.outAt).not.toBeNull();
    expect(row.doneAt).not.toBeNull();
  });

  it('refuses a skipped step, and a pickup before payment; a paid takeaway is picked up', async () => {
    dataOf(await run(cashier, openPosShift, { openingFloat: 0 }));
    const t = await open(takeaway);
    expect(codeOf(await run(cashier, advancePosFulfillment, { orderId: t.orderId, expectedVersion: t.version, to: 'READY' }))).toBe('CONFLICT');
    let v = dataOf(await run(cashier, advancePosFulfillment, { orderId: t.orderId, expectedVersion: t.version, to: 'PREPARING' })).version;
    v = dataOf(await run(cashier, advancePosFulfillment, { orderId: t.orderId, expectedVersion: v, to: 'READY' })).version;
    expect(codeOf(await run(cashier, advancePosFulfillment, { orderId: t.orderId, expectedVersion: v, to: 'PICKED_UP' }))).toBe('CONFLICT');
    dataOf(await run(cashier, payPosOrder, { orderId: t.orderId, expectedVersion: v, expectedTotal: 5000, amountReceived: 5000 }));
    dataOf(await run(cashier, advancePosFulfillment, { orderId: t.orderId, expectedVersion: await version(t.orderId), to: 'PICKED_UP' }));
    expect((await prisma().posOrder.findUniqueOrThrow({ where: { id: t.orderId } })).fulfillment).toBe('PICKED_UP');
    const board = dataOf(await ask(cashier, posOffPremiseBoard, {}));
    expect(board.takeaway).toEqual([]);
  });

  it('lets exactly one of two simultaneous taps win', async () => {
    const t = await open(takeaway);
    const results = await Promise.all([1, 2].map(() => run(cashier, advancePosFulfillment, { orderId: t.orderId, expectedVersion: t.version, to: 'PREPARING' })));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).map(codeOf)).toEqual(['CONFLICT']);
  });

  it('refuses a cancelled order, an inactive or foreign driver, and another restaurant', async () => {
    const d = await open(delivery);
    const off = (await prisma().posDriver.create({ data: { restaurantId: a.id, name: 'Off', active: false } })).id;
    const foreign = (await prisma().posDriver.create({ data: { restaurantId: b.id, name: 'Far' } })).id;
    expect(codeOf(await run(cashier, assignPosDriver, { orderId: d.orderId, expectedVersion: d.version, driverId: off }))).toBe('CONFLICT');
    expect(codeOf(await run(cashier, assignPosDriver, { orderId: d.orderId, expectedVersion: d.version, driverId: foreign }))).toBe('NOT_FOUND');
    expect(codeOf(await run(bCashier, advancePosFulfillment, { orderId: d.orderId, expectedVersion: d.version, to: 'PREPARING' }))).toBe('NOT_FOUND');
    dataOf(await run(cashier, cancelPosOrder, { orderId: d.orderId, expectedVersion: d.version, reason: 'no' }));
    expect(codeOf(await run(cashier, advancePosFulfillment, { orderId: d.orderId, expectedVersion: await version(d.orderId), to: 'PREPARING' }))).toBe('CONFLICT');
  });
});

describe('the kitchen drives it', () => {
  it('moves NEW to PREPARING on send and PREPARING to READY when the kitchen finishes, with queue number on the card', async () => {
    await prisma().posSettings.update({ where: { restaurantId: a.id }, data: { kitchenScreenEnabled: true } });
    const t = await open(takeaway);
    dataOf(await run(cashier, sendPosToKitchen, { orderId: t.orderId, expectedVersion: t.version }));
    expect((await prisma().posOrder.findUniqueOrThrow({ where: { id: t.orderId } })).fulfillment).toBe('PREPARING');
    const cards = dataOf(await ask(kitchen, posKitchenQueue, {})).cards;
    expect(cards[0]).toMatchObject({ kind: 'TAKEAWAY', queueNumber: 1, tableNumber: null });
    dataOf(await run(kitchen, markPosLinesReady, { lineIds: cards[0]!.lines.map((l) => l.id) }));
    expect(await prisma().posOrder.findUniqueOrThrow({ where: { id: t.orderId } })).toMatchObject({ status: 'READY', fulfillment: 'READY' });
  });
});

describe('cash with the driver', () => {
  it('lists a delivered unpaid order per driver, counts it on the shift screen, and drops it once paid', async () => {
    const shiftId = dataOf(await run(cashier, openPosShift, { openingFloat: 0 })).shiftId;
    const d = await open(delivery);
    let v = d.version;
    for (const to of ['PREPARING', 'READY']) v = dataOf(await run(cashier, advancePosFulfillment, { orderId: d.orderId, expectedVersion: v, to })).version;
    v = dataOf(await run(cashier, assignPosDriver, { orderId: d.orderId, expectedVersion: v, driverId })).version;
    for (const to of ['OUT', 'DELIVERED']) v = dataOf(await run(cashier, advancePosFulfillment, { orderId: d.orderId, expectedVersion: v, to })).version;
    const board = dataOf(await ask(cashier, posOffPremiseBoard, {}));
    expect(board.cashWithDrivers).toEqual([{ driverId, driverName: 'Ali', count: 1, amount: 7000 }]);
    expect(dataOf(await ask(cashier, posShift, { shiftId })).unsettledDeliveries).toEqual({ count: 1, amount: 7000 });
    // The close is not blocked by it.
    dataOf(await run(cashier, payPosOrder, { orderId: d.orderId, expectedVersion: v, expectedTotal: 7000, amountReceived: 7000 }));
    expect(dataOf(await ask(cashier, posShift, { shiftId })).unsettledDeliveries).toEqual({ count: 0, amount: 0 });
    expect((await ask(bCashier, posOffPremiseBoard, {})).ok).toBe(true);
    expect(dataOf(await ask(bCashier, posOffPremiseBoard, {})).delivery).toEqual([]);
    dataOf(await run(cashier, closePosShift, { shiftId, countedCash: 7000, note: '' }));
  });
});

describe('review fixes', () => {
  it('freezes a handed-over order but still lets it be paid', async () => {
    dataOf(await run(cashier, openPosShift, { openingFloat: 0 }));
    const d = await open(delivery);
    let v = d.version;
    for (const to of ['PREPARING', 'READY']) v = dataOf(await run(cashier, advancePosFulfillment, { orderId: d.orderId, expectedVersion: v, to })).version;
    v = dataOf(await run(cashier, assignPosDriver, { orderId: d.orderId, expectedVersion: v, driverId })).version;
    for (const to of ['OUT', 'DELIVERED']) v = dataOf(await run(cashier, advancePosFulfillment, { orderId: d.orderId, expectedVersion: v, to })).version;
    expect(codeOf(await run(cashier, addPosLine, { orderId: d.orderId, productId: burger, quantity: 1, note: '', optionIds: [], expectedVersion: v }))).toBe('CONFLICT');
    expect(codeOf(await run(cashier, sendPosToKitchen, { orderId: d.orderId, expectedVersion: v }))).toBe('CONFLICT');
    dataOf(await run(cashier, payPosOrder, { orderId: d.orderId, expectedVersion: v, expectedTotal: 7000, amountReceived: 7000 }));
  });

  it('makes a prepaid takeaway READY when the kitchen finishes it', async () => {
    dataOf(await run(cashier, openPosShift, { openingFloat: 0 }));
    await prisma().posSettings.update({ where: { restaurantId: a.id }, data: { kitchenScreenEnabled: true } });
    const t = await open(takeaway);
    const sent = dataOf(await run(cashier, sendPosToKitchen, { orderId: t.orderId, expectedVersion: t.version }));
    dataOf(await run(cashier, payPosOrder, { orderId: t.orderId, expectedVersion: sent.version, expectedTotal: 5000, amountReceived: 5000 }));
    const cards = dataOf(await ask(kitchen, posKitchenQueue, {})).cards;
    dataOf(await run(kitchen, markPosLinesReady, { lineIds: cards[0]!.lines.map((l) => l.id) }));
    expect(await prisma().posOrder.findUniqueOrThrow({ where: { id: t.orderId } })).toMatchObject({ status: 'PAID', fulfillment: 'READY' });
  });

  it('keeps a switched-off type reachable while it still has live orders, and shows no unsettled on a closed shift', async () => {
    const shiftId = dataOf(await run(cashier, openPosShift, { openingFloat: 0 })).shiftId;
    const flagsOf = async () => dataOf(await ask(cashier, posOffPremiseFlags, {}));
    await open(delivery);
    await prisma().posSettings.update({ where: { restaurantId: a.id }, data: { deliveryEnabled: false, takeawayEnabled: false } });
    expect(await flagsOf()).toMatchObject({ delivery: true, deliveryOn: false, takeaway: false });
    await prisma().posOrder.deleteMany({ where: { restaurantId: a.id } });
    expect(await flagsOf()).toMatchObject({ delivery: false });
    dataOf(await run(cashier, closePosShift, { shiftId, countedCash: 0, note: '' }));
    expect(dataOf(await ask(cashier, posShift, { shiftId })).unsettledDeliveries).toEqual({ count: 0, amount: 0 });
  });
});
