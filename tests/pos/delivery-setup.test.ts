import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPosDriver, createPosZone, deletePosZone, updatePosDriver, updatePosZone } from '@/server/studio/actions/pos-delivery';
import { posDeliveryOptions, posDeliverySetup } from '@/server/studio/queries/pos-delivery';
import { ask, codeOf, dataOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };
let b: { id: string };
let manager: Person;
let cashier: Person;
let kitchen: Person;
let bManager: Person;

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  await resetWorld();
  a = await restaurant('Delivery A');
  b = await restaurant('Delivery B');
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  kitchen = await person('kitchen', { staff: [a.id, 'KITCHEN'] });
  bManager = await person('bmanager', { staff: [b.id, 'MANAGER'] });
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

describe('delivery zones', () => {
  it('creates, renames, re-prices, deactivates and deletes a zone, with an audit row each time', async () => {
    const zoneId = dataOf(await run(manager, createPosZone, { name: 'Karrada', fee: 3000 })).zoneId;
    dataOf(await run(manager, updatePosZone, { zoneId, name: 'Al Karrada', fee: 3500 }));
    dataOf(await run(manager, updatePosZone, { zoneId, active: false }));
    expect(await prisma().posDeliveryZone.findUniqueOrThrow({ where: { id: zoneId } })).toMatchObject({ name: 'Al Karrada', fee: 3500, active: false });
    dataOf(await run(manager, deletePosZone, { zoneId }));
    expect(await prisma().posDeliveryZone.count({ where: { restaurantId: a.id } })).toBe(0);
    const rows = await prisma().auditLog.findMany({ where: { restaurantId: a.id, action: { startsWith: 'pos.zone.' } }, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] });
    expect(rows.map((row) => row.action).sort()).toEqual(['pos.zone.create', 'pos.zone.delete', 'pos.zone.update', 'pos.zone.update']);
  });

  it('refuses a name that differs only by case, but allows it in another restaurant', async () => {
    dataOf(await run(manager, createPosZone, { name: 'Mansour', fee: 2000 }));
    expect(codeOf(await run(manager, createPosZone, { name: 'MANSOUR', fee: 1000 }))).toBe('CONFLICT');
    dataOf(await run(bManager, createPosZone, { name: 'Mansour', fee: 1000 }));
  });

  it('refuses a fee that is negative or not whole, and the 51st zone', async () => {
    expect(codeOf(await run(manager, createPosZone, { name: 'X', fee: -1 }))).toBe('INVALID');
    expect(codeOf(await run(manager, createPosZone, { name: 'X', fee: 10.5 }))).toBe('INVALID');
    await prisma().posDeliveryZone.createMany({ data: Array.from({ length: 50 }, (_, i) => ({ restaurantId: a.id, name: `Z${i}`, fee: 0, sortOrder: i })) });
    expect(codeOf(await run(manager, createPosZone, { name: 'One too many', fee: 0 }))).toBe('CONFLICT');
  });

  it('is for managers: the cashier and the kitchen are refused', async () => {
    for (const who of [cashier, kitchen]) expect(codeOf(await run(who, createPosZone, { name: 'No', fee: 0 }))).toBe('FORBIDDEN');
    expect((await ask(cashier, posDeliverySetup, {})).ok).toBe(false);
  });
});

describe('drivers', () => {
  it('stores an Arabic-Indic phone as ASCII digits, deactivates, and keeps no phone in the audit', async () => {
    const driverId = dataOf(await run(manager, createPosDriver, { name: 'Ali', phone: '٠٧٧٠ ١٢٣-٤٥٦٧' })).driverId;
    expect((await prisma().posDriver.findUniqueOrThrow({ where: { id: driverId } })).phone).toBe('07701234567');
    dataOf(await run(manager, updatePosDriver, { driverId, active: false, name: 'Ali K' }));
    expect(await prisma().posDriver.findUniqueOrThrow({ where: { id: driverId } })).toMatchObject({ active: false, name: 'Ali K' });
    const audit = JSON.stringify(await prisma().auditLog.findMany({ where: { restaurantId: a.id, action: { startsWith: 'pos.driver.' } } }));
    expect(audit).not.toContain('07701234567');
    expect(audit).not.toContain('٠٧٧٠');
  });

  it('refuses a bad phone, accepts none, and refuses the 101st driver', async () => {
    expect(codeOf(await run(manager, createPosDriver, { name: 'Bad', phone: 'abc' }))).toBe('INVALID');
    dataOf(await run(manager, createPosDriver, { name: 'No phone', phone: '' }));
    await prisma().posDriver.createMany({ data: Array.from({ length: 99 }, (_, i) => ({ restaurantId: a.id, name: `D${i}` })) });
    expect(codeOf(await run(manager, createPosDriver, { name: 'One too many', phone: '' }))).toBe('CONFLICT');
  });
});

describe('reading the lists', () => {
  it('shows every row to the manager and only active rows to the order screen', async () => {
    const zoneId = dataOf(await run(manager, createPosZone, { name: 'Old', fee: 1 })).zoneId;
    dataOf(await run(manager, createPosZone, { name: 'New', fee: 2 }));
    dataOf(await run(manager, updatePosZone, { zoneId, active: false }));
    const driverId = dataOf(await run(manager, createPosDriver, { name: 'Gone', phone: '' })).driverId;
    dataOf(await run(manager, updatePosDriver, { driverId, active: false }));
    dataOf(await run(manager, createPosDriver, { name: 'Here', phone: '' }));
    const all = dataOf(await ask(manager, posDeliverySetup, {}));
    expect([all.zones.length, all.drivers.length]).toEqual([2, 2]);
    const options = dataOf(await ask(cashier, posDeliveryOptions, {}));
    expect(options.zones.map((z) => z.name)).toEqual(['New']);
    expect(options.drivers.map((d) => d.name)).toEqual(['Here']);
    expect((await ask(kitchen, posDeliveryOptions, {})).ok).toBe(false);
  });

  it('never reaches another restaurant: a zone or driver of A is NOT_FOUND for the manager of B', async () => {
    const zoneId = dataOf(await run(manager, createPosZone, { name: 'Private', fee: 1 })).zoneId;
    const driverId = dataOf(await run(manager, createPosDriver, { name: 'Private', phone: '' })).driverId;
    expect(codeOf(await run(bManager, updatePosZone, { zoneId, fee: 9 }))).toBe('NOT_FOUND');
    expect(codeOf(await run(bManager, deletePosZone, { zoneId }))).toBe('NOT_FOUND');
    expect(codeOf(await run(bManager, updatePosDriver, { driverId, active: false }))).toBe('NOT_FOUND');
    expect(dataOf(await ask(bManager, posDeliverySetup, {})).zones).toEqual([]);
    expect(await prisma().posDeliveryZone.count({ where: { restaurantId: a.id } })).toBe(1);
  });
});
