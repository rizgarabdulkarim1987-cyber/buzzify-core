import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readBoard } from '@/server/pos/board';
import type { AnyDb } from '@/server/data/tenant-db';
import { createPosArea, createPosTables } from '@/server/studio/actions/pos';
import { addPosLine, openPosOrder, requestPosBill } from '@/server/studio/actions/pos-orders';
import { posBoard, posOrder } from '@/server/studio/queries/pos';
import { ask, codeOf, dataOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };
let b: { id: string };
let cashier: Person;
let manager: Person;
let kitchen: Person;
let bManager: Person;
let burger: string;
let hall: string;
let terrace: string;
let tables: { id: string; number: number; areaId: string }[];

const names = (ar: string, en = ar) => ({ ar: { name: ar }, en: { name: en } });

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await resetWorld();
  a = await restaurant('Board A');
  b = await restaurant('Board B');
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  kitchen = await person('kitchen', { staff: [a.id, 'KITCHEN'] });
  bManager = await person('bmanager', { staff: [b.id, 'MANAGER'] });
  const menu = await prisma().menu.create({
    data: { restaurantId: a.id, name: 'm', slug: 'menu-a', currency: 'IQD', locales: ['ar', 'en'], defaultLocale: 'ar', timezone: 'Asia/Baghdad' },
  });
  await prisma().posSettings.upsert({ where: { restaurantId: a.id }, create: { restaurantId: a.id, catalogMenuId: menu.id }, update: { catalogMenuId: menu.id } });
  const category = await prisma().category.create({ data: { menuId: menu.id, slug: 'food', sortOrder: 1, translations: names('أكل', 'Food') } });
  burger = (await prisma().product.create({ data: { menuId: menu.id, categoryId: category.id, slug: 'burger', sortOrder: 1, basePrice: 5000, translations: names('برغر', 'Burger') } })).id;
  hall = dataOf(await run(manager, createPosArea, { name: 'Hall' })).areaId;
  terrace = dataOf(await run(manager, createPosArea, { name: 'Terrace' })).areaId;
  await run(manager, createPosTables, { areaId: hall, from: 1, to: 3 });
  await run(manager, createPosTables, { areaId: terrace, from: 4, to: 5 });
  tables = await prisma().posTable.findMany({ where: { restaurantId: a.id }, orderBy: { number: 'asc' }, select: { id: true, number: true, areaId: true } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

async function seat(number: number, quantity = 1) {
  const table = tables.find((t) => t.number === number)!;
  const opened = dataOf(await run(cashier, openPosOrder, { tableId: table.id }));
  const added = dataOf(await run(cashier, addPosLine, { orderId: opened.orderId, productId: burger, quantity, note: '', optionIds: [], expectedVersion: opened.version }));
  return { orderId: opened.orderId, version: added.version };
}

const board = async (input: object = {}, who: Person = cashier) => dataOf(await ask(who, posBoard, input));

describe('the tables board', () => {
  it('shows free, busy and bill-requested tables with the same total as the order screen', async () => {
    await prisma().posSettings.update({ where: { restaurantId: a.id }, data: { serviceRatePercent: 10, taxRatePercent: 5 } });
    const first = await seat(1, 2);
    const second = await seat(2);
    dataOf(await run(cashier, requestPosBill, { orderId: second.orderId, expectedVersion: second.version }));
    const view = await board();
    const byNumber = new Map(view.tables.map((t) => [t.number, t]));
    expect(byNumber.get(1)).toMatchObject({ status: 'BUSY', orderId: first.orderId });
    expect(byNumber.get(2)!.status).toBe('BILL_REQUESTED');
    expect(byNumber.get(3)).toMatchObject({ status: 'FREE', orderId: null, total: 0 });
    expect(byNumber.get(1)!.total).toBe(dataOf(await ask(cashier, posOrder, { orderId: first.orderId })).totals.total);
    expect(view.busyCount).toBe(2);
  });

  it('shows the rounded total the cashier will collect, the same as the order screen', async () => {
    // 5,000 + 10% service + 5% tax on it = 5,775, rounded to the 1,000 step: 6,000.
    await prisma().posSettings.update({ where: { restaurantId: a.id }, data: { serviceRatePercent: 10, taxRatePercent: 5, roundingStep: 1000 } });
    const { orderId } = await seat(1);
    const order = dataOf(await ask(cashier, posOrder, { orderId }));
    expect(order.totals.rounding).not.toBe(0);
    expect((await board()).tables.find((t) => t.number === 1)!.total).toBe(order.totals.total);
  });

  it('gives each open table its live lines, without the cancelled ones', async () => {
    const { orderId } = await seat(1, 2);
    const line = await prisma().posOrderLine.findFirstOrThrow({ where: { orderId } });
    const byNumber = async () => new Map((await board()).tables.map((t) => [t.number, t]));
    expect((await byNumber()).get(1)!.lines).toEqual([{ name: line.nameSnapshot, quantity: 2 }]);
    expect((await byNumber()).get(3)!.lines).toEqual([]);
    await prisma().posOrderLine.update({ where: { id: line.id }, data: { cancelledAt: new Date() } });
    expect((await byNumber()).get(1)!.lines).toEqual([]);
  });

  it('shows READY when the order is ready', async () => {
    const { orderId } = await seat(1);
    await prisma().posOrder.update({ where: { id: orderId }, data: { status: 'READY' } });
    expect((await board()).tables.find((t) => t.number === 1)!.status).toBe('READY');
  });

  it('counts today in the Baghdad day: 21:30 UTC the day before is already today, 20:30 UTC is not', async () => {
    const now = new Date('2026-10-25T10:00:00Z');
    const pay = async (paidAt: string, total: number, number: number) => {
      const order = await prisma().posOrder.create({ data: { restaurantId: a.id, kind: 'DINE_IN', status: 'PAID', number } });
      await prisma().posPayment.create({
        data: { restaurantId: a.id, orderId: order.id, method: 'CASH', amountReceived: total, totalsSnapshot: { total }, paidAt: new Date(paidAt) },
      });
    };
    await pay('2026-10-24T21:30:00Z', 4_000, 1); // 00:30 Baghdad on the 25th: today
    await pay('2026-10-24T20:30:00Z', 9_000, 2); // 23:30 Baghdad on the 24th: yesterday
    await pay('2026-10-25T08:00:00Z', 1_000, 3);
    expect((await readBoard(prisma() as unknown as AnyDb, a.id, { now })).todaySales).toBe(5_000);
  });

  it('keeps the counts when the list is narrowed to one area', async () => {
    await seat(1);
    await seat(4);
    const all = await board();
    const narrowed = await board({ areaId: terrace });
    expect(narrowed.tables.map((t) => t.number)).toEqual([4, 5]);
    expect(narrowed.areas).toEqual(all.areas);
    expect(narrowed.busyCount).toBe(2);
    expect(all.areas.find((area) => area.id === hall)).toMatchObject({ tableCount: 3, busyCount: 1 });
  });

  it('answers 200 tables and 150 live orders in a constant number of queries', async () => {
    const area = await prisma().posArea.create({ data: { restaurantId: a.id, name: 'Big', sortOrder: 9 } });
    await prisma().posTable.createMany({ data: Array.from({ length: 200 }, (_, i) => ({ restaurantId: a.id, areaId: area.id, number: 100 + i })) });
    const big = await prisma().posTable.findMany({ where: { restaurantId: a.id, areaId: area.id }, orderBy: { number: 'asc' } });
    for (let i = 0; i < 150; i++) {
      const order = await prisma().posOrder.create({ data: { restaurantId: a.id, tableId: big[i]!.id, kind: 'DINE_IN', status: 'OPEN', number: i + 1 } });
      await prisma().posOrderLine.create({ data: { restaurantId: a.id, orderId: order.id, productId: burger, nameSnapshot: 'x', unitPriceSnapshot: 1000, quantity: 1, optionsSnapshot: [] } });
    }
    let queries = 0;
    const counting = new Proxy(prisma(), {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver) as unknown;
        if (typeof prop === 'string' && typeof value === 'object' && value !== null && !prop.startsWith('$')) {
          return new Proxy(value, {
            get(delegate, method) {
              const fn = Reflect.get(delegate, method) as unknown;
              return typeof fn === 'function' ? (...args: unknown[]) => { queries++; return (fn as (...a: unknown[]) => unknown).apply(delegate, args); } : fn;
            },
          });
        }
        return value;
      },
    });
    const view = await readBoard(counting as unknown as AnyDb, a.id);
    expect(view.tables).toHaveLength(205);
    expect(view.busyCount).toBe(150);
    expect(view.tables.filter((t) => t.total === 1000)).toHaveLength(150);
    expect(queries).toBeLessThanOrEqual(8);
  });

  it("never shows another restaurant's tables, and keeps the kitchen out", async () => {
    expect((await board({}, bManager)).tables).toEqual([]);
    expect(codeOf(await ask(kitchen, posBoard, {}) as never)).toBe('FORBIDDEN');
  });
});
