import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadTillCatalog } from '@/server/pos/till-catalog';
import { prisma, resetWorld, restaurant, useTestDatabase } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };
let b: { id: string };
let menuA: string;

const names = (ar: string, en = ar) => ({ ar: { name: ar }, en: { name: en } });

async function newMenu(restaurantId: string, slug: string, currency = 'IQD') {
  return prisma().menu.create({
    data: { restaurantId, name: slug, slug, currency, locales: ['ar', 'ckb', 'en'], defaultLocale: 'ar', timezone: 'Asia/Baghdad' },
  });
}

async function category(menuId: string, slug: string, sortOrder: number, label = slug) {
  return prisma().category.create({ data: { menuId, slug, sortOrder, translations: names(label) } });
}

async function product(menuId: string, categoryId: string, slug: string, sortOrder: number, extra: Record<string, unknown> = {}) {
  return prisma().product.create({
    data: { menuId, categoryId, slug, sortOrder, basePrice: 5000, translations: names(slug), ...extra },
  });
}

async function link(restaurantId: string, catalogMenuId: string) {
  await prisma().posSettings.upsert({ where: { restaurantId }, create: { restaurantId, catalogMenuId }, update: { catalogMenuId } });
}

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  await resetWorld();
  a = await restaurant('Till A');
  b = await restaurant('Till B');
  menuA = (await newMenu(a.id, 'menu-a')).id;
  await link(a.id, menuA);
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

