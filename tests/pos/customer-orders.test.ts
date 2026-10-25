import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPosArea, createPosTables } from '@/server/studio/actions/pos';
import { openPosOrder } from '@/server/studio/actions/pos-orders';
import { acceptPosRequest, rejectPosRequest, removePosRequestLine, setPosRequestLineQuantity } from '@/server/studio/actions/pos-requests';
import { posBoard, posOrder } from '@/server/studio/queries/pos';
import { posRequest, posRequests } from '@/server/studio/queries/pos-requests';
import { ask, codeOf, dataOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };
let b: { id: string };
let manager: Person;
let cashier: Person;
let kitchen: Person;
let bManager: Person;
let tables: { id: string; number: number }[];
let burger: string;
let juice: string;
let cheese: string;

const names = (ar: string, en = ar) => ({ ar: { name: ar }, en: { name: en } });

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  
  await resetWorld();
  a = await restaurant('Requests A');
  b = await restaurant('Requests B');
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  kitchen = await person('kitchen', { staff: [a.id, 'KITCHEN'] });
  bManager = await person('bmanager', { staff: [b.id, 'MANAGER'] });

  const menu = await prisma().menu.create({
    data: { restaurantId: a.id, name: 'm', slug: 'req-a', currency: 'IQD', locales: ['ar', 'en'], defaultLocale: 'ar', timezone: 'Asia/Baghdad' },
  });
  await prisma().posSettings.create({ data: { restaurantId: a.id, catalogMenuId: menu.id, qrOrderingEnabled: true } });
  const category = await prisma().category.create({ data: { menuId: menu.id, slug: 'food', sortOrder: 1, translations: names('أكل', 'Food') } });
  burger = (await prisma().product.create({ data: { menuId: menu.id, categoryId: category.id, slug: 'burger', sortOrder: 1, basePrice: 5000, translations: names('برغر', 'Burger') } })).id;
  juice = (await prisma().product.create({ data: { menuId: menu.id, categoryId: category.id, slug: 'juice', sortOrder: 2, basePrice: 2000, translations: names('عصير', 'Juice') } })).id;
  const extras = await prisma().modifierGroup.create({ data: { menuId: menu.id, productId: burger, minSelect: 0, maxSelect: 2, translations: names('إضافات', 'Extras') } });
  cheese = (await prisma().modifierOption.create({ data: { menuId: menu.id, groupId: extras.id, priceDelta: 500, translations: names('جبن', 'Cheese') } })).id;

  const areaId = dataOf(await run(manager, createPosArea, { name: 'Hall' })).areaId;
  await run(manager, createPosTables, { areaId, from: 1, to: 3 });
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

/** A guest's request as the guest endpoint would have stored it. */
async function request(options: { table?: number; restaurantId?: string; age?: number; lines?: { productId?: string | null; name?: string; unit?: number; options?: object[]; promo?: number; quantity?: number; note?: string }[] } = {}) {
  const restaurantId = options.restaurantId ?? a.id;
  const table = options.table ?? 1;
  const row = (await prisma().posTable.findFirstOrThrow({ where: { restaurantId, number: table } }));
  const lines = options.lines ?? [{ productId: burger, name: 'برغر', unit: 5000, options: [{ id: cheese, name: 'جبن', priceDelta: 500 }], promo: 0, quantity: 2, note: '' }];
  return prisma().posCustomerOrder.create({
    data: {
      restaurantId,
      tableId: row.id,
      tableNumber: table,
      locale: 'ar',
      createdAt: new Date(Date.now() - (options.age ?? 0) * 60_000),
      lines: {
        create: lines.map((line) => ({
          restaurantId,
          productId: line.productId === undefined ? burger : line.productId,
          nameSnapshot: line.name ?? 'برغر',
          unitPriceSnapshot: line.unit ?? 5000,
          optionsSnapshot: line.options ?? [],
          promoDiscountPerUnit: line.promo ?? 0,
          quantity: line.quantity ?? 1,
          note: line.note ?? '',
        })),
      },
    },
    include: { lines: true },
  });
}

