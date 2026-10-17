import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import { getCatalog, getTenant } from '@/server/data/public-menu';
import { effectivePermissions } from '@/server/domain/permissions';
import { snapshotHash } from '@/server/domain/snapshot';
import { loadDraftSnapshot } from '@/server/publish/draft';
import * as availability from '@/server/studio/actions/availability';
import * as content from '@/server/studio/actions/content';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import { runQuery } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import * as contentQueries from '@/server/studio/queries/content';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { createMenuFixture, requireTestDb, resetTestData } from '../helpers/db';

const prisma = () => getPrisma();
const META = { ip: '203.0.113.7', userAgent: 'vitest' };

const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  return result.data;
};
const failureOf = (result: ActionResult<unknown>) => {
  if (result.ok) throw new Error(`expected a failure, got ${JSON.stringify(result.data)}`);
  return result.error;
};
const run = <I, O>(actor: Actor, def: ActionDef<I, O>, input: unknown) => runAction(prisma(), actor, def, input, META);

let a: Awaited<ReturnType<typeof createMenuFixture>>;
let b: Awaited<ReturnType<typeof createMenuFixture>>;
let owner: Actor;
let designer: Actor;

async function person(id: string, name: string, restaurantId: string, role: 'OWNER' | 'DESIGNER'): Promise<Actor> {
  await prisma().user.create({ data: { id, name, email: `${id}@example.com` } });
  await prisma().membership.create({ data: { userId: id, restaurantId, role } });
  return (await loadActor(prisma(), id)) as Actor;
}

const menuRow = () => prisma().menu.findUniqueOrThrow({ where: { id: a.menu.id } });

/** What the drawer sends for the fixture's espresso, as it stands: change what the test needs. */
async function drawer(overrides: Record<string, unknown> = {}) {
  const product = dataOf(await runQuery(prisma(), owner, contentQueries.product, { menuId: a.menu.id, productId: a.product.id }));
  return {
    menuId: a.menu.id,
    productId: product.id,
    version: product.version,
    slug: product.slug,
    categoryId: product.categoryId,
    names: product.names,
    descriptions: product.descriptions,
    price: product.price,
    isSignature: product.isSignature,
    isFeatured: product.isFeatured,
    allergens: product.allergens,
    dietary: product.dietary,
    badges: product.badges,
    calories: product.calories,
    media: product.media.map((entry) => entry.value),
    variants: product.variants.map(({ id, version, names, priceDelta, isDefault }) => ({ id, version, names, priceDelta, isDefault })),
    groups: product.groups.map(({ id, version, names, minSelect, maxSelect, options }) => ({
      id,
      version,
      names,
      minSelect,
      maxSelect,
      options: options.map((o) => ({ id: o.id, version: o.version, names: o.names, priceDelta: o.priceDelta, isSuggested: o.isSuggested })),
    })),
    ...overrides,
  };
}

const SIZES = [
  { names: { en: 'Small' }, priceDelta: 0, isDefault: true },
  { names: { en: 'Large', ar: 'كبير' }, priceDelta: 100, isDefault: false },
];
const EXTRAS = [
  {
    names: { en: 'Extras' },
    minSelect: 0,
    maxSelect: 2,
    options: [
      { names: { en: 'Oat milk' }, priceDelta: 50, isSuggested: true },
      { names: { en: 'Extra shot' }, priceDelta: 75, isSuggested: false },
    ],
  },
];

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
});

beforeEach(async () => {
  await resetTestData(prisma());
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  a = await createMenuFixture(prisma(), 'content-a');
  b = await createMenuFixture(prisma(), 'content-b');
  owner = await person('owner-a', 'Alpha Owner', a.restaurant.id, 'OWNER');
  designer = await person('designer-a', 'Alpha Designer', a.restaurant.id, 'DESIGNER');
});

afterAll(async () => {
  await resetTestData(prisma());
});

