import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { baghdadDayOf } from '@/lib/baghdad';
import { createPosArea, createPosTables, updatePosSettings } from '@/server/studio/actions/pos';
import { acknowledgePosCancellations, markPosLinesReady, sendPosToKitchen } from '@/server/studio/actions/pos-kitchen';
import { addPosLine, cancelPosOrder, openPosOrder, requestPosBill } from '@/server/studio/actions/pos-orders';
import { payPosOrder } from '@/server/studio/actions/pos-payments';
import { addPosExpense, closePosShift, openPosShift } from '@/server/studio/actions/pos-shifts';
import { posBoard, posDailyReport, posKitchenQueue, posOrder, posReceipt, posShift } from '@/server/studio/queries/pos';
import { ask, codeOf, dataOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

/**
 * The phase 3 exit check: a shift, an order with options and a note, the kitchen, cash payment, the board, the count and the
 * report, driven as the three people who do the work, and then the same actions aimed across restaurants.
 */

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };
let b: { id: string };
let manager: Person;
let cashier: Person;
let cook: Person;
let bManager: Person;
let bCashier: Person;
let burger: string;
let juice: string;
let large: string;
let cheese: string;
let tables: { id: string; number: number }[];

const names = (ar: string, en = ar) => ({ ar: { name: ar }, en: { name: en } });

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await resetWorld();
  a = await restaurant('Exit A');
  b = await restaurant('Exit B');
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  cook = await person('cook', { staff: [a.id, 'KITCHEN'] });
  bManager = await person('bmanager', { staff: [b.id, 'MANAGER'] });
  bCashier = await person('bcashier', { staff: [b.id, 'CASHIER'] });
  const menu = await prisma().menu.create({
    data: { restaurantId: a.id, name: 'm', slug: 'menu-a', currency: 'IQD', locales: ['ar', 'ckb', 'en'], defaultLocale: 'ar', timezone: 'Asia/Baghdad' },
  });
  await prisma().posSettings.upsert({ where: { restaurantId: a.id }, create: { restaurantId: a.id, catalogMenuId: menu.id }, update: { catalogMenuId: menu.id } });
  const category = await prisma().category.create({ data: { menuId: menu.id, slug: 'food', sortOrder: 1, translations: names('أكل', 'Food') } });
  burger = (await prisma().product.create({ data: { menuId: menu.id, categoryId: category.id, slug: 'burger', sortOrder: 1, basePrice: 8000, translations: names('برغر', 'Burger') } })).id;
  juice = (await prisma().product.create({ data: { menuId: menu.id, categoryId: category.id, slug: 'juice', sortOrder: 2, basePrice: 2500, translations: names('عصير', 'Juice') } })).id;
  await prisma().productVariant.create({ data: { menuId: menu.id, productId: burger, isDefault: true, priceDelta: 0, translations: names('عادي', 'Regular') } });
  large = (await prisma().productVariant.create({ data: { menuId: menu.id, productId: burger, priceDelta: 2000, translations: names('كبير', 'Large'), sortOrder: 1 } })).id;
  const extras = await prisma().modifierGroup.create({ data: { menuId: menu.id, productId: burger, minSelect: 0, maxSelect: 2, translations: names('إضافات', 'Extras') } });
  cheese = (await prisma().modifierOption.create({ data: { menuId: menu.id, groupId: extras.id, priceDelta: 1000, translations: names('جبن', 'Cheese') } })).id;
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