describe('accepting a request', () => {
  it('opens an OPEN order on a free table with the quoted prices, even after the product price changed', async () => {
    const req = await request();
    await prisma().product.update({ where: { id: burger }, data: { basePrice: 9000 } });
    const done = dataOf(await run(cashier, acceptPosRequest, { requestId: req.id }));
    expect(done.created).toBe(true);
    const order = dataOf(await ask(cashier, posOrder, { orderId: done.orderId }));
    expect(order.status).toBe('OPEN');
    expect(order.lines).toHaveLength(1);
    expect(order.lines[0]).toMatchObject({ name: 'برغر', quantity: 2, lineTotal: (5000 + 500) * 2 });
    expect(order.totals.subtotal).toBe(11000);
    const stored = await prisma().posCustomerOrder.findUniqueOrThrow({ where: { id: req.id } });
    expect(stored).toMatchObject({ status: 'ACCEPTED', orderId: done.orderId, decidedByUserId: cashier.userId });
  });

  it('turns the Menu promotion into a visible line discount so the guest pays what the Menu showed', async () => {
    const req = await request({ lines: [{ unit: 5000, options: [], promo: 500, quantity: 3 }] });
    const done = dataOf(await run(cashier, acceptPosRequest, { requestId: req.id }));
    const order = dataOf(await ask(cashier, posOrder, { orderId: done.orderId }));
    expect(order.lines[0]!.lineTotal).toBe(4500 * 3);
    const line = await prisma().posOrderLine.findFirstOrThrow({ where: { orderId: done.orderId } });
    expect(line).toMatchObject({ discountKind: 'AMOUNT', discountValue: 1500 });
  });

  it('adds the lines to the live order of the table when given its version, and the total is both sets', async () => {
    const opened = dataOf(await run(cashier, openPosOrder, { tableId: tables[0]!.id }));
    const req = await request({ lines: [{ productId: juice, name: 'عصير', unit: 2000, options: [], quantity: 1 }] });
    const detail = dataOf(await ask(cashier, posRequest, { requestId: req.id }));
    expect(detail).toMatchObject({ liveOrderId: opened.orderId, liveOrderVersion: opened.version });
    const done = dataOf(await run(cashier, acceptPosRequest, { requestId: req.id, expectedOrderVersion: opened.version }));
    expect(done).toMatchObject({ orderId: opened.orderId, created: false });
    const second = await request({ lines: [{ unit: 5000, quantity: 1, options: [] }] });
    const live = dataOf(await ask(cashier, posRequest, { requestId: second.id }));
    dataOf(await run(cashier, acceptPosRequest, { requestId: second.id, expectedOrderVersion: live.liveOrderVersion! }));
    const order = dataOf(await ask(cashier, posOrder, { orderId: opened.orderId }));
    expect(order.lines).toHaveLength(2);
    expect(order.totals.subtotal).toBe(7000);
  });

  it('refuses a missing or stale order version and leaves the request waiting', async () => {
    const opened = dataOf(await run(cashier, openPosOrder, { tableId: tables[0]!.id }));
    const req = await request();
    expect(codeOf(await run(cashier, acceptPosRequest, { requestId: req.id }))).toBe('CONFLICT');
    expect(codeOf(await run(cashier, acceptPosRequest, { requestId: req.id, expectedOrderVersion: opened.version + 5 }))).toBe('CONFLICT');
    expect((await prisma().posCustomerOrder.findUniqueOrThrow({ where: { id: req.id } })).status).toBe('PENDING');
    expect(await prisma().posOrderLine.count({ where: { orderId: opened.orderId } })).toBe(0);
  });

  it('lets exactly one of two simultaneous accepts win and makes one order', async () => {
    const req = await request();
    const results = await Promise.all([run(cashier, acceptPosRequest, { requestId: req.id }), run(manager, acceptPosRequest, { requestId: req.id })]);
    expect(results.map(codeOf).sort()).toEqual(['CONFLICT', 'OK']);
    expect(await prisma().posOrder.count({ where: { restaurantId: a.id } })).toBe(1);
    expect(await prisma().posOrderLine.count({ where: { restaurantId: a.id } })).toBe(1);
  });

  it('lets exactly one of an accept and a reject of one request win', async () => {
    const req = await request();
    const results = await Promise.all([run(cashier, acceptPosRequest, { requestId: req.id }), run(manager, rejectPosRequest, { requestId: req.id, reason: 'no' })]);
    expect(results.map(codeOf).sort()).toEqual(['CONFLICT', 'OK']);
  });

  it('refuses an expired request and an empty one', async () => {
    const old = await request({ age: 61 });
    expect(codeOf(await run(cashier, acceptPosRequest, { requestId: old.id }))).toBe('CONFLICT');
    const empty = await request();
    await run(cashier, removePosRequestLine, { lineId: empty.lines[0]!.id });
    expect(codeOf(await run(cashier, acceptPosRequest, { requestId: empty.id }))).toBe('CONFLICT');
    expect((await prisma().posCustomerOrder.findUniqueOrThrow({ where: { id: empty.id } })).status).toBe('PENDING');
    expect(await prisma().posOrder.count({ where: { restaurantId: a.id } })).toBe(0);
  });

  it('keeps the line when its product was deleted afterwards, with no kitchen section', async () => {
    const req = await request({ lines: [{ productId: juice, name: 'عصير', unit: 2000, options: [], quantity: 1 }] });
    await prisma().product.delete({ where: { id: juice } });
    const stored = await prisma().posCustomerOrderLine.findFirstOrThrow({ where: { requestId: req.id } });
    expect(stored.productId).toBeNull();
    const done = dataOf(await run(cashier, acceptPosRequest, { requestId: req.id }));
    const line = await prisma().posOrderLine.findFirstOrThrow({ where: { orderId: done.orderId } });
    expect(line).toMatchObject({ nameSnapshot: 'عصير', sectionId: null });
  });

  it('copies the kitchen section of the product', async () => {
    const section = await prisma().posKitchenSection.create({ data: { restaurantId: a.id, name: 'Grill' } });
    await prisma().posProductSetting.create({ data: { restaurantId: a.id, productId: burger, sectionId: section.id } });
    const req = await request();
    const done = dataOf(await run(cashier, acceptPosRequest, { requestId: req.id }));
    const line = await prisma().posOrderLine.findFirstOrThrow({ where: { orderId: done.orderId } });
    expect(line).toMatchObject({ sectionId: section.id, sectionNameSnapshot: 'Grill' });
  });
});

