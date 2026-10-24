import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPosArea,
  createPosTables,
  deletePosArea,
  deletePosTable,
  movePosTable,
  renamePosArea,
} from '@/server/studio/actions/pos';
import { posFloor } from '@/server/studio/queries/pos';
import { ask, codeOf, dataOf, failureOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };
let b: { id: string };
let manager: Person;
let cashier: Person;
let bManager: Person;

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await resetWorld();
  a = await restaurant('Floor A');
  b = await restaurant('Floor B');
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  bManager = await person('bmanager', { staff: [b.id, 'MANAGER'] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

const hall = async (who: Person = manager) => dataOf(await run(who, createPosArea, { name: 'Hall' })).areaId;

describe('areas and tables', () => {
  it('creates an area and tables 1 to 20, and audits both', async () => {
    const areaId = await hall();
    expect(dataOf(await run(manager, createPosTables, { areaId, from: 1, to: 20 })).count).toBe(20);
    const floor = dataOf(await ask(manager, posFloor, {}));
    expect(floor.areas).toHaveLength(1);
    expect(floor.areas[0]!.tables.map((t) => t.number)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    const actions = (await prisma().auditLog.findMany({ where: { restaurantId: a.id }, select: { action: true } })).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['pos.area.create', 'pos.tables.create']));
  });

  it('refuses a range that touches a number in use, and creates none of it', async () => {
    const areaId = await hall();
    dataOf(await run(manager, createPosTables, { areaId, from: 1, to: 20 }));
    const result = await run(manager, createPosTables, { areaId, from: 15, to: 25 });
    expect(codeOf(result)).toBe('CONFLICT');
    expect(await prisma().posTable.count({ where: { restaurantId: a.id } })).toBe(20);
  });

  it('refuses more than 200 tables in one call', async () => {
    const areaId = await hall();
    expect(codeOf(await run(manager, createPosTables, { areaId, from: 1, to: 201 }))).toBe('INVALID');
  });

  it('is for managers only: a cashier may read the floor but change none of it', async () => {
    const areaId = await hall();
    expect(codeOf(await run(cashier, createPosArea, { name: 'Terrace' }))).toBe('FORBIDDEN');
    expect(codeOf(await run(cashier, createPosTables, { areaId, from: 1, to: 2 }))).toBe('FORBIDDEN');
    expect(codeOf(await ask(cashier, posFloor, {}))).toBe('OK');
  });

  it('renames an area and moves a table into another area', async () => {
    const one = await hall();
    const two = dataOf(await run(manager, createPosArea, { name: 'Terrace' })).areaId;
    dataOf(await run(manager, createPosTables, { areaId: one, from: 1, to: 2 }));
    dataOf(await run(manager, renamePosArea, { areaId: one, name: 'Main hall' }));
    const table = await prisma().posTable.findFirstOrThrow({ where: { restaurantId: a.id, number: 1 } });
    dataOf(await run(manager, movePosTable, { tableId: table.id, areaId: two }));
    const floor = dataOf(await ask(manager, posFloor, {}));
    expect(floor.areas.find((x) => x.id === one)).toMatchObject({ name: 'Main hall', tables: [{ number: 2 }] });
    expect(floor.areas.find((x) => x.id === two)!.tables.map((t) => t.number)).toEqual([1]);
  });

  it('refuses to remove a table with a live order, and removes it once the order is finished', async () => {
    const areaId = await hall();
    dataOf(await run(manager, createPosTables, { areaId, from: 1, to: 1 }));
    const table = await prisma().posTable.findFirstOrThrow({ where: { restaurantId: a.id } });
    const order = await prisma().posOrder.create({ data: { restaurantId: a.id, tableId: table.id, number: 1 } });
    expect(codeOf(await run(manager, deletePosTable, { tableId: table.id }))).toBe('CONFLICT');
    expect(codeOf(await run(manager, deletePosArea, { areaId }))).toBe('CONFLICT');
    await prisma().posOrder.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
    dataOf(await run(manager, deletePosTable, { tableId: table.id }));
    expect(await prisma().posTable.count({ where: { restaurantId: a.id } })).toBe(0);
    expect(await prisma().posOrder.count({ where: { restaurantId: a.id } })).toBe(1);
  });
});

describe('two restaurants', () => {
  it('never show or touch each other’s floor', async () => {
    const aArea = await hall();
    dataOf(await run(manager, createPosTables, { areaId: aArea, from: 1, to: 3 }));
    const aTable = await prisma().posTable.findFirstOrThrow({ where: { restaurantId: a.id } });
    expect(dataOf(await ask(bManager, posFloor, {})).areas).toEqual([]);
    expect(failureOf(await run(bManager, renamePosArea, { areaId: aArea, name: 'Mine now' })).code).toBe('NOT_FOUND');
    expect(failureOf(await run(bManager, deletePosTable, { tableId: aTable.id })).code).toBe('NOT_FOUND');
    expect(codeOf(await run(bManager, createPosTables, { areaId: aArea, from: 10, to: 11 }))).toBe('NOT_FOUND');
    // The same numbers are free in B: numbering is per restaurant.
    const bArea = await hall(bManager);
    expect(dataOf(await run(bManager, createPosTables, { areaId: bArea, from: 1, to: 3 })).count).toBe(3);
  });
});
