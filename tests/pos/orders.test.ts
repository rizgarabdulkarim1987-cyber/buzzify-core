import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addPosLine,
  cancelPosLine,
  cancelPosOrder,
  movePosOrderToTable,
  openPosOrder,
  requestPosBill,
  setPosInvoiceDiscount,
  updatePosLine,
} from '@/server/studio/actions/pos-orders';
import { createPosArea, createPosTables } from '@/server/studio/actions/pos';
import { posOrder } from '@/server/studio/queries/pos';
import { ask, codeOf, dataOf, failureOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };
let b: { id: string };
let manager: Person;
let cashier: Person;
let kitchen: Person;
let bManager: Person;
let tables: { id: string; number: number }[];
let menuA: string;
let burger: string;
let juice: string;
let sizeS: string;
let sizeL: string;
let cheese: string;
let bacon: string;
let outsideProduct: string;

const names = (ar: string, en = ar) => ({ ar: { name: ar }, en: { name: en } });

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await resetWorld();
  a = await restaurant('Orders A');
  b = await restaurant('Orders B');
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  kitchen = await person('kitchen', { staff: [a.id, 'KITCHEN'] });
  bManager = await person('bmanager', { staff: [b.id, 'MANAGER'] });

  const menu = await prisma().menu.create({
    data: { restaurantId: a.id, name: 'm', slug: 'menu-a', currency: 'IQD', locales: ['ar', 'ckb', 'en'], defaultLocale: 'ar', timezone: 'Asia/Baghdad' },
  });
  menuA = menu.id;
  await prisma().posSettings.upsert({
    where: { restaurantId: a.id },
    create: { restaurantId: a.id, catalogMenuId: menuA },
    update: { catalogMenuId: menuA },
  });
  const category = await prisma().category.create({ data: { menuId: menuA, slug: 'food', sortOrder: 1, translations: names('أكل', 'Food') } });
  const p1 = await prisma().product.create({
    data: { menuId: menuA, categoryId: category.id, slug: 'burger', sortOrder: 1, basePrice: 5000, translations: names('برغر', 'Burger') },
  });
  burger = p1.id;
  const p2 = await prisma().product.create({
    data: { menuId: menuA, categoryId: category.id, slug: 'juice', sortOrder: 2, basePrice: 2000, translations: names('عصير', 'Juice') },
  });
  juice = p2.id;
  sizeS = (await prisma().productVariant.create({ data: { menuId: menuA, productId: burger, priceDelta: 0, isDefault: true, translations: names('صغير', 'Small') } })).id;
  sizeL = (await prisma().productVariant.create({ data: { menuId: menuA, productId: burger, priceDelta: 1500, translations: names('كبير', 'Large'), sortOrder: 1 } })).id;
  const extras = await prisma().modifierGroup.create({
    data: { menuId: menuA, productId: burger, minSelect: 0, maxSelect: 2, translations: names('إضافات', 'Extras') },
  });
  cheese = (await prisma().modifierOption.create({ data: { menuId: menuA, groupId: extras.id, priceDelta: 500, translations: names('جبن', 'Cheese') } })).id;
  bacon = (await prisma().modifierOption.create({ data: { menuId: menuA, groupId: extras.id, priceDelta: 750, translations: names('لحم مقدد', 'Bacon'), sortOrder: 1 } })).id;

  // A product of another restaurant's menu.
  const other = await prisma().menu.create({
    data: { restaurantId: b.id, name: 'mb', slug: 'menu-b', currency: 'IQD', locales: ['ar'], defaultLocale: 'ar', timezone: 'Asia/Baghdad' },
  });
  const otherCategory = await prisma().category.create({ data: { menuId: other.id, slug: 'x', sortOrder: 1, translations: names('x') } });
  outsideProduct = (
    await prisma().product.create({ data: { menuId: other.id, categoryId: otherCategory.id, slug: 'x', sortOrder: 1, basePrice: 100, translations: names('x') } })
  ).id;

  const areaId = dataOf(await run(manager, createPosArea, { name: 'Hall' })).areaId;
  await run(manager, createPosTables, { areaId, from: 1, to: 3 });
  tables = (await prisma().posTable.findMany({ where: { restaurantId: a.id }, orderBy: { number: 'asc' }, select: { id: true, number: true } }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

const open = async (who: Person = cashier, table = tables[0]!) => dataOf(await run(who, openPosOrder, { tableId: table.id }));
const view = async (orderId: string, who: Person = cashier) => dataOf(await ask(who, posOrder, { orderId }));

describe('opening an order', () => {
  it('opens an order at a free table, and refuses a second live order there', async () => {
    const first = await open();
    expect(first.number).toBe(1);
    expect(codeOf(await run(cashier, openPosOrder, { tableId: tables[0]!.id }))).toBe('CONFLICT');
    expect((await open(cashier, tables[1]!)).number).toBe(2);
  });

  it('lets exactly one of two simultaneous opens on one table win', async () => {
    const results = await Promise.all([run(cashier, openPosOrder, { tableId: tables[2]!.id }), run(manager, openPosOrder, { tableId: tables[2]!.id })]);
    expect(results.map(codeOf).sort()).toEqual(['CONFLICT', 'OK']);
    expect(await prisma().posOrder.count({ where: { restaurantId: a.id, tableId: tables[2]!.id } })).toBe(1);
  });

  it('keeps the kitchen out and another restaurant from reaching the table', async () => {
    expect(codeOf(await run(kitchen, openPosOrder, { tableId: tables[0]!.id }))).toBe('FORBIDDEN');
    expect(codeOf(await run(bManager, openPosOrder, { tableId: tables[0]!.id }))).toBe('NOT_FOUND');
  });
});

describe('adding and pricing lines', () => {
  it('prices (base + size + options) x quantity and freezes names in the menu language', async () => {
    const { orderId, version } = await open();
    const added = dataOf(
      await run(cashier, addPosLine, { orderId, productId: burger, quantity: 2, note: ' no onion ', variantId: sizeL, optionIds: [cheese, bacon], expectedVersion: version }),
    );
    const v = await view(orderId);
    expect(v.version).toBe(added.version);
    const line = v.lines[0]!;
    expect(line.name).toBe('برغر');
    expect(line.note).toBe('no onion');
    expect(line.options.map((o) => o.name)).toEqual(['كبير', 'جبن', 'لحم مقدد']);
    expect(line.lineTotal).toBe((5000 + 1500 + 500 + 750) * 2);
    expect(v.totals.subtotal).toBe(15500);
  });

  it('uses the default size when none is named', async () => {
    const { orderId, version } = await open();
    dataOf(await run(cashier, addPosLine, { orderId, productId: burger, quantity: 1, note: '', optionIds: [], expectedVersion: version }));
    expect((await view(orderId)).lines[0]!.options.map((o) => o.id)).toEqual([sizeS]);
  });

  it('refuses a stale version and adds nothing', async () => {
    const { orderId, version } = await open();
    dataOf(await run(cashier, addPosLine, { orderId, productId: juice, quantity: 1, note: '', optionIds: [], expectedVersion: version }));
    expect(codeOf(await run(cashier, addPosLine, { orderId, productId: juice, quantity: 1, note: '', optionIds: [], expectedVersion: version }))).toBe('CONFLICT');
    expect((await view(orderId)).lines).toHaveLength(1);
  });

  it('refuses a product of another restaurant, a sold-out one, and a foreign option', async () => {
    const { orderId, version } = await open();
    const base = { orderId, quantity: 1, note: '', optionIds: [] as string[], expectedVersion: version };
    expect(codeOf(await run(cashier, addPosLine, { ...base, productId: outsideProduct }))).toBe('NOT_FOUND');
    expect(codeOf(await run(cashier, addPosLine, { ...base, productId: juice, optionIds: [cheese] }))).toBe('NOT_FOUND');
    await prisma().posProductSetting.create({ data: { restaurantId: a.id, productId: juice, soldOutOverride: true } });
    expect(codeOf(await run(cashier, addPosLine, { ...base, productId: juice }))).toBe('CONFLICT');
  });

  it('sells a product hidden from the public menu', async () => {
    await prisma().product.update({ where: { id: juice }, data: { isHidden: true } });
    const { orderId, version } = await open();
    expect(codeOf(await run(cashier, addPosLine, { orderId, productId: juice, quantity: 1, note: '', optionIds: [], expectedVersion: version }))).toBe('OK');
  });

  it('refuses too many options for a group and a required group left empty', async () => {
    const group = await prisma().modifierGroup.create({
      data: { menuId: menuA, productId: juice, minSelect: 1, maxSelect: 1, translations: names('سكر', 'Sugar') },
    });
    const sugar = await prisma().modifierOption.create({ data: { menuId: menuA, groupId: group.id, translations: names('بدون', 'None') } });
    const { orderId, version } = await open();
    const base = { orderId, productId: juice, quantity: 1, note: '', expectedVersion: version };
    expect(codeOf(await run(cashier, addPosLine, { ...base, optionIds: [] }))).toBe('INVALID');
    expect(codeOf(await run(cashier, addPosLine, { ...base, optionIds: [sugar.id] }))).toBe('OK');
    const { orderId: o2, version: v2 } = await open(cashier, tables[1]!);
    expect(
      codeOf(await run(cashier, addPosLine, { orderId: o2, productId: burger, quantity: 1, note: '', optionIds: [cheese, bacon, cheese], expectedVersion: v2 })),
    ).toBe('INVALID');
  });
});

describe('changing lines and discounts', () => {
  async function withLine() {
    const { orderId, version } = await open();
    const added = dataOf(await run(cashier, addPosLine, { orderId, productId: juice, quantity: 3, note: '', optionIds: [], expectedVersion: version }));
    return { orderId, lineId: added.lineId, version: added.version };
  }

  it('changes quantity and note, and rejects a discount larger than the line', async () => {
    const { orderId, lineId, version } = await withLine();
    const updated = dataOf(await run(cashier, updatePosLine, { lineId, quantity: 4, note: 'cold', expectedVersion: version }));
    expect((await view(orderId)).lines[0]).toMatchObject({ quantity: 4, note: 'cold' });
    expect(failureOf(await run(cashier, updatePosLine, { lineId, discount: { kind: 'AMOUNT', value: 8001 }, expectedVersion: updated.version })).code).toBe('INVALID');
    dataOf(await run(cashier, updatePosLine, { lineId, discount: { kind: 'AMOUNT', value: 8000 }, expectedVersion: updated.version }));
    expect((await view(orderId)).totals.subtotal).toBe(0);
  });

  it('applies an invoice percent discount with service and tax like computeTotals', async () => {
    await prisma().posSettings.update({ where: { restaurantId: a.id }, data: { serviceRatePercent: 10, taxRatePercent: 5 } });
    const { orderId, version } = await withLine();
    dataOf(await run(cashier, setPosInvoiceDiscount, { orderId, discount: { kind: 'PERCENT', value: 10 }, expectedVersion: version }));
    const v = await view(orderId);
    // 6000 - 600 = 5400; service 540; tax 5% of (5400 + 540) = 297; 6237 in all.
    expect(v.totals).toMatchObject({ subtotal: 6000, invoiceDiscount: 600, service: 540, tax: 297, total: 6237 });
    expect(v.invoiceDiscount).toEqual({ kind: 'PERCENT', value: 10 });
  });

  it('lets a cashier discount (order.discount) but keeps the kitchen out', async () => {
    const { lineId, version } = await withLine();
    expect(codeOf(await run(kitchen, updatePosLine, { lineId, quantity: 1, expectedVersion: version }))).toBe('FORBIDDEN');
  });

  it('refuses to cancel a line without a reason, then cancels it and keeps it with the reason', async () => {
    const { orderId, lineId, version } = await withLine();
    expect(codeOf(await run(cashier, cancelPosLine, { lineId, reason: '  ', expectedVersion: version }))).toBe('INVALID');
    const done = dataOf(await run(cashier, cancelPosLine, { lineId, reason: 'wrong item', expectedVersion: version }));
    const v = await view(orderId);
    expect(v.lines[0]).toMatchObject({ cancelled: true, cancelReason: 'wrong item' });
    expect(v.totals.subtotal).toBe(0);
    expect(codeOf(await run(cashier, updatePosLine, { lineId, quantity: 1, expectedVersion: done.version }))).toBe('CONFLICT');
  });
});

describe('the bill, cancelling and moving', () => {
  it('requests the bill, and adding a line reopens the order', async () => {
    const { orderId, version } = await open();
    const added = dataOf(await run(cashier, addPosLine, { orderId, productId: juice, quantity: 1, note: '', optionIds: [], expectedVersion: version }));
    const billed = dataOf(await run(cashier, requestPosBill, { orderId, expectedVersion: added.version }));
    expect((await view(orderId)).status).toBe('BILL_REQUESTED');
    dataOf(await run(cashier, addPosLine, { orderId, productId: juice, quantity: 1, note: '', optionIds: [], expectedVersion: billed.version }));
    expect((await view(orderId)).status).toBe('OPEN');
  });

  it('cancels an empty order freely and frees its table', async () => {
    const { orderId, version } = await open();
    dataOf(await run(cashier, cancelPosOrder, { orderId, reason: '', expectedVersion: version }));
    expect((await open()).number).toBe(2);
  });

  it('needs a reason to cancel an order with lines', async () => {
    const { orderId, version } = await open();
    const added = dataOf(await run(cashier, addPosLine, { orderId, productId: juice, quantity: 1, note: '', optionIds: [], expectedVersion: version }));
    expect(codeOf(await run(cashier, cancelPosOrder, { orderId, reason: '', expectedVersion: added.version }))).toBe('INVALID');
    dataOf(await run(cashier, cancelPosOrder, { orderId, reason: 'guest left', expectedVersion: added.version }));
    expect((await view(orderId)).status).toBe('CANCELLED');
    expect(codeOf(await run(cashier, addPosLine, { orderId, productId: juice, quantity: 1, note: '', optionIds: [], expectedVersion: added.version + 1 }))).toBe('CONFLICT');
  });

  it('moves an order to a free table and refuses an occupied one', async () => {
    const first = await open();
    await open(cashier, tables[1]!);
    expect(codeOf(await run(cashier, movePosOrderToTable, { orderId: first.orderId, tableId: tables[1]!.id, expectedVersion: first.version }))).toBe('CONFLICT');
    dataOf(await run(cashier, movePosOrderToTable, { orderId: first.orderId, tableId: tables[2]!.id, expectedVersion: first.version }));
    expect((await view(first.orderId)).tableNumber).toBe(3);
  });

  it('answers CONFLICT, not a generic error, for the order that loses a race for the same free table', async () => {
    const first = await open(cashier, tables[0]!);
    const second = await open(cashier, tables[1]!);
    const results = await Promise.all([
      run(cashier, movePosOrderToTable, { orderId: first.orderId, tableId: tables[2]!.id, expectedVersion: first.version }),
      run(cashier, movePosOrderToTable, { orderId: second.orderId, tableId: tables[2]!.id, expectedVersion: second.version }),
    ]);
    expect(results.map((r) => (r.ok ? 'OK' : codeOf(r))).sort()).toEqual(['CONFLICT', 'OK']);
  });

  it('audits what changed', async () => {
    const { orderId, version } = await open();
    dataOf(await run(cashier, addPosLine, { orderId, productId: juice, quantity: 1, note: '', optionIds: [], expectedVersion: version }));
    const actions = (await prisma().auditLog.findMany({ where: { restaurantId: a.id }, select: { action: true } })).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['pos.order.open', 'pos.order.line.add']));
  });

  it("does not show another restaurant's order", async () => {
    const { orderId } = await open();
    expect(codeOf(await ask(bManager, posOrder, { orderId }) as never)).toBe('NOT_FOUND');
  });
});
