import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPosArea, createPosTables } from '@/server/studio/actions/pos';
import { acknowledgePosCancellations, markPosLinesReady, sendPosToKitchen } from '@/server/studio/actions/pos-kitchen';
import { addPosLine, cancelPosLine, openPosOrder, cancelPosOrder } from '@/server/studio/actions/pos-orders';
import { posBoard, posKitchenQueue, posKitchenScope, posKitchenTicket, posOrder, posOrderKitchenTicket } from '@/server/studio/queries/pos';
import { ask, codeOf, dataOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };
let b: { id: string };
let cashier: Person;
let manager: Person;
let cook: Person;
let grillCook: Person;
let bManager: Person;
let burger: string;
let juice: string;
let grill: string;
let bar: string;
let tables: { id: string; number: number }[];

const names = (ar: string, en = ar) => ({ ar: { name: ar }, en: { name: en } });

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await resetWorld();
  a = await restaurant('Kitchen A');
  b = await restaurant('Kitchen B');
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  cook = await person('cook', { staff: [a.id, 'KITCHEN'] });
  grillCook = await person('grillcook', { staff: [a.id, 'KITCHEN'] });
  bManager = await person('bmanager', { staff: [b.id, 'MANAGER'] });
  const menu = await prisma().menu.create({
    data: { restaurantId: a.id, name: 'm', slug: 'menu-a', currency: 'IQD', locales: ['ar', 'en'], defaultLocale: 'ar', timezone: 'Asia/Baghdad' },
  });
  await prisma().posSettings.upsert({
    where: { restaurantId: a.id },
    create: { restaurantId: a.id, catalogMenuId: menu.id, kitchenScreenEnabled: true },
    update: { catalogMenuId: menu.id, kitchenScreenEnabled: true },
  });
  const category = await prisma().category.create({ data: { menuId: menu.id, slug: 'food', sortOrder: 1, translations: names('أكل', 'Food') } });
  burger = (await prisma().product.create({ data: { menuId: menu.id, categoryId: category.id, slug: 'burger', sortOrder: 1, basePrice: 5000, translations: names('برغر', 'Burger') } })).id;
  juice = (await prisma().product.create({ data: { menuId: menu.id, categoryId: category.id, slug: 'juice', sortOrder: 2, basePrice: 2000, translations: names('عصير', 'Juice') } })).id;
  grill = (await prisma().posKitchenSection.create({ data: { restaurantId: a.id, name: 'Grill' } })).id;
  bar = (await prisma().posKitchenSection.create({ data: { restaurantId: a.id, name: 'Bar', sortOrder: 1 } })).id;
  await prisma().posProductSetting.create({ data: { restaurantId: a.id, productId: burger, sectionId: grill } });
  await prisma().posProductSetting.create({ data: { restaurantId: a.id, productId: juice, sectionId: bar } });
  await prisma().posStaff.updateMany({ where: { userId: grillCook.userId }, data: { kitchenSectionId: grill } });
  const areaId = dataOf(await run(manager, createPosArea, { name: 'Hall' })).areaId;
  await run(manager, createPosTables, { areaId, from: 1, to: 2 });
  tables = await prisma().posTable.findMany({ where: { restaurantId: a.id }, orderBy: { number: 'asc' }, select: { id: true, number: true } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

async function openAt(table = tables[0]!) {
  return dataOf(await run(cashier, openPosOrder, { tableId: table.id }));
}

async function add(orderId: string, productId: string, version: number, quantity = 1) {
  return dataOf(await run(cashier, addPosLine, { orderId, productId, quantity, note: '', optionIds: [], expectedVersion: version }));
}

const queue = async (who: Person = cook, input: object = {}) => dataOf(await ask(who, posKitchenQueue, input)).cards;
const lineIdsOf = async (orderId: string) => (await prisma().posOrderLine.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' }, select: { id: true } })).map((l) => l.id);

describe('sending to the kitchen', () => {
  it('sends round 1, then a new line as round 2', async () => {
    const o = await openAt();
    const l1 = await add(o.orderId, burger, o.version);
    const first = dataOf(await run(cashier, sendPosToKitchen, { orderId: o.orderId, expectedVersion: l1.version }));
    expect(first).toMatchObject({ batch: 1, lineCount: 1 });
    const l2 = await add(o.orderId, juice, first.version);
    const second = dataOf(await run(cashier, sendPosToKitchen, { orderId: o.orderId, expectedVersion: l2.version }));
    expect(second).toMatchObject({ batch: 2, lineCount: 1 });
    expect(await prisma().posOrderLine.findMany({ where: { orderId: o.orderId }, orderBy: { createdAt: 'asc' }, select: { batch: true } })).toEqual([{ batch: 1 }, { batch: 2 }]);
  });

  it('refuses when the kitchen is off, when nothing is new, and a stale version', async () => {
    const o = await openAt();
    const l1 = await add(o.orderId, burger, o.version);
    await prisma().posSettings.update({ where: { restaurantId: a.id }, data: { kitchenScreenEnabled: false, kitchenPrintEnabled: false } });
    expect(codeOf(await run(cashier, sendPosToKitchen, { orderId: o.orderId, expectedVersion: l1.version }))).toBe('CONFLICT');
    await prisma().posSettings.update({ where: { restaurantId: a.id }, data: { kitchenPrintEnabled: true } });
    const sent = dataOf(await run(cashier, sendPosToKitchen, { orderId: o.orderId, expectedVersion: l1.version }));
    expect(codeOf(await run(cashier, sendPosToKitchen, { orderId: o.orderId, expectedVersion: sent.version }))).toBe('CONFLICT');
    expect(codeOf(await run(cashier, sendPosToKitchen, { orderId: o.orderId, expectedVersion: l1.version }))).toBe('CONFLICT');
  });

  it('keeps a kitchen member from sending, and another restaurant from reaching the order', async () => {
    const o = await openAt();
    const l1 = await add(o.orderId, burger, o.version);
    expect(codeOf(await run(cook, sendPosToKitchen, { orderId: o.orderId, expectedVersion: l1.version }))).toBe('FORBIDDEN');
    await prisma().posSettings.create({ data: { restaurantId: b.id, kitchenScreenEnabled: true } });
    expect(codeOf(await run(bManager, sendPosToKitchen, { orderId: o.orderId, expectedVersion: l1.version }))).toBe('NOT_FOUND');
  });
});

describe('the kitchen screen', () => {
  async function sentOrder() {
    const o = await openAt();
    const l1 = await add(o.orderId, burger, o.version);
    const l2 = await add(o.orderId, juice, l1.version);
    const sent = dataOf(await run(cashier, sendPosToKitchen, { orderId: o.orderId, expectedVersion: l2.version }));
    return { orderId: o.orderId, version: sent.version, lineIds: await lineIdsOf(o.orderId) };
  }

  it('shows one card per section, with no prices', async () => {
    await sentOrder();
    const cards = await queue(cook);
    expect(cards.map((c) => c.sectionName).sort()).toEqual(['Bar', 'Grill']);
    expect(JSON.stringify(cards)).not.toMatch(/price|total/i);
  });

  it('shows a section-bound cook only their section, whatever is asked', async () => {
    await sentOrder();
    expect((await queue(grillCook, { sectionId: bar })).map((c) => c.sectionName)).toEqual(['Grill']);
    expect(dataOf(await ask(grillCook, posKitchenScope, {})).sectionId).toBe(grill);
    expect((await queue(manager, { sectionId: bar })).map((c) => c.sectionName)).toEqual(['Bar']);
  });

  it('marks lines ready once, flips the order to READY on the last one, and writes no second audit', async () => {
    const { orderId, lineIds } = await sentOrder();
    expect(dataOf(await run(cook, markPosLinesReady, { lineIds: [lineIds[0]!] })).ready).toBe(1);
    expect(dataOf(await run(cook, markPosLinesReady, { lineIds: [lineIds[0]!] })).ready).toBe(0);
    expect(dataOf(await ask(cashier, posOrder, { orderId })).status).toBe('OPEN');
    expect(dataOf(await run(cook, markPosLinesReady, { lineIds })).ready).toBe(1);
    expect(dataOf(await ask(cashier, posOrder, { orderId })).status).toBe('READY');
    expect(dataOf(await ask(cashier, posBoard, {})).tables.find((t) => t.orderId === orderId)!.status).toBe('READY');
    expect(await prisma().auditLog.count({ where: { restaurantId: a.id, action: 'pos.order.kitchen.ready' } })).toBe(2);
    expect(await queue(cook)).toEqual([]);
  });

  it('reopens a READY order to OPEN when a line is added', async () => {
    const { orderId, lineIds, version } = await sentOrder();
    dataOf(await run(cook, markPosLinesReady, { lineIds }));
    const ready = dataOf(await ask(cashier, posOrder, { orderId }));
    expect(ready.status).toBe('READY');
    await add(orderId, juice, ready.version);
    expect(dataOf(await ask(cashier, posOrder, { orderId })).status).toBe('OPEN');
    void version;
  });

  it('refuses a cook marking a line of another section, and a line of another restaurant', async () => {
    const { lineIds } = await sentOrder();
    const lines = await prisma().posOrderLine.findMany({ where: { id: { in: lineIds } }, select: { id: true, sectionId: true } });
    const barLine = lines.find((l) => l.sectionId === bar)!;
    expect(codeOf(await run(grillCook, markPosLinesReady, { lineIds: [barLine.id] }))).toBe('FORBIDDEN');
    await prisma().posSettings.create({ data: { restaurantId: b.id, kitchenScreenEnabled: true } });
    expect(codeOf(await run(bManager, markPosLinesReady, { lineIds: [barLine.id] }))).toBe('NOT_FOUND');
  });

  it('shows a cancelled sent line as a notice until it is acknowledged', async () => {
    const { orderId, lineIds, version } = await sentOrder();
    const burgerLine = (await prisma().posOrderLine.findMany({ where: { id: { in: lineIds } }, select: { id: true, sectionId: true } })).find((l) => l.sectionId === grill)!;
    dataOf(await run(cashier, cancelPosLine, { lineId: burgerLine.id, reason: 'guest left', expectedVersion: version }));
    const card = (await queue(cook)).find((c) => c.sectionName === 'Grill')!;
    expect(card.cancelled).toEqual([{ id: burgerLine.id, name: 'برغر', quantity: 1, reason: 'guest left' }]);
    expect(dataOf(await run(cook, acknowledgePosCancellations, { lineIds: [burgerLine.id] })).acknowledged).toBe(1);
    expect(dataOf(await run(cook, acknowledgePosCancellations, { lineIds: [burgerLine.id] })).acknowledged).toBe(0);
    expect((await queue(cook)).find((c) => c.sectionName === 'Grill')).toBeUndefined();
    void orderId;
  });

  it('makes the order READY when the last uncooked line is cancelled', async () => {
    const { orderId, lineIds, version } = await sentOrder();
    const lines = await prisma().posOrderLine.findMany({ where: { id: { in: lineIds } }, select: { id: true, sectionId: true } });
    dataOf(await run(cook, markPosLinesReady, { lineIds: [lines.find((l) => l.sectionId === bar)!.id] }));
    const current = dataOf(await ask(cashier, posOrder, { orderId })).version;
    dataOf(await run(cashier, cancelPosLine, { lineId: lines.find((l) => l.sectionId === grill)!.id, reason: 'out', expectedVersion: current }));
    expect(dataOf(await ask(cashier, posOrder, { orderId })).status).toBe('READY');
    void version;
  });

  it('shows the cancellation of a whole order with its reason', async () => {
    const { orderId, version } = await sentOrder();
    dataOf(await run(cashier, cancelPosOrder, { orderId, reason: 'closing early', expectedVersion: version }));
    const cards = await queue(cook);
    expect(cards.every((c) => c.orderCancelled && c.lines.length === 0)).toBe(true);
    expect(cards.flatMap((c) => c.cancelled.map((x) => x.reason))).toEqual(['closing early', 'closing early']);
  });

  it('leaves a line sent more than 12 hours ago off the screen but on the ticket', async () => {
    const { orderId } = await sentOrder();
    await prisma().posOrderLine.updateMany({ where: { orderId }, data: { sentAt: new Date(Date.now() - 13 * 3_600_000) } });
    expect(await queue(cook)).toEqual([]);
    const ticket = dataOf(await ask(cook, posKitchenTicket, { orderId }));
    expect(ticket.sheets.flatMap((s) => s.lines.map((l) => l.name)).sort()).toEqual(['برغر', 'عصير']);
  });
});

describe('the kitchen ticket', () => {
  it('groups the round by section, with a cancel slip for a cancelled sent line', async () => {
    const o = await openAt();
    const l1 = await add(o.orderId, burger, o.version);
    const l2 = await add(o.orderId, juice, l1.version);
    const sent = dataOf(await run(cashier, sendPosToKitchen, { orderId: o.orderId, expectedVersion: l2.version }));
    const ids = await lineIdsOf(o.orderId);
    dataOf(await run(cashier, cancelPosLine, { lineId: ids[1]!, reason: 'no juice', expectedVersion: sent.version }));
    const ticket = dataOf(await ask(cashier, posOrderKitchenTicket, { orderId: o.orderId }));
    expect(ticket).toMatchObject({ orderNumber: 1, tableNumber: 1, cashierName: 'cashier person' });
    expect(ticket.sheets.map((s) => s.sectionName)).toEqual(['Grill']);
    expect(ticket.cancelSlips).toEqual([{ sectionId: bar, sectionName: 'Bar', lines: [{ name: 'عصير', quantity: 1, reason: 'no juice' }] }]);
    expect(codeOf(await ask(cashier, posKitchenTicket, { orderId: o.orderId }) as never)).toBe('FORBIDDEN');
  });
});