describe('categories', () => {
  it('gives two categories called "Hot drinks" the slugs hot-drinks and hot-drinks-2, last in order', async () => {
    const first = dataOf(await run(owner, content.createCategory, { menuId: a.menu.id, names: { en: 'Hot drinks', ar: 'مشروبات ساخنة' } }));
    const second = dataOf(await run(owner, content.createCategory, { menuId: a.menu.id, names: { en: 'Hot drinks' } }));
    const rows = await prisma().category.findMany({ where: { menuId: a.menu.id }, orderBy: { sortOrder: 'asc' } });
    expect(rows.map((row) => row.slug)).toEqual(['coffee', 'hot-drinks', 'hot-drinks-2']);
    expect(rows.find((row) => row.id === first.categoryId)!.translations).toEqual({ en: { name: 'Hot drinks' }, ar: { name: 'مشروبات ساخنة' } });
    expect(second.categoryId).toBe(rows[2]!.id);
    expect((await menuRow()).draftHash).toBe(snapshotHash(await loadDraftSnapshot(prisma(), a.menu.id)));
  });

  it('makes a slug for a name with no Latin letters', async () => {
    dataOf(await run(owner, content.createCategory, { menuId: a.menu.id, names: { ar: 'حلويات' } }));
    expect((await prisma().category.findMany({ where: { menuId: a.menu.id } })).map((row) => row.slug)).toContain('category');
  });

  it('renames a category and refuses a slug another category has', async () => {
    const { categoryId } = dataOf(await run(owner, content.createCategory, { menuId: a.menu.id, names: { en: 'Tea' } }));
    expect(dataOf(await run(owner, content.updateCategory, { menuId: a.menu.id, categoryId, version: 1, names: { en: 'Teas' }, slug: 'teas', isActive: false }))).toEqual({ version: 2 });
    expect(await prisma().category.findUniqueOrThrow({ where: { id: categoryId } })).toMatchObject({ slug: 'teas', isActive: false, translations: { en: { name: 'Teas' } } });
    expect(failureOf(await run(owner, content.updateCategory, { menuId: a.menu.id, categoryId, version: 2, names: { en: 'Teas' }, slug: 'coffee', isActive: true }))).toMatchObject({
      code: 'INVALID',
      fields: { slug: expect.any(String) },
    });
  });

  it('refuses to delete a category with products', async () => {
    expect(failureOf(await run(owner, content.deleteCategory, { menuId: a.menu.id, categoryId: a.category.id, version: 1 })).code).toBe('INVALID');
    const { categoryId } = dataOf(await run(owner, content.createCategory, { menuId: a.menu.id, names: { en: 'Empty' } }));
    expect(dataOf(await run(owner, content.deleteCategory, { menuId: a.menu.id, categoryId, version: 1 }))).toEqual({ deleted: true });
  });

  it('reorders categories only with the complete list of ids, keeping their versions', async () => {
    const { categoryId: tea } = dataOf(await run(owner, content.createCategory, { menuId: a.menu.id, names: { en: 'Tea' } }));
    expect(failureOf(await run(owner, content.reorderCategories, { menuId: a.menu.id, order: [tea] })).code).toBe('INVALID');
    expect(failureOf(await run(owner, content.reorderCategories, { menuId: a.menu.id, order: [tea, b.category.id] })).code).toBe('NOT_FOUND');
    dataOf(await run(owner, content.reorderCategories, { menuId: a.menu.id, order: [tea, a.category.id] }));
    const rows = await prisma().category.findMany({ where: { menuId: a.menu.id }, orderBy: { sortOrder: 'asc' } });
    expect(rows.map((row) => row.id)).toEqual([tea, a.category.id]);
    expect(rows.map((row) => row.version)).toEqual([1, 1]);
  });
});