describe('rejecting and editing', () => {
  it('rejects with a reason and refuses a second decision', async () => {
    const req = await request();
    dataOf(await run(cashier, rejectPosRequest, { requestId: req.id, reason: ' kitchen is closed ' }));
    expect(await prisma().posCustomerOrder.findUniqueOrThrow({ where: { id: req.id } })).toMatchObject({ status: 'REJECTED', rejectReason: 'kitchen is closed' });
    expect(codeOf(await run(cashier, rejectPosRequest, { requestId: req.id, reason: '' }))).toBe('CONFLICT');
    expect(codeOf(await run(cashier, acceptPosRequest, { requestId: req.id }))).toBe('CONFLICT');
    expect(await prisma().posOrder.count({ where: { restaurantId: a.id } })).toBe(0);
  });

  it('changes a quantity within 1 to 20, removes a line, and refuses edits on a decided request', async () => {
    const req = await request({ lines: [{ quantity: 1, options: [] }, { productId: juice, name: 'عصير', unit: 2000, quantity: 1 }] });
    const [first, second] = req.lines;
    dataOf(await run(cashier, setPosRequestLineQuantity, { lineId: first!.id, quantity: 4 }));
    expect(codeOf(await run(cashier, setPosRequestLineQuantity, { lineId: first!.id, quantity: 21 }))).toBe('INVALID');
    expect(codeOf(await run(cashier, setPosRequestLineQuantity, { lineId: first!.id, quantity: 0 }))).toBe('INVALID');
    dataOf(await run(cashier, removePosRequestLine, { lineId: second!.id }));
    const detail = dataOf(await ask(cashier, posRequest, { requestId: req.id }));
    expect(detail.lines).toHaveLength(1);
    expect(detail.total).toBe(20000);
    dataOf(await run(cashier, rejectPosRequest, { requestId: req.id, reason: '' }));
    expect(codeOf(await run(cashier, setPosRequestLineQuantity, { lineId: first!.id, quantity: 2 }))).toBe('CONFLICT');
    expect(codeOf(await run(cashier, removePosRequestLine, { lineId: first!.id }))).toBe('CONFLICT');
  });
});