describe('the cashier, start to finish', () => {
  it('runs a shift: order, kitchen, cash, board, count and report', async () => {
    // The manager lays out the floor and turns the kitchen screen on.
    const areaId = dataOf(await run(manager, createPosArea, { name: 'Hall' })).areaId;
    dataOf(await run(manager, createPosTables, { areaId, from: 1, to: 5 }));
    tables = await prisma().posTable.findMany({ where: { restaurantId: a.id }, orderBy: { number: 'asc' }, select: { id: true, number: true } });
    const settings = await prisma().posSettings.findUniqueOrThrow({ where: { restaurantId: a.id } });
    dataOf(
      await run(manager, updatePosSettings, {
        serviceRatePercent: settings.serviceRatePercent,
        taxRatePercent: settings.taxRatePercent,
        enabledPaymentMethods: settings.enabledPaymentMethods,
        tableRingMinutes: settings.tableRingMinutes,
        kitchenPrintEnabled: false,
        kitchenScreenEnabled: true,
        qrOrderingEnabled: false,
        takeawayEnabled: false,
        deliveryEnabled: false,
        complaintsEnabled: settings.complaintsEnabled,
        version: settings.version,
      }),
    );

    // The cashier opens a shift with 50,000 in the drawer, then an order on table 3.
    const shiftId = dataOf(await run(cashier, openPosShift, { openingFloat: 50_000 })).shiftId;
    const table3 = tables.find((t) => t.number === 3)!;
    const opened = dataOf(await run(cashier, openPosOrder, { tableId: table3.id }));
    expect(dataOf(await ask(cashier, posBoard, {})).tables.find((t) => t.id === table3.id)!.status).toBe('BUSY');

    // A large burger with cheese (8,000 + 2,000 + 1,000), and a juice with a note.
    const l1 = dataOf(await run(cashier, addPosLine, { orderId: opened.orderId, productId: burger, quantity: 1, note: '', variantId: large, optionIds: [cheese], expectedVersion: opened.version }));
    const l2 = dataOf(await run(cashier, addPosLine, { orderId: opened.orderId, productId: juice, quantity: 2, note: 'no ice', optionIds: [], expectedVersion: l1.version }));
    const total = 11_000 + 2 * 2_500;
    const order = dataOf(await ask(cashier, posOrder, { orderId: opened.orderId }));
    expect(order.totals.total).toBe(total);
    expect(order.lines.map((l) => l.note)).toEqual(['', 'no ice']);

    // Send to the kitchen; the cook sees it and marks both ready; the order becomes READY.
    const sent = dataOf(await run(cashier, sendPosToKitchen, { orderId: opened.orderId, expectedVersion: l2.version }));
    expect(sent.lineCount).toBe(2);
    const cards = dataOf(await ask(cook, posKitchenQueue, {})).cards;
    const ids = cards.flatMap((c) => c.lines.map((l) => l.id));
    expect(ids).toHaveLength(2);
    expect(dataOf(await run(cook, markPosLinesReady, { lineIds: ids })).ready).toBe(2);
    expect(dataOf(await ask(cashier, posOrder, { orderId: opened.orderId })).status).toBe('READY');
    expect(dataOf(await ask(cashier, posBoard, {})).tables.find((t) => t.id === table3.id)!.status).toBe('READY');

    // Cash: 20,000 for 16,000 gives 4,000 back, and the table is free again with today's sales on the board.
    const ready = dataOf(await ask(cashier, posOrder, { orderId: opened.orderId }));
    const billed = dataOf(await run(cashier, requestPosBill, { orderId: opened.orderId, expectedVersion: ready.version }));
    const paid = dataOf(await run(cashier, payPosOrder, { orderId: opened.orderId, expectedVersion: billed.version, expectedTotal: total, amountReceived: 20_000 }));
    expect(paid).toMatchObject({ change: 4_000, total });
    const board = dataOf(await ask(cashier, posBoard, {}));
    expect(board.tables.find((t) => t.id === table3.id)).toMatchObject({ status: 'FREE', orderId: null });
    expect(board.todaySales).toBe(total);
    expect(dataOf(await ask(cashier, posReceipt, { orderId: opened.orderId })).snapshot.lines.map((l) => l.name)).toEqual(['برغر', 'عصير']);

    // 2,000 out of the drawer, then the exact count closes the shift.
    dataOf(await run(cashier, addPosExpense, { shiftId, amount: 2_000, reason: 'gas' }));
    const expected = 50_000 + total - 2_000;
    expect(dataOf(await ask(cashier, posShift, { shiftId })).expectedCash).toBe(expected);
    expect(dataOf(await run(cashier, closePosShift, { shiftId, countedCash: expected, note: '' })).difference).toBe(0);

    // The manager's report agrees.
    const report = dataOf(await ask(manager, posDailyReport, { day: baghdadDayOf(new Date()) }));
    expect(report.totals).toMatchObject({ grossSales: total, netSales: total, expensesTotal: 2_000, differenceTotal: 0 });
    expect(report.shifts).toHaveLength(1);
    expect(report.shifts[0]).toMatchObject({ expectedCash: expected, countedCash: expected, difference: 0, cashierName: 'cashier person' });
  });
});

