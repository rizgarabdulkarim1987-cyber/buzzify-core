import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadTillCatalog } from '@/server/pos/till-catalog';
import { localClock } from '@/server/domain/schedule';
import { addPosLine, openPosOrder, updatePosLine } from '@/server/studio/actions/pos-orders';
import { createPosArea, createPosTables } from '@/server/studio/actions/pos';
import { payPosOrder } from '@/server/studio/actions/pos-payments';
import { openPosShift } from '@/server/studio/actions/pos-shifts';
import { posOrder, posReceipt, posShiftReport } from '@/server/studio/queries/pos';
import { ask, dataOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const names = (ar: string, en = ar) => ({ ar: { name: ar }, en: { name: en } });

let a: { id: string };
let manager: Person;
let cashier: Person;
let menuId: string;
let foodId: string;
let drinksId: string;
let burger: string;
let juice: string;
let sizeL: string;
let cheese: string;
let tableId: string;

async function offer(data: { percentOff?: number; productIds?: string[]; categoryIds?: string[]; endsOn?: string | null; startMinute?: number | null; endMinute?: number | null; isActive?: boolean; kind?: 'DISCOUNT' | 'SPECIAL' }) {
  return prisma().promotion.create({
    data: {
      menuId,
      kind: data.kind ?? 'DISCOUNT',
      percentOff: data.kind === 'SPECIAL' ? null : (data.percentOff ?? 20),
      productIds: data.productIds ?? [],
      categoryIds: data.categoryIds ?? [],
      endsOn: data.endsOn ?? null,
      startMinute: data.startMinute ?? null,
      endMinute: data.endMinute ?? null,
      isActive: data.isActive ?? true,
      translations: { en: { title: 'Offer', text: '' } },
    },
  });
}

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await resetWorld();
  a = await restaurant('Offers A');
  // Timed offers are a PRO feature (`selling.offers`).
  await prisma().restaurant.update({ where: { id: a.id }, data: { plan: 'PRO' } });
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  const menu = await prisma().menu.create({
    data: { restaurantId: a.id, name: 'm', slug: 'menu-offers', currency: 'IQD', priceStep: 250, locales: ['ar', 'en'], defaultLocale: 'ar', timezone: 'Asia/Baghdad' },
  });
  menuId = menu.id;
  await prisma().posSettings.upsert({ where: { restaurantId: a.id }, create: { restaurantId: a.id, catalogMenuId: menuId, requireApproval: false }, update: { catalogMenuId: menuId, requireApproval: false } });
  foodId = (await prisma().category.create({ data: { menuId, slug: 'food', sortOrder: 1, translations: names('أكل', 'Food') } })).id;
  drinksId = (await prisma().category.create({ data: { menuId, slug: 'drinks', sortOrder: 2, translations: names('مشروبات', 'Drinks') } })).id;
  burger = (await prisma().product.create({ data: { menuId, categoryId: foodId, slug: 'burger', sortOrder: 1, basePrice: 5000, translations: names('برغر', 'Burger') } })).id;
  juice = (await prisma().product.create({ data: { menuId, categoryId: drinksId, slug: 'juice', sortOrder: 1, basePrice: 2000, translations: names('عصير', 'Juice') } })).id;
  await prisma().productVariant.create({ data: { menuId, productId: burger, priceDelta: 0, isDefault: true, translations: names('صغير', 'Small') } });
  sizeL = (await prisma().productVariant.create({ data: { menuId, productId: burger, priceDelta: 1500, translations: names('كبير', 'Large'), sortOrder: 1 } })).id;
  const extras = await prisma().modifierGroup.create({ data: { menuId, productId: burger, minSelect: 0, maxSelect: 2, translations: names('إضافات', 'Extras') } });
  cheese = (await prisma().modifierOption.create({ data: { menuId, groupId: extras.id, priceDelta: 500, translations: names('جبن', 'Cheese') } })).id;
  const areaId = dataOf(await run(manager, createPosArea, { name: 'Hall' })).areaId;
  await run(manager, createPosTables, { areaId, from: 1, to: 1 });
  tableId = (await prisma().posTable.findFirstOrThrow({ where: { restaurantId: a.id } })).id;
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

async function add(productId: string, extra: { quantity?: number; variantId?: string; optionIds?: string[]; clientAt?: string } = {}) {
  const opened = dataOf(await run(cashier, openPosOrder, { tableId }));
  const added = dataOf(
    await run(cashier, addPosLine, { orderId: opened.orderId, productId, quantity: extra.quantity ?? 1, note: '', optionIds: extra.optionIds ?? [], expectedVersion: opened.version, ...(extra.variantId ? { variantId: extra.variantId } : {}), ...(extra.clientAt ? { clientAt: extra.clientAt } : {}) }),
  );
  const view = dataOf(await ask(cashier, posOrder, { orderId: opened.orderId }));
  return { orderId: opened.orderId, lineId: added.lineId, version: added.version, view, line: view.lines[0]! };
}

describe('a dish under a live menu offer, added at the till', () => {
  it('is sold at the sale price, with the offer kept on the line and the regular price left as it was', async () => {
    await offer({ percentOff: 20, productIds: [burger] });
    const { line, view, lineId } = await add(burger, { quantity: 2 });
    expect(line).toMatchObject({ unitPrice: 5000, offerPerUnit: 1000, lineTotal: 8000, discount: null });
    expect(view.totals.subtotal).toBe(8000);
    expect(await prisma().posOrderLine.findUniqueOrThrow({ where: { id: lineId } })).toMatchObject({ unitPriceSnapshot: 5000, promoDiscountPerUnit: 1000, discountKind: null });
  });

  it('discounts the whole unit, size and options included, rounded to the menu step like the menu does', async () => {
    await offer({ percentOff: 20, productIds: [burger] });
    // 5,000 + 1,500 + 500 = 7,000; 20% off = 5,600, which the 250 step rounds to 5,500.
    const { line } = await add(burger, { variantId: sizeL, optionIds: [cheese] });
    expect(line).toMatchObject({ offerPerUnit: 1500, lineTotal: 5500 });
  });

  it('follows a category offer, and takes the largest of two', async () => {
    await offer({ percentOff: 10, categoryIds: [drinksId] });
    await offer({ percentOff: 50, productIds: [juice] });
    const { line } = await add(juice);
    expect(line).toMatchObject({ offerPerUnit: 1000, lineTotal: 1000 });
  });

  it('is not touched by an offer that names another dish, has ended, is off, or is a special', async () => {
    await offer({ percentOff: 30, productIds: [juice] });
    await offer({ percentOff: 30, productIds: [burger], endsOn: '2020-01-01' });
    await offer({ percentOff: 30, productIds: [burger], isActive: false });
    await offer({ kind: 'SPECIAL', productIds: [burger] });
    const { line } = await add(burger);
    expect(line).toMatchObject({ offerPerUnit: 0, lineTotal: 5000 });
  });

  it('gets nothing on a plan without timed offers, as guests do not see them either', async () => {
    await offer({ percentOff: 20, productIds: [burger] });
    await prisma().restaurant.update({ where: { id: a.id }, data: { plan: 'BASIC' } });
    const { line } = await add(burger);
    expect(line).toMatchObject({ offerPerUnit: 0, lineTotal: 5000 });
  });

  it('keeps the offer when the quantity changes, and stacks a manual discount on the sale price', async () => {
    await offer({ percentOff: 20, productIds: [burger] });
    const { orderId, lineId, version } = await add(burger, { quantity: 2 });
    const more = dataOf(await run(cashier, updatePosLine, { lineId, quantity: 3, expectedVersion: version }));
    let view = dataOf(await ask(cashier, posOrder, { orderId }));
    expect(view.lines[0]).toMatchObject({ offerPerUnit: 1000, lineTotal: 12000 });
    // 10% of the 12,000 that is left, not of the 15,000 gross.
    const manual = dataOf(await run(cashier, updatePosLine, { lineId, discount: { kind: 'PERCENT', value: 10, reason: 'MANAGER_DECISION' }, expectedVersion: more.version }));
    view = dataOf(await ask(cashier, posOrder, { orderId }));
    expect(view.lines[0]).toMatchObject({ offerPerUnit: 1000, lineTotal: 10800 });
    expect(view.totals.subtotal).toBe(10800);
    // An amount larger than what the offer left is refused: 12,000 is all that can still come off.
    const tooMuch = await run(cashier, updatePosLine, { lineId, discount: { kind: 'AMOUNT', value: 12001, reason: 'MANAGER_DECISION' }, expectedVersion: manual.version });
    expect(tooMuch.ok).toBe(false);
    dataOf(await run(cashier, updatePosLine, { lineId, discount: { kind: 'AMOUNT', value: 12000, reason: 'MANAGER_DECISION' }, expectedVersion: manual.version }));
    view = dataOf(await ask(cashier, posOrder, { orderId }));
    expect(view.totals.subtotal).toBe(0);
  });
});

describe('a line added offline and replayed later', () => {
  /** An offer that was live an hour ago and has ended since, in the menu's own clock. */
  async function endedHalfAnHourAgo() {
    const minute = localClock(new Date(), 'Asia/Baghdad').minute;
    const wrap = (m: number) => (m + 1440) % 1440;
    await offer({ percentOff: 20, productIds: [burger], startMinute: wrap(minute - 120), endMinute: wrap(minute - 30) });
  }

  it('is priced at the time the cashier tapped the dish, so an offer that ended while offline still counts', async () => {
    await endedHalfAnHourAgo();
    const tapped = new Date(Date.now() - 60 * 60_000).toISOString();
    const { line } = await add(burger, { clientAt: tapped });
    expect(line).toMatchObject({ offerPerUnit: 1000, lineTotal: 4000 });
  });

  it('is priced now when the device sends no time, or one in the future or older than 12 hours', async () => {
    await endedHalfAnHourAgo();
    for (const clientAt of [undefined, new Date(Date.now() + 60 * 60_000).toISOString(), new Date(Date.now() - 13 * 60 * 60_000).toISOString()]) {
      await prisma().posOrder.deleteMany({ where: { restaurantId: a.id } });
      const { line } = await add(burger, { clientAt });
      expect(line).toMatchObject({ offerPerUnit: 0, lineTotal: 5000 });
    }
  });
});

describe('paying and reporting a line sold with the offer', () => {
  it('prints the offer on the receipt, and the shift report counts it as a discount (gross stays what was taken)', async () => {
    await offer({ percentOff: 20, productIds: [burger] });
    const shiftId = dataOf(await run(cashier, openPosShift, { openingFloat: 0 })).shiftId;
    const { orderId, lineId, version } = await add(burger, { quantity: 2 });
    // A manual 10% on top: 10% of the 8,000 that is left = 800.
    const manual = dataOf(await run(cashier, updatePosLine, { lineId, discount: { kind: 'PERCENT', value: 10, reason: 'MANAGER_DECISION' }, expectedVersion: version }));
    dataOf(await run(cashier, payPosOrder, { orderId, expectedVersion: manual.version, expectedTotal: 7200, amountReceived: 7200 }));

    const receipt = dataOf(await ask(cashier, posReceipt, { orderId }));
    expect(receipt.snapshot.lines[0]).toMatchObject({ unitPrice: 5000, promoPerUnit: 1000, quantity: 2, lineTotal: 7200 });
    const report = dataOf(await ask(manager, posShiftReport, { shiftId }));
    // 10,000 of food at the regular price: 2,000 offer + 800 manual taken off, 7,200 paid.
    expect(report).toMatchObject({ grossSales: 7200, discountsTotal: 2800 });
  });
});

describe('the till catalog carries the offers for the device', () => {
  it('lists the active discounts with the menu time zone, and none on a plan without timed offers', async () => {
    const live = await offer({ percentOff: 15, categoryIds: [drinksId] });
    await offer({ kind: 'SPECIAL', productIds: [burger] });
    await offer({ percentOff: 40, productIds: [burger], isActive: false });
    const catalog = (await loadTillCatalog(prisma(), a.id))!;
    expect(catalog.timeZone).toBe('Asia/Baghdad');
    expect(catalog.offers).toEqual([expect.objectContaining({ id: live.id, percentOff: 15, categoryIds: [drinksId], roundTo: 250 })]);
    await prisma().restaurant.update({ where: { id: a.id }, data: { plan: 'BASIC' } });
    expect((await loadTillCatalog(prisma(), a.id))!.offers).toEqual([]);
  });
});
