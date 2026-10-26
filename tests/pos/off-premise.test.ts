import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { openPosOffPremiseOrder, updatePosOffPremiseDetails } from '@/server/studio/actions/pos-delivery';
import { posRecentCustomer } from '@/server/studio/queries/pos-delivery';
import { openOffPremiseIn } from '@/server/pos/off-premise';
import { delegates } from '@/server/data/tenant-db';
import { ask, codeOf, dataOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };
let b: { id: string };
let cashier: Person;
let kitchen: Person;
let bCashier: Person;

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  await resetWorld();
  a = await restaurant('Off A');
  b = await restaurant('Off B');
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  kitchen = await person('kitchen', { staff: [a.id, 'KITCHEN'] });
  bCashier = await person('bcashier', { staff: [b.id, 'CASHIER'] });
  for (const id of [a.id, b.id]) {
    await prisma().posSettings.upsert({ where: { restaurantId: id }, create: { restaurantId: id, takeawayEnabled: true, deliveryEnabled: true }, update: { takeawayEnabled: true, deliveryEnabled: true } });
  }
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

const delivery = { kind: 'DELIVERY', customerName: 'Sara', customerPhone: '٠٧٧٠١٢٣٤٥٦٧', address: 'Street 5', addressNote: '', zoneId: null, deliveryFee: null } as const;

describe('opening', () => {
  it('numbers takeaway and delivery together per Baghdad day', async () => {
    const one = dataOf(await run(cashier, openPosOffPremiseOrder, { kind: 'TAKEAWAY', customerName: '', customerPhone: '' }));
    const two = dataOf(await run(cashier, openPosOffPremiseOrder, delivery));
    expect([one.queueNumber, two.queueNumber]).toEqual([1, 2]);
    const order = await prisma().posOrder.findUniqueOrThrow({ where: { id: two.orderId } });
    expect(order).toMatchObject({ kind: 'DELIVERY', tableId: null, customerPhone: '07701234567', fulfillment: 'NEW' });
    const later = await prisma().$transaction((tx) => openOffPremiseIn(delegates(tx as never), a.id, { kind: 'TAKEAWAY', customerName: '', customerPhone: '' }, new Date(Date.now() + 36 * 3600_000)));
    expect(later.queueNumber).toBe(1);
  });

  it('gives ten concurrent opens distinct numbers', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => run(cashier, openPosOffPremiseOrder, { kind: 'TAKEAWAY', customerName: '', customerPhone: '' })));
    const queue = results.map((r) => dataOf(r).queueNumber);
    expect(new Set(queue).size).toBe(10);
  });

  it('refuses while the type is switched off, and a delivery without phone or address', async () => {
    expect(codeOf(await run(cashier, openPosOffPremiseOrder, { ...delivery, customerPhone: '' }))).toBe('INVALID');
    expect(codeOf(await run(cashier, openPosOffPremiseOrder, { ...delivery, address: '  ' }))).toBe('INVALID');
    await prisma().posSettings.update({ where: { restaurantId: a.id }, data: { deliveryEnabled: false } });
    expect(codeOf(await run(cashier, openPosOffPremiseOrder, delivery))).toBe('CONFLICT');
    expect(codeOf(await run(kitchen, openPosOffPremiseOrder, { kind: 'TAKEAWAY', customerName: '', customerPhone: '' }))).toBe('FORBIDDEN');
  });

  it('copies a zone, lets the typed fee win, and refuses inactive or foreign zones', async () => {
    const zone = await prisma().posDeliveryZone.create({ data: { restaurantId: a.id, name: 'Karrada', fee: 3000 } });
    const off = await prisma().posDeliveryZone.create({ data: { restaurantId: a.id, name: 'Off', fee: 1, active: false } });
    const foreign = await prisma().posDeliveryZone.create({ data: { restaurantId: b.id, name: 'Other', fee: 1 } });
    const first = dataOf(await run(cashier, openPosOffPremiseOrder, { ...delivery, zoneId: zone.id }));
    expect(await prisma().posOrder.findUniqueOrThrow({ where: { id: first.orderId } })).toMatchObject({ deliveryZoneName: 'Karrada', deliveryFee: 3000 });
    const second = dataOf(await run(cashier, openPosOffPremiseOrder, { ...delivery, zoneId: zone.id, deliveryFee: 500 }));
    expect((await prisma().posOrder.findUniqueOrThrow({ where: { id: second.orderId } })).deliveryFee).toBe(500);
    for (const id of [off.id, foreign.id]) expect(codeOf(await run(cashier, openPosOffPremiseOrder, { ...delivery, zoneId: id }))).toBe('NOT_FOUND');
  });

  it('keeps phone and address out of the audit and round-trips a long Arabic address', async () => {
    const address = 'حي الكرادة، شارع ' + 'ا'.repeat(280);
    const done = dataOf(await run(cashier, openPosOffPremiseOrder, { ...delivery, address }));
    expect((await prisma().posOrder.findUniqueOrThrow({ where: { id: done.orderId } })).address).toBe(address);
    const audit = JSON.stringify(await prisma().auditLog.findMany({ where: { restaurantId: a.id } }));
    expect(audit).not.toContain('07701234567');
    expect(audit).not.toContain('الكرادة');
  });
});

