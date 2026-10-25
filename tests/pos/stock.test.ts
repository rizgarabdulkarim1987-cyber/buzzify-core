import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpAnswer } from '@/lib/pos-sync/op-schema';
import { applyOperations } from '@/server/pos/sync';
import { createPosArea, createPosTables } from '@/server/studio/actions/pos';
import { addPosLine, openPosOrder } from '@/server/studio/actions/pos-orders';
import { payPosOrder } from '@/server/studio/actions/pos-payments';
import { adjustPosStock, createPosItem, createPosPurchase, createPosSupplier, recordPosStockCount, recordPosWaste, setPosPurchasePaid, setPosRecipe, updatePosItem, voidPosPurchase } from '@/server/studio/actions/pos-inventory';
import { openPosShift } from '@/server/studio/actions/pos-shifts';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { baghdadDayOf } from '@/lib/baghdad';
import { posInventoryItem, posInventoryItems, posLowStock, posPurchases, posRangeReport, posRecipe } from '@/server/studio/queries/pos-inventory';
import { ask, codeOf, dataOf, failureOf, META, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };
let b: { id: string };
let manager: Person;
let cashier: Person;
let bManager: Person;
let burger: string;
let tableId: string;
let tableId2: string;
const device = randomUUID();

const names = (ar: string, en = ar) => ({ ar: { name: ar }, en: { name: en } });

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await resetWorld();
  a = await restaurant('Stock A');
  b = await restaurant('Stock B');
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  bManager = await person('bmanager', { staff: [b.id, 'MANAGER'] });
  const menu = await prisma().menu.create({
    data: { restaurantId: a.id, name: 'm', slug: 'menu-a', currency: 'IQD', locales: ['ar', 'en'], defaultLocale: 'ar', timezone: 'Asia/Baghdad' },
  });
  await prisma().posSettings.upsert({ where: { restaurantId: a.id }, create: { restaurantId: a.id, catalogMenuId: menu.id }, update: { catalogMenuId: menu.id } });
  const category = await prisma().category.create({ data: { menuId: menu.id, slug: 'food', sortOrder: 1, translations: names('أكل', 'Food') } });
  burger = (await prisma().product.create({ data: { menuId: menu.id, categoryId: category.id, slug: 'burger', sortOrder: 1, basePrice: 5000, translations: names('برغر', 'Burger') } })).id;
  const areaId = dataOf(await run(manager, createPosArea, { name: 'Hall' })).areaId;
  await run(manager, createPosTables, { areaId, from: 1, to: 2 });
  const tables = await prisma().posTable.findMany({ where: { restaurantId: a.id }, orderBy: { number: 'asc' } });
  tableId = tables[0]!.id;
  tableId2 = tables[1]!.id;
  dataOf(await run(cashier, openPosShift, { openingFloat: 0 }));
  supplier = dataOf(await run(manager, createPosSupplier, { name: 'Baghdad Meats', phone: '', notes: '' })).supplierId;
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

const newItem = async (name = 'Beef', unit: 'GRAM' | 'MILLILITER' | 'PIECE' = 'GRAM', reorderLevel = 0, who: Person = manager) => dataOf(await run(who, createPosItem, { name, unit, reorderLevel })).itemId;
const onHand = async (itemId: string) => (await prisma().posInventoryItem.findFirstOrThrow({ where: { id: itemId } })).onHand;
let supplier: string;
const buy = async (itemId: string, quantity: number, lineTotal: number, extra: Record<string, unknown> = {}) =>
  run(manager, createPosPurchase, { clientKey: randomUUID(), supplierId: supplier, invoiceDay: '2026-10-25', lines: [{ itemId, quantity, lineTotal }], ...extra });

async function orderOf(quantity: number, table = tableId) {
  const opened = dataOf(await run(cashier, openPosOrder, { tableId: table }));
  const added = dataOf(await run(cashier, addPosLine, { orderId: opened.orderId, productId: burger, quantity, note: '', optionIds: [], expectedVersion: opened.version }));
  return { orderId: opened.orderId, version: added.version };
}