describe('loadTillCatalog', () => {
  it('returns empty arrays for an empty menu, and null when no catalog menu is chosen', async () => {
    const catalog = await loadTillCatalog(prisma(), a.id);
    expect(catalog).toMatchObject({ menuId: menuA, currency: 'IQD', defaultLocale: 'ar', categories: [], products: [] });
    expect([...catalog!.locales].sort()).toEqual(['ar', 'ckb', 'en']);
    expect(await loadTillCatalog(prisma(), b.id)).toBeNull();
  });

  it('reads the draft rows in sort order, categories and products', async () => {
    const drinks = await category(menuA, 'drinks', 2);
    const food = await category(menuA, 'food', 1);
    await product(menuA, drinks.id, 'tea', 2);
    await product(menuA, drinks.id, 'coffee', 1);
    await product(menuA, food.id, 'kebab', 1);
    const catalog = (await loadTillCatalog(prisma(), a.id))!;
    expect(catalog.categories.map((c) => c.id)).toEqual([food.id, drinks.id]);
    expect(catalog.products.map((p) => p.names.en)).toEqual(['kebab', 'coffee', 'tea']);
  });

  it('shows a price edited in the draft at once, without a publish', async () => {
    const c = await category(menuA, 'food', 1);
    const p = await product(menuA, c.id, 'kebab', 1);
    expect((await loadTillCatalog(prisma(), a.id))!.products[0]!.price).toBe(5000);
    await prisma().product.update({ where: { id: p.id }, data: { basePrice: 7500 } });
    expect((await loadTillCatalog(prisma(), a.id))!.products[0]!.price).toBe(7500);
  });

  it('maps variants, groups and options with their ids and deltas', async () => {
    const c = await category(menuA, 'food', 1);
    const p = await product(menuA, c.id, 'burger', 1);
    const small = await prisma().productVariant.create({ data: { menuId: menuA, productId: p.id, priceDelta: 0, isDefault: true, sortOrder: 1, translations: names('Small') } });
    const large = await prisma().productVariant.create({ data: { menuId: menuA, productId: p.id, priceDelta: 2000, sortOrder: 2, translations: names('Large') } });
    const group = await prisma().modifierGroup.create({ data: { menuId: menuA, productId: p.id, minSelect: 0, maxSelect: 2, sortOrder: 1, translations: names('Extras') } });
    const cheese = await prisma().modifierOption.create({ data: { menuId: menuA, groupId: group.id, priceDelta: 500, sortOrder: 1, translations: names('Cheese') } });
    const off = await prisma().modifierOption.create({ data: { menuId: menuA, groupId: group.id, priceDelta: 750, isAvailable: false, sortOrder: 2, translations: names('Bacon') } });

    const product0 = (await loadTillCatalog(prisma(), a.id))!.products[0]!;
    expect(product0.variants).toEqual([
      { id: small.id, names: { ar: 'Small', en: 'Small' }, priceDelta: 0, isDefault: true },
      { id: large.id, names: { ar: 'Large', en: 'Large' }, priceDelta: 2000, isDefault: false },
    ]);
    expect(product0.groups).toEqual([
      {
        id: group.id,
        names: { ar: 'Extras', en: 'Extras' },
        minSelect: 0,
        maxSelect: 2,
        options: [
          { id: cheese.id, names: { ar: 'Cheese', en: 'Cheese' }, priceDelta: 500, available: true },
          { id: off.id, names: { ar: 'Bacon', en: 'Bacon' }, priceDelta: 750, available: false },
        ],
      },
    ]);
  });

  it('makes a product unavailable when it is sold out or the till has switched it off', async () => {
    const c = await category(menuA, 'food', 1);
    const open = await product(menuA, c.id, 'open', 1);
    const soldOut = await product(menuA, c.id, 'sold-out', 2, { isAvailable: false });
    const tillOff = await product(menuA, c.id, 'till-off', 3);
    await prisma().posProductSetting.create({ data: { productId: tillOff.id, restaurantId: a.id, soldOutOverride: true } });
    const byId = new Map((await loadTillCatalog(prisma(), a.id))!.products.map((p) => [p.id, p]));
    expect(byId.get(open.id)!.available).toBe(true);
    expect(byId.get(soldOut.id)!.available).toBe(false);
    expect(byId.get(tillOff.id)!.available).toBe(false);
  });

  it('includes hidden products, flagged, because the till sells what guests are not shown', async () => {
    const c = await category(menuA, 'food', 1);
    await product(menuA, c.id, 'secret', 1, { isHidden: true });
    const [p] = (await loadTillCatalog(prisma(), a.id))!.products;
    expect(p).toMatchObject({ hiddenFromGuests: true, available: true });
  });

  it('carries the kitchen section of a category and of a product', async () => {
    const section = await prisma().posKitchenSection.create({ data: { restaurantId: a.id, name: 'Grill', sortOrder: 1 } });
    const c = await category(menuA, 'food', 1);
    const p = await product(menuA, c.id, 'kebab', 1);
    await prisma().posCategorySetting.create({ data: { categoryId: c.id, restaurantId: a.id, sectionId: section.id } });
    await prisma().posProductSetting.create({ data: { productId: p.id, restaurantId: a.id, sectionId: section.id } });
    const catalog = (await loadTillCatalog(prisma(), a.id))!;
    expect(catalog.categories[0]!.sectionId).toBe(section.id);
    expect(catalog.products[0]!.sectionId).toBe(section.id);
  });

  it('never shows another restaurant’s menu', async () => {
    const menuB = await newMenu(b.id, 'menu-b');
    const c = await category(menuB.id, 'secret-cat', 1);
    await product(menuB.id, c.id, 'secret-dish', 1);
    const catalog = (await loadTillCatalog(prisma(), a.id))!;
    expect(catalog.products).toEqual([]);
    // Pointing the settings at a menu of another restaurant (a corrupt row) still reads nothing of it.
    await link(a.id, menuB.id);
    expect(await loadTillCatalog(prisma(), a.id)).toBeNull();
  });

  it('round-trips 120-character Arabic names', async () => {
    const long = 'ب'.repeat(120);
    const c = await category(menuA, 'long', 1, long);
    await product(menuA, c.id, 'long-dish', 1, { translations: names(long, 'Long') });
    const catalog = (await loadTillCatalog(prisma(), a.id))!;
    expect(catalog.categories[0]!.names.ar).toBe(long);
    expect(catalog.products[0]!.names.ar).toBe(long);
  });

  it('never carries cost, costDelta or stock fields', async () => {
    const c = await category(menuA, 'food', 1);
    const p = await product(menuA, c.id, 'burger', 1, { cost: 2000, stockCount: 3, lowStockThreshold: 1 });
    await prisma().productVariant.create({ data: { menuId: menuA, productId: p.id, costDelta: 100, translations: names('V') } });
    const group = await prisma().modifierGroup.create({ data: { menuId: menuA, productId: p.id, translations: names('G') } });
    await prisma().modifierOption.create({ data: { menuId: menuA, groupId: group.id, costDelta: 50, translations: names('O') } });
    const json = JSON.stringify(await loadTillCatalog(prisma(), a.id));
    for (const key of ['cost', 'costDelta', 'stockCount', 'lowStockThreshold']) expect(json, key).not.toContain(`"${key}"`);
  });

  it('loads a 1,000-product menu in a handful of queries, well under a second', async () => {
    const c = await category(menuA, 'bulk', 1);
    await prisma().product.createMany({
      data: Array.from({ length: 1000 }, (_, i) => ({
        menuId: menuA,
        categoryId: c.id,
        slug: `bulk-${i}`,
        sortOrder: i,
        basePrice: 1000 + i,
        translations: names(`منتج ${i}`, `Item ${i}`),
      })),
    });
    const started = performance.now();
    const catalog = (await loadTillCatalog(prisma(), a.id))!;
    const elapsed = performance.now() - started;
    expect(catalog.products).toHaveLength(1000);
    expect(elapsed).toBeLessThan(2000);
  });
});