describe('across restaurants', () => {
  it("never lets one restaurant's cashier read, pay or mark ready another's order, line, shift or table", async () => {
    const areaId = dataOf(await run(manager, createPosArea, { name: 'Hall' })).areaId;
    await run(manager, createPosTables, { areaId, from: 1, to: 2 });
    await prisma().posSettings.update({ where: { restaurantId: a.id }, data: { kitchenScreenEnabled: true } });
    await prisma().posSettings.create({ data: { restaurantId: b.id, kitchenScreenEnabled: true } });
    const table = await prisma().posTable.findFirstOrThrow({ where: { restaurantId: a.id } });
    const shiftId = dataOf(await run(cashier, openPosShift, { openingFloat: 0 })).shiftId;
    const opened = dataOf(await run(cashier, openPosOrder, { tableId: table.id }));
    const added = dataOf(await run(cashier, addPosLine, { orderId: opened.orderId, productId: juice, quantity: 1, note: '', optionIds: [], expectedVersion: opened.version }));
    const sent = dataOf(await run(cashier, sendPosToKitchen, { orderId: opened.orderId, expectedVersion: added.version }));
    dataOf(await run(bCashier, openPosShift, { openingFloat: 0 }));

    expect(codeOf(await run(bCashier, openPosOrder, { tableId: table.id }))).toBe('NOT_FOUND');
    expect(codeOf(await ask(bCashier, posOrder, { orderId: opened.orderId }) as never)).toBe('NOT_FOUND');
    expect(codeOf(await run(bCashier, payPosOrder, { orderId: opened.orderId, expectedVersion: sent.version, expectedTotal: 2_500, amountReceived: 2_500 }))).toBe('NOT_FOUND');
    expect(codeOf(await run(bCashier, requestPosBill, { orderId: opened.orderId, expectedVersion: sent.version }))).toBe('NOT_FOUND');
    expect(codeOf(await run(bManager, cancelPosOrder, { orderId: opened.orderId, reason: 'x', expectedVersion: sent.version }))).toBe('NOT_FOUND');
    expect(codeOf(await run(bManager, markPosLinesReady, { lineIds: [added.lineId] }))).toBe('NOT_FOUND');
    expect(codeOf(await run(bManager, acknowledgePosCancellations, { lineIds: [added.lineId] }))).toBe('NOT_FOUND');
    expect(codeOf(await run(bManager, closePosShift, { shiftId, countedCash: 0, note: '' }))).toBe('NOT_FOUND');
    expect(codeOf(await run(bManager, addPosExpense, { shiftId, amount: 1, reason: 'x' }))).toBe('NOT_FOUND');
    expect(dataOf(await ask(bManager, posBoard, {})).tables).toEqual([]);
    expect(dataOf(await ask(bManager, posKitchenQueue, {})).cards).toEqual([]);

    // Nothing of A's changed.
    expect(dataOf(await ask(cashier, posOrder, { orderId: opened.orderId })).status).toBe('OPEN');
    expect(await prisma().posPayment.count()).toBe(0);
  });
});