describe('stock items', () => {
  it('creates an item, refuses a second with the same name, and keeps cashiers out', async () => {
    await newItem('Beef');
    expect(failureOf(await run(manager, createPosItem, { name: ' beef ', unit: 'GRAM', reorderLevel: 0 }))).toMatchObject({ code: 'CONFLICT' });
    expect(codeOf(await run(cashier, createPosItem, { name: 'Salt', unit: 'GRAM', reorderLevel: 0 }))).not.toBe('OK');
    const rows = dataOf(await ask(cashier, posInventoryItems, {}));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Beef', onHand: 0, lastCost: null });
  });

  it('adjusts up and down, lets stock go negative, and flags it as a count needed', async () => {
    const id = await newItem();
    await run(manager, adjustPosStock, { itemId: id, quantity: 500, reason: 'opening' });
    await run(manager, adjustPosStock, { itemId: id, quantity: -800, reason: 'spill' });
    expect(await onHand(id)).toBe(-300);
    expect(dataOf(await ask(manager, posLowStock, {})).map((row) => [row.name, row.state])).toEqual([['Beef', 'negative']]);
    expect(codeOf(await run(manager, adjustPosStock, { itemId: id, quantity: 0, reason: 'x' }))).toBe('INVALID');
  });

  it('records waste out of stock, with an unknown cost kept as null and never as 0', async () => {
    const id = await newItem();
    await run(manager, adjustPosStock, { itemId: id, quantity: 1000, reason: 'opening' });
    dataOf(await run(manager, recordPosWaste, { itemId: id, quantity: 250, reason: 'spoiled' }));
    expect(await onHand(id)).toBe(750);
    const moved = await prisma().posStockMovement.findFirstOrThrow({ where: { itemId: id, kind: 'WASTE' } });
    expect(moved).toMatchObject({ quantity: -250, costTotal: null });
  });

  it('counts: sets the quantity, writes the difference, and refuses the same item twice', async () => {
    const id = await newItem();
    await run(manager, adjustPosStock, { itemId: id, quantity: 1000, reason: 'opening' });
    expect(dataOf(await run(manager, recordPosStockCount, { note: '', lines: [{ itemId: id, counted: 900 }] }))).toMatchObject({ changed: 1 });
    expect(await onHand(id)).toBe(900);
    expect(await prisma().posStockMovement.findFirstOrThrow({ where: { itemId: id, kind: 'COUNT' } })).toMatchObject({ quantity: -100 });
    expect(codeOf(await run(manager, recordPosStockCount, { note: '', lines: [{ itemId: id, counted: 1 }, { itemId: id, counted: 2 }] }))).not.toBe('OK');
    expect(await onHand(id)).toBe(900);
  });

  it('never shows another restaurant its items', async () => {
    const id = await newItem();
    expect(dataOf(await ask(bManager, posInventoryItems, {}))).toEqual([]);
    expect(codeOf(await ask(bManager, posInventoryItem, { itemId: id }))).toBe('NOT_FOUND');
    expect(codeOf(await run(bManager, adjustPosStock, { itemId: id, quantity: 5, reason: 'x' }))).toBe('NOT_FOUND');
  });
});

describe('purchase invoices', () => {
  it('adds goods to stock and remembers the last cost; a second save with the same key is refused', async () => {
    const id = await newItem();
    const clientKey = randomUUID();
    const input = { clientKey, supplierId: supplier, invoiceDay: '2026-10-25', lines: [{ itemId: id, quantity: 2000, lineTotal: 10_000 }] };
    const saved = dataOf(await run(manager, createPosPurchase, input));
    expect(await onHand(id)).toBe(2000);
    expect(dataOf(await ask(manager, posInventoryItem, { itemId: id })).item.lastCost).toEqual({ amount: 10_000, quantity: 2000 });
    expect(failureOf(await run(manager, createPosPurchase, input))).toMatchObject({ code: 'CONFLICT' });
    expect(await onHand(id)).toBe(2000);
    expect(saved.invoiceId).toBeTruthy();
  });

  it('hides cost from a cashier, who can still read the stock', async () => {
    const id = await newItem();
    dataOf(await buy(id, 1000, 5000));
    expect(dataOf(await ask(cashier, posInventoryItem, { itemId: id })).item.lastCost).toBeNull();
    expect(codeOf(await ask(cashier, posPurchases, {}))).not.toBe('OK');
  });

  it('voids by taking the goods back out, once, and keeps the invoice', async () => {
    const id = await newItem();
    const saved = dataOf(await buy(id, 1000, 5000));
    dataOf(await run(manager, voidPosPurchase, { invoiceId: saved.invoiceId, reason: 'wrong supplier' }));
    expect(await onHand(id)).toBe(0);
    expect(codeOf(await run(manager, voidPosPurchase, { invoiceId: saved.invoiceId, reason: 'again' }))).toBe('CONFLICT');
    expect(await onHand(id)).toBe(0);
    expect(await prisma().posPurchaseInvoice.count({ where: { restaurantId: a.id } })).toBe(1);
  });

  it('tracks paid and unpaid as a record that never touches a cash drawer', async () => {
    const id = await newItem();
    const saved = dataOf(await buy(id, 1000, 5000));
    expect(dataOf(await ask(manager, posPurchases, { unpaidOnly: true }))).toHaveLength(1);
    dataOf(await run(manager, setPosPurchasePaid, { invoiceId: saved.invoiceId, paid: true, method: 'BANK' }));
    expect(dataOf(await ask(manager, posPurchases, { unpaidOnly: true }))).toHaveLength(0);
    expect(await prisma().posCashExpense.count()).toBe(0);
  });
});