describe('details', () => {
  it('edits details, reopens a requested bill on a fee change, and refuses a stale version', async () => {
    const done = dataOf(await run(cashier, openPosOffPremiseOrder, delivery));
    const edited = dataOf(await run(cashier, updatePosOffPremiseDetails, { orderId: done.orderId, expectedVersion: done.version, address: 'New street', deliveryFee: 2000 }));
    expect(edited.version).toBeGreaterThan(done.version);
    expect(codeOf(await run(cashier, updatePosOffPremiseDetails, { orderId: done.orderId, expectedVersion: done.version, address: 'Again' }))).toBe('CONFLICT');
    await prisma().posOrder.update({ where: { id: done.orderId }, data: { status: 'BILL_REQUESTED' } });
    const fresh = await prisma().posOrder.findUniqueOrThrow({ where: { id: done.orderId } });
    dataOf(await run(cashier, updatePosOffPremiseDetails, { orderId: done.orderId, expectedVersion: fresh.version, deliveryFee: 0 }));
    expect((await prisma().posOrder.findUniqueOrThrow({ where: { id: done.orderId } })).status).toBe('OPEN');
  });

  it('keeps a delivery phone and address, and never reaches another restaurant', async () => {
    const done = dataOf(await run(cashier, openPosOffPremiseOrder, delivery));
    expect(codeOf(await run(cashier, updatePosOffPremiseDetails, { orderId: done.orderId, expectedVersion: done.version, customerPhone: '' }))).toBe('INVALID');
    expect(codeOf(await run(cashier, updatePosOffPremiseDetails, { orderId: done.orderId, expectedVersion: done.version, address: ' ' }))).toBe('INVALID');
    expect(codeOf(await run(bCashier, updatePosOffPremiseDetails, { orderId: done.orderId, expectedVersion: done.version, customerName: 'x' }))).toBe('NOT_FOUND');
  });
});

describe('recent customer', () => {
  it('finds the last delivery by normalized phone, only inside the restaurant', async () => {
    dataOf(await run(cashier, openPosOffPremiseOrder, { ...delivery, customerName: 'Old', address: 'Old street' }));
    dataOf(await run(cashier, openPosOffPremiseOrder, { ...delivery, customerName: 'Sara K', address: 'New street' }));
    const found = dataOf(await ask(cashier, posRecentCustomer, { phone: '0770 123 4567' }));
    expect(found).toMatchObject({ customerName: 'Sara K', address: 'New street' });
    expect(dataOf(await ask(bCashier, posRecentCustomer, { phone: '07701234567' }))).toBeNull();
    expect(dataOf(await ask(cashier, posRecentCustomer, { phone: 'abc' }))).toBeNull();
  });
});

describe('review fixes', () => {
  it('edits the other details of an order whose zone was switched off', async () => {
    const zone = await prisma().posDeliveryZone.create({ data: { restaurantId: a.id, name: 'Karrada', fee: 3000 } });
    const done = dataOf(await run(cashier, openPosOffPremiseOrder, { ...delivery, zoneId: zone.id }));
    await prisma().posDeliveryZone.update({ where: { id: zone.id }, data: { active: false } });
    dataOf(await run(cashier, updatePosOffPremiseDetails, { orderId: done.orderId, expectedVersion: done.version, customerName: 'Sara K', zoneId: zone.id }));
    expect(await prisma().posOrder.findUniqueOrThrow({ where: { id: done.orderId } })).toMatchObject({ customerName: 'Sara K', deliveryZoneName: 'Karrada', deliveryFee: 3000 });
  });
});