describe('products', () => {
  it('creates a product last in its category with a slug from its name', async () => {
    const { productId } = dataOf(await run(owner, content.createProduct, { menuId: a.menu.id, categoryId: a.category.id, names: { en: 'Flat White' }, price: 450 }));
    expect(await prisma().product.findUniqueOrThrow({ where: { id: productId } })).toMatchObject({ slug: 'flat-white', basePrice: 450, sortOrder: 1 });
  });

  it('saves a product with sizes and option groups and keeps the draft hash current', async () => {
    const saved = dataOf(
      await run(owner, content.saveProduct, await drawer({ names: { en: 'Espresso', ar: 'إسبريسو', ckb: 'ئێسپرێسۆ' }, variants: SIZES, groups: EXTRAS, calories: 5 })),
    );
    expect(saved.version).toBe(2);
    expect(saved.variants).toHaveLength(2);
    expect(saved.groups[0]!.options).toHaveLength(2);
    const product = await prisma().product.findUniqueOrThrow({
      where: { id: a.product.id },
      include: { variants: { orderBy: { sortOrder: 'asc' } }, groups: { include: { options: { orderBy: { sortOrder: 'asc' } } } } },
    });
    expect(product.variants.map((v) => [v.priceDelta, v.isDefault, v.sortOrder])).toEqual([[0, true, 0], [100, false, 1]]);
    expect(product.groups[0]!.options.map((o) => o.translations)).toEqual([{ en: { name: 'Oat milk' } }, { en: { name: 'Extra shot' } }]);
    expect(product.calories).toBe(5);
    expect((await menuRow()).draftHash).toBe(snapshotHash(await loadDraftSnapshot(prisma(), a.menu.id)));
    expect(await prisma().auditLog.findFirstOrThrow({ where: { action: 'product.updated' } })).toMatchObject({ entityType: 'Product', entityId: a.product.id });
  });

  it('refuses a stale save and names who changed the product', async () => {
    const stale = await drawer();
    dataOf(await run(owner, content.saveProduct, await drawer({ names: { en: 'Ristretto' } })));
    expect(failureOf(await run(designer, content.saveProduct, { ...stale, names: { en: 'Lungo' } }))).toMatchObject({
      code: 'CONFLICT',
      fields: { changedBy: 'Alpha Owner' },
    });
    expect((await prisma().product.findUniqueOrThrow({ where: { id: a.product.id } })).translations).toMatchObject({ en: { name: 'Ristretto' } });
  });

  it('names who changed the product, not who sold it out since', async () => {
    const stale = await drawer();
    dataOf(await run(owner, content.saveProduct, await drawer({ names: { en: 'Ristretto' } })));
    dataOf(await run(designer, availability.setProduct, { menuId: a.menu.id, productId: a.product.id, isAvailable: false }));
    expect(failureOf(await run(designer, content.saveProduct, { ...stale, names: { en: 'Lungo' } }))).toMatchObject({
      code: 'CONFLICT',
      fields: { changedBy: 'Alpha Owner' },
    });
  });

  it('refuses a stale save after a bulk write moved the version', async () => {
    const stale = await drawer();
    await prisma().product.updateMany({ where: { id: a.product.id, version: stale.version }, data: { basePrice: 330, version: { increment: 1 } } });
    expect(failureOf(await run(owner, content.saveProduct, { ...stale, price: 350 })).code).toBe('CONFLICT');
    expect((await prisma().product.findUniqueOrThrow({ where: { id: a.product.id } })).basePrice).toBe(330);
  });

  it('refuses a price change without content.prices but saves the names', async () => {
    await prisma().restaurant.update({ where: { id: a.restaurant.id }, data: { permissionPolicy: { OWNER: { grant: [], revoke: ['content.prices'] } } } });
    expect(effectivePermissions({ isSuperAdmin: false, role: 'OWNER', policy: { OWNER: { grant: [], revoke: ['content.prices'] } } }).has('content.prices')).toBe(false);
    expect(failureOf(await run(owner, content.saveProduct, await drawer({ price: 999 }))).code).toBe('FORBIDDEN');
    expect(failureOf(await run(owner, content.saveProduct, await drawer({ variants: SIZES }))).code).toBe('FORBIDDEN');
    dataOf(await run(owner, content.saveProduct, await drawer({ names: { en: 'Doppio' } })));
    expect(await prisma().product.findUniqueOrThrow({ where: { id: a.product.id } })).toMatchObject({ basePrice: 300, translations: { en: { name: 'Doppio' } } });

    const priced = { menuId: a.menu.id, categoryId: a.category.id, names: { en: 'Cortado' }, price: 250 };
    expect(failureOf(await run(owner, content.createProduct, priced)).code).toBe('FORBIDDEN');
    dataOf(await run(owner, content.createProduct, { ...priced, price: 0 }));
  });

  it('writes dietary tags, badges and allergens in canonical order', async () => {
    dataOf(await run(owner, content.saveProduct, await drawer({ dietary: ['VEGAN', 'VEGETARIAN'], badges: ['POPULAR', 'NEW'], allergens: ['nuts', 'milk'] })));
    const first = (await menuRow()).draftHash;
    expect(await prisma().product.findUniqueOrThrow({ where: { id: a.product.id } })).toMatchObject({
      dietary: ['VEGETARIAN', 'VEGAN'],
      badges: ['NEW', 'POPULAR'],
      allergens: ['milk', 'nuts'],
    });
    dataOf(await run(owner, content.saveProduct, await drawer({ dietary: ['VEGETARIAN', 'VEGAN'], badges: ['NEW', 'POPULAR'], allergens: ['milk', 'nuts'] })));
    expect((await menuRow()).draftHash).toBe(first);
  });

  it('refuses an allergen, dietary tag or badge it does not know', async () => {
    expect(failureOf(await run(owner, content.saveProduct, await drawer({ allergens: ['moonbeams'] }))).code).toBe('INVALID');
    expect(failureOf(await run(owner, content.saveProduct, await drawer({ badges: ['SPONSORED'] }))).code).toBe('INVALID');
  });

  it("refuses another restaurant's asset in the media list and writes nothing", async () => {
    const theirs = await prisma().mediaAsset.create({
      data: { restaurantId: b.restaurant.id, kind: 'IMAGE', storageKey: `r/${b.restaurant.id}/h`, contentHash: 'h', mime: 'image/png', bytes: 1, storedBytes: 1, variants: { original: `r/${b.restaurant.id}/h/original.png` } },
    });
    expect(failureOf(await run(owner, content.saveProduct, await drawer({ names: { en: 'Changed' }, media: [{ kind: 'asset', assetId: theirs.id }] }))).code).toBe('NOT_FOUND');
    expect(await prisma().product.findUniqueOrThrow({ where: { id: a.product.id } })).toMatchObject({ media: [], version: 1 });
  });

  it('refuses a group whose minimum exceeds its options', async () => {
    const groups = [{ names: { en: 'Pick' }, minSelect: 3, maxSelect: 3, options: EXTRAS[0]!.options }];
    expect(failureOf(await run(owner, content.saveProduct, await drawer({ groups })))).toMatchObject({ code: 'INVALID', fields: { 'groups.0.minSelect': expect.any(String) } });
  });

  it('refuses two default sizes, and a size priced below zero', async () => {
    const twoDefaults = SIZES.map((size) => ({ ...size, isDefault: true }));
    expect(failureOf(await run(owner, content.saveProduct, await drawer({ variants: twoDefaults }))).code).toBe('INVALID');
    const belowZero = [SIZES[0]!, { ...SIZES[1]!, priceDelta: -400 }];
    expect(failureOf(await run(owner, content.saveProduct, await drawer({ variants: belowZero }))).code).toBe('INVALID');
  });

  it('deletes sizes left out of the save, but not one a bundle uses', async () => {
    const saved = dataOf(await run(owner, content.saveProduct, await drawer({ variants: SIZES })));
    const large = saved.variants[1]!.id;
    const bundle = await prisma().bundle.create({ data: { menuId: a.menu.id, slug: 'combo', price: 500, translations: { en: { name: 'Combo' } } } });
    await prisma().bundleItem.create({ data: { menuId: a.menu.id, bundleId: bundle.id, productId: a.product.id, variantId: large } });

    const withoutLarge = await drawer();
    withoutLarge.variants = withoutLarge.variants.filter((variant: { id?: string }) => variant.id !== large);
    expect(failureOf(await run(owner, content.saveProduct, withoutLarge)).code).toBe('INVALID');

    await prisma().bundleItem.deleteMany({ where: { bundleId: bundle.id } });
    dataOf(await run(owner, content.saveProduct, withoutLarge));
    expect(await prisma().productVariant.count({ where: { productId: a.product.id } })).toBe(1);
  });

  it("refuses a size of another product, and another menu's category", async () => {
    const other = await prisma().product.create({ data: { menuId: a.menu.id, categoryId: a.category.id, slug: 'other', basePrice: 100, translations: { en: { name: 'Other' } } } });
    const foreign = await prisma().productVariant.create({ data: { menuId: a.menu.id, productId: other.id, translations: { en: { name: 'X' } }, isDefault: true } });
    expect(failureOf(await run(owner, content.saveProduct, await drawer({ variants: [{ id: foreign.id, version: 1, names: { en: 'X' }, priceDelta: 0, isDefault: true }] }))).code).toBe('NOT_FOUND');
    expect(failureOf(await run(owner, content.saveProduct, await drawer({ categoryId: b.category.id }))).code).toBe('NOT_FOUND');
  });

  it('refuses to delete a product a bundle contains', async () => {
    const bundle = await prisma().bundle.create({ data: { menuId: a.menu.id, slug: 'combo', price: 500, translations: { en: { name: 'Combo' } } } });
    await prisma().bundleItem.create({ data: { menuId: a.menu.id, bundleId: bundle.id, productId: a.product.id } });
    expect(failureOf(await run(owner, content.deleteProduct, { menuId: a.menu.id, productId: a.product.id, version: 1 })).code).toBe('INVALID');
  });

  it('moves a product to another category at a position', async () => {
    const { categoryId } = dataOf(await run(owner, content.createCategory, { menuId: a.menu.id, names: { en: 'Tea' } }));
    const { productId: green } = dataOf(await run(owner, content.createProduct, { menuId: a.menu.id, categoryId, names: { en: 'Green' }, price: 200 }));
    const { productId: mint } = dataOf(await run(owner, content.createProduct, { menuId: a.menu.id, categoryId, names: { en: 'Mint' }, price: 200 }));
    dataOf(await run(owner, content.moveProduct, { menuId: a.menu.id, productId: a.product.id, categoryId, index: 1 }));
    const tea = await prisma().product.findMany({ where: { categoryId }, orderBy: { sortOrder: 'asc' } });
    expect(tea.map((row) => row.id)).toEqual([green, a.product.id, mint]);
    expect(tea.map((row) => row.version)).toEqual([1, 1, 1]);
  });

  it('changes nothing guests see until publish', async () => {
    dataOf(await run(owner, content.saveProduct, await drawer({ price: 999 })));
    expect((await getCatalog((await getTenant('content-a'))!)).products[0]!.basePrice).toBe(300);
  });
});

describe('reading', () => {
  it('lists the tree with what is missing in each language', async () => {
    const tree = dataOf(await runQuery(prisma(), owner, contentQueries.tree, { menuId: a.menu.id }));
    expect(tree.locales).toEqual(['en', 'ar', 'ckb']);
    expect(tree.categories).toHaveLength(1);
    expect(tree.categories[0]).toMatchObject({ slug: 'coffee', names: { en: 'Coffee' }, missing: ['ar', 'ckb'] });
    expect(tree.categories[0]!.products[0]).toMatchObject({ slug: 'content-a-espresso', price: 300, missing: ['ar', 'ckb'], thumbUrl: null });
  });
});