describe('recipes and sales', () => {
  async function stocked() {
    const beef = await newItem('Beef');
    dataOf(await buy(beef, 1000, 5000));
    dataOf(await run(manager, setPosRecipe, { productId: burger, lines: [{ itemId: beef, quantity: 200 }] }));
    return beef;
  }

  it('reads the recipe back and refuses another restaurant a product of this one', async () => {
    const beef = await stocked();
    expect(dataOf(await ask(manager, posRecipe, { productId: burger })).lines.map((line) => [line.itemId, line.quantity])).toEqual([[beef, 200]]);
    const other = await newItem('Rice', 'GRAM', 0, bManager);
    expect(codeOf(await run(bManager, setPosRecipe, { productId: burger, lines: [{ itemId: other, quantity: 5 }] }))).not.toBe('OK');
  });

  it('takes the recipe out of stock when an order is paid, with the cost frozen at the last price', async () => {
    const beef = await stocked();
    const { orderId, version } = await orderOf(2);
    dataOf(await run(cashier, payPosOrder, { orderId, expectedVersion: version, expectedTotal: 10_000, amountReceived: 10_000 }));
    expect(await onHand(beef)).toBe(600);
    const sale = await prisma().posStockMovement.findMany({ where: { itemId: beef, kind: 'SALE' } });
    expect(sale).toHaveLength(1);
    // 5,000 IQD for 1,000 g is 5 IQD a gram: 400 g cost 2,000.
    expect(sale[0]).toMatchObject({ quantity: -400, costTotal: 2000 });
    // A later, dearer purchase does not rewrite the sale already made.
    dataOf(await buy(beef, 1000, 20_000));
    expect((await prisma().posStockMovement.findFirstOrThrow({ where: { itemId: beef, kind: 'SALE' } })).costTotal).toBe(2000);
  });

  it('leaves an unknown cost as null, and a dish with no recipe uses nothing', async () => {
    const rice = await newItem('Rice');
    dataOf(await run(manager, setPosRecipe, { productId: burger, lines: [{ itemId: rice, quantity: 100 }] }));
    const { orderId, version } = await orderOf(1);
    dataOf(await run(cashier, payPosOrder, { orderId, expectedVersion: version, expectedTotal: 5000, amountReceived: 5000 }));
    expect(await onHand(rice)).toBe(-100);
    expect((await prisma().posStockMovement.findFirstOrThrow({ where: { itemId: rice, kind: 'SALE' } })).costTotal).toBeNull();
    dataOf(await run(manager, setPosRecipe, { productId: burger, lines: [] }));
    const second = await orderOf(1, tableId2);
    dataOf(await run(cashier, payPosOrder, { orderId: second.orderId, expectedVersion: second.version, expectedTotal: 5000, amountReceived: 5000 }));
    expect(await onHand(rice)).toBe(-100);
  });

  it('will not switch off an item a recipe uses, and will not buy or adjust one that is off', async () => {
    const beef = await stocked();
    expect(failureOf(await run(manager, updatePosItem, { itemId: beef, active: false }))).toMatchObject({ code: 'CONFLICT' });
    dataOf(await run(manager, setPosRecipe, { productId: burger, lines: [] }));
    dataOf(await run(manager, updatePosItem, { itemId: beef, active: false }));
    expect(codeOf(await buy(beef, 100, 500))).toBe('CONFLICT');
    expect(codeOf(await run(manager, adjustPosStock, { itemId: beef, quantity: 1, reason: 'x' }))).toBe('CONFLICT');
  });
});