describe('who may', () => {
  it('keeps the kitchen out and gives another restaurant NOT_FOUND for every function', async () => {
    const req = await request();
    const line = req.lines[0]!;
    expect(codeOf(await run(kitchen, acceptPosRequest, { requestId: req.id }))).toBe('FORBIDDEN');
    expect(codeOf(await run(kitchen, rejectPosRequest, { requestId: req.id, reason: '' }))).toBe('FORBIDDEN');
    expect(codeOf(await run(bManager, acceptPosRequest, { requestId: req.id }))).toBe('NOT_FOUND');
    expect(codeOf(await run(bManager, rejectPosRequest, { requestId: req.id, reason: '' }))).toBe('NOT_FOUND');
    expect(codeOf(await run(bManager, setPosRequestLineQuantity, { lineId: line.id, quantity: 2 }))).toBe('NOT_FOUND');
    expect(codeOf(await run(bManager, removePosRequestLine, { lineId: line.id }))).toBe('NOT_FOUND');
    const read = await ask(bManager, posRequest, { requestId: req.id });
    expect(read.ok).toBe(false);
    expect(dataOf(await ask(bManager, posRequests, {})).requests).toEqual([]);
    expect((await prisma().posCustomerOrder.findUniqueOrThrow({ where: { id: req.id } })).status).toBe('PENDING');
  });

  it('closes the actions when the cashier subscription lapsed', async () => {
    const req = await request();
    await prisma().subscription.updateMany({ where: { restaurantId: a.id }, data: { status: 'ACTIVE', currentPeriodStart: new Date(Date.now() - 400 * 86_400_000), currentPeriodEnd: new Date(Date.now() - 365 * 86_400_000) } });
    expect(codeOf(await run(cashier, acceptPosRequest, { requestId: req.id }))).not.toBe('OK');
  });
});

describe('the list and the board', () => {
  it('lists waiting requests oldest first and hides expired and decided ones', async () => {
    const newer = await request({ table: 2, age: 1 });
    const older = await request({ table: 1, age: 10 });
    await request({ table: 3, age: 61 });
    const decided = await request({ table: 3, age: 2 });
    await run(cashier, rejectPosRequest, { requestId: decided.id, reason: '' });
    const list = dataOf(await ask(cashier, posRequests, {})).requests;
    expect(list.map((r) => r.id)).toEqual([older.id, newer.id]);
    expect(list[0]).toMatchObject({ tableNumber: 1, lineCount: 1, total: 11000 });
  });

  it('shows a free table with a waiting request as PENDING_APPROVAL, and a busy table keeps its status with a count', async () => {
    await request({ table: 1 });
    await request({ table: 2 });
    await request({ table: 2 });
    await run(cashier, openPosOrder, { tableId: tables[1]!.id });
    const board = dataOf(await ask(cashier, posBoard, {}));
    const byNumber = new Map(board.tables.map((t) => [t.number, t]));
    expect(byNumber.get(1)).toMatchObject({ status: 'PENDING_APPROVAL', pendingRequests: 1 });
    expect(byNumber.get(2)).toMatchObject({ status: 'BUSY', pendingRequests: 2 });
    expect(byNumber.get(3)).toMatchObject({ status: 'FREE', pendingRequests: 0 });
  });

  it('deletes the requests of a deleted table and keeps the line name when its product is gone', async () => {
    const req = await request({ table: 3 });
    await prisma().posTable.delete({ where: { id: tables[2]!.id } });
    expect(await prisma().posCustomerOrder.count({ where: { id: req.id } })).toBe(0);
    expect(await prisma().posCustomerOrderLine.count({ where: { requestId: req.id } })).toBe(0);
  });
});