describe('an offline sale replayed', () => {
  const at = '2026-10-25T08:00:00.000Z';
  const send = async (who: Person, ops: Record<string, unknown>[]): Promise<OpAnswer[]> => {
    const actor = (await loadActor(prisma(), who.userId)) as Actor;
    return (await applyOperations({ prisma: prisma(), actor, meta: META }, device, ops)) ?? [];
  };

  it('takes stock once, however many times the batch arrives', async () => {
    const beef = await newItem('Beef');
    dataOf(await buy(beef, 1000, 5000));
    dataOf(await run(manager, setPosRecipe, { productId: burger, lines: [{ itemId: beef, quantity: 200 }] }));
    const openId = randomUUID();
    const base = { deviceId: device, clientAt: at };
    const ops = [
      { ...base, operationId: openId, kind: 'openOrder', payload: { tableId } },
      { ...base, operationId: randomUUID(), kind: 'addLine', orderRef: { op: openId }, expectedVersion: 1, payload: { productId: burger, quantity: 2, note: '', optionIds: [] } },
      { ...base, operationId: randomUUID(), kind: 'payCash', orderRef: { op: openId }, expectedVersion: 2, payload: { expectedTotal: 10_000, amountReceived: 10_000 } },
    ];
    await send(cashier, ops);
    expect(await onHand(beef)).toBe(600);
    await send(cashier, ops);
    await send(cashier, ops);
    expect(await onHand(beef)).toBe(600);
    expect(await prisma().posStockMovement.count({ where: { itemId: beef, kind: 'SALE' } })).toBe(1);
  });
});

describe('the report by period', () => {
  const today = () => baghdadDayOf(new Date());

  async function sold(quantity: number, table = tableId) {
    const { orderId, version } = await orderOf(quantity, table);
    dataOf(await run(cashier, payPosOrder, { orderId, expectedVersion: version, expectedTotal: quantity * 5000, amountReceived: quantity * 5000 }));
  }

  it('claims a margin only where the cost is known, and says what it does not know', async () => {
    const beef = await newItem('Beef');
    dataOf(await buy(beef, 1000, 5000, { invoiceDay: today() }));
    dataOf(await run(manager, setPosRecipe, { productId: burger, lines: [{ itemId: beef, quantity: 200 }] }));
    await sold(2);
    let report = dataOf(await ask(manager, posRangeReport, { from: today(), to: today() }));
    expect(report.totals).toMatchObject({ grossSales: 10_000, netSales: 10_000, purchasesTotal: 5000, purchasesUnpaid: 5000, purchaseCount: 1 });
    expect(report.totals.coverage).toMatchObject({ coveredSales: 10_000, coveredCost: 2000, coveredMargin: 8000, uncoveredLines: 0 });
    expect(report.products[0]).toMatchObject({ name: 'برغر', cost: 2000, margin: 8000, status: 'known' });

    dataOf(await run(manager, setPosRecipe, { productId: burger, lines: [] }));
    await sold(1, tableId2);
    report = dataOf(await ask(manager, posRangeReport, { from: today(), to: today() }));
    expect(report.totals.coverage).toMatchObject({ coveredSales: 10_000, uncoveredSales: 5000, uncoveredLines: 1 });
    expect(report.products[0]).toMatchObject({ status: 'mixed', cost: null, margin: null });
  });

  it('refuses a reversed range and one longer than 92 days', async () => {
    expect(codeOf(await ask(manager, posRangeReport, { from: '2026-10-25', to: '2026-10-24' }))).toBe('INVALID');
    expect(codeOf(await ask(manager, posRangeReport, { from: '2026-01-01', to: '2026-10-25' }))).toBe('INVALID');
    expect(codeOf(await ask(manager, posRangeReport, { from: '2026-10-25', to: '2026-10-25' }))).toBe('OK');
  });

  it('lists one row for every day of the range, empty days included', async () => {
    const report = dataOf(await ask(manager, posRangeReport, { from: '2026-10-20', to: '2026-10-25' }));
    expect(report.days.map((day) => day.day)).toEqual(['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
  });
});
