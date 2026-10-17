import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import { snapshotHash } from '@/server/domain/snapshot';
import { loadDraftSnapshot } from '@/server/publish/draft';
import * as content from '@/server/studio/actions/content';
import * as prices from '@/server/studio/actions/prices';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import { runQuery } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import * as priceQueries from '@/server/studio/queries/prices';
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
const run = <I, O>(def: ActionDef<I, O>, input: unknown, actor: Actor = owner) => runAction(prisma(), actor, def, input, META);

let a: Awaited<ReturnType<typeof createMenuFixture>>;
let owner: Actor;
let latte: { id: string; variantId: string };

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
});

beforeEach(async () => {
  await resetTestData(prisma());
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  a = await createMenuFixture(prisma(), 'prices-a');
  const product = await prisma().product.create({
    data: { menuId: a.menu.id, categoryId: a.category.id, slug: 'latte', basePrice: 450, sortOrder: 1, translations: { en: { name: 'Latte' } } },
  });
  const variant = await prisma().productVariant.create({
    data: { menuId: a.menu.id, productId: product.id, priceDelta: 100, isDefault: true, translations: { en: { name: 'Large' } } },
  });
  latte = { id: product.id, variantId: variant.id };
  await prisma().user.create({ data: { id: 'owner-a', name: 'Alpha Owner', email: 'owner-a@example.com' } });
  await prisma().membership.create({ data: { userId: 'owner-a', restaurantId: a.restaurant.id, role: 'OWNER' } });
  owner = (await loadActor(prisma(), 'owner-a')) as Actor;
});

afterAll(async () => {
  await resetTestData(prisma());
});

const tenPercent = { kind: 'percent', basisPoints: 1000 } as const;
const preview = (operation: unknown = tenPercent, includeVariants = true) =>
  runQuery(prisma(), owner, priceQueries.previewBulk, { menuId: a.menu.id, selection: { categoryId: a.category.id }, operation, includeVariants });

describe('bulk price changes', () => {
  it('previews every old and new price with names, the step and the draft hash', async () => {
    const shown = dataOf(await preview());
    expect(shown.step).toBe(5);
    expect(shown.draftHash).toBe((await prisma().menu.findUniqueOrThrow({ where: { id: a.menu.id } })).draftHash);
    expect(shown.rows).toEqual([
      { productId: a.product.id, variantId: null, oldPrice: 300, newPrice: 330, name: 'Espresso', variantName: null },
      { productId: latte.id, variantId: null, oldPrice: 450, newPrice: 495, name: 'Latte', variantName: null },
      { productId: latte.id, variantId: latte.variantId, oldPrice: 550, newPrice: 605, name: 'Latte', variantName: 'Large' },
    ]);
  });

  it('applies a bulk change in one transaction and moves every changed version', async () => {
    const { draftHash } = dataOf(await preview());
    expect(
      dataOf(await run(prices.applyBulk, { menuId: a.menu.id, selection: { categoryId: a.category.id }, operation: tenPercent, includeVariants: true, expectedDraftHash: draftHash })),
    ).toEqual({ changed: 3 });
    expect(await prisma().product.findMany({ where: { menuId: a.menu.id }, orderBy: { sortOrder: 'asc' }, select: { basePrice: true, version: true } })).toEqual([
      { basePrice: 330, version: 2 },
      { basePrice: 495, version: 2 },
    ]);
    expect(await prisma().productVariant.findUniqueOrThrow({ where: { id: latte.variantId } })).toMatchObject({ priceDelta: 110, version: 2 });
    const menu = await prisma().menu.findUniqueOrThrow({ where: { id: a.menu.id } });
    expect(menu.draftHash).toBe(snapshotHash(await loadDraftSnapshot(prisma(), a.menu.id)));
    expect(await prisma().auditLog.findFirstOrThrow({ where: { action: 'prices.bulk_changed' } })).toMatchObject({
      entityType: 'MenuPrices',
      entityId: a.menu.id,
      changes: { operation: { before: null, after: tenPercent }, count: { before: null, after: 3 } },
    });
  });

  it('rounds to the menu’s own step', async () => {
    await prisma().menu.update({ where: { id: a.menu.id }, data: { priceStep: 100 } });
    const shown = dataOf(await preview(tenPercent, false));
    expect(shown.step).toBe(100);
    expect(shown.rows.map((row) => row.newPrice)).toEqual([300, 500, 600]);
  });

  it('refuses an editor saved after the bulk change', async () => {
    const product = dataOf(await runQuery(prisma(), owner, (await import('@/server/studio/queries/content')).product, { menuId: a.menu.id, productId: a.product.id }));
    const { draftHash } = dataOf(await preview());
    dataOf(await run(prices.applyBulk, { menuId: a.menu.id, selection: {}, operation: tenPercent, includeVariants: false, expectedDraftHash: draftHash }));
    const stale = {
      menuId: a.menu.id,
      productId: product.id,
      version: product.version,
      slug: product.slug,
      categoryId: product.categoryId,
      names: { en: 'Ristretto' },
      descriptions: product.descriptions,
      price: product.price,
      isSignature: false,
      isFeatured: false,
      allergens: [],
      dietary: [],
      badges: [],
      calories: null,
      media: [],
      variants: [],
      groups: [],
    };
    expect(failureOf(await run(content.saveProduct, stale)).code).toBe('CONFLICT');
  });

  it('refuses to apply when the draft changed after the preview', async () => {
    const { draftHash } = dataOf(await preview());
    dataOf(await run(content.createCategory, { menuId: a.menu.id, names: { en: 'Tea' } }));
    expect(
      failureOf(await run(prices.applyBulk, { menuId: a.menu.id, selection: { categoryId: a.category.id }, operation: tenPercent, includeVariants: true, expectedDraftHash: draftHash }))
        .code,
    ).toBe('CONFLICT');
    expect((await prisma().product.findUniqueOrThrow({ where: { id: a.product.id } })).basePrice).toBe(300);
  });

  it('refuses the whole change when one price would be zero', async () => {
    const operation = { kind: 'add', amount: -350 };
    const { draftHash, rows } = dataOf(await preview(operation, false));
    expect(rows[0]).toMatchObject({ newPrice: -50, problem: 'NOT_POSITIVE' });
    expect(
      failureOf(await run(prices.applyBulk, { menuId: a.menu.id, selection: {}, operation, includeVariants: false, expectedDraftHash: draftHash })).code,
    ).toBe('INVALID');
    expect((await prisma().product.findUniqueOrThrow({ where: { id: latte.id } })).basePrice).toBe(450);
  });

  it('refuses another menu’s product in the selection', async () => {
    const b = await createMenuFixture(prisma(), 'prices-b');
    const { draftHash } = dataOf(await preview());
    expect(
      failureOf(await run(prices.applyBulk, { menuId: a.menu.id, selection: { productIds: [b.product.id] }, operation: tenPercent, includeVariants: false, expectedDraftHash: draftHash }))
        .code,
    ).toBe('NOT_FOUND');
  });
});

describe('single prices', () => {
  it('stores a size price as its difference from the base', async () => {
    expect(dataOf(await run(prices.set, { menuId: a.menu.id, target: { kind: 'variant', id: latte.variantId, version: 1 }, price: 600 }))).toEqual({ version: 2 });
    expect(await prisma().productVariant.findUniqueOrThrow({ where: { id: latte.variantId } })).toMatchObject({ priceDelta: 150, version: 2 });
    expect(await prisma().auditLog.findFirstOrThrow({ where: { action: 'price.changed' } })).toMatchObject({
      entityType: 'ProductVariant',
      entityId: latte.variantId,
      changes: { price: { before: 550, after: 600 } },
    });
  });

  it('sets a product’s price at its version, and refuses a stale one', async () => {
    dataOf(await run(prices.set, { menuId: a.menu.id, target: { kind: 'product', id: a.product.id, version: 1 }, price: 350 }));
    expect((await prisma().product.findUniqueOrThrow({ where: { id: a.product.id } })).basePrice).toBe(350);
    expect(failureOf(await run(prices.set, { menuId: a.menu.id, target: { kind: 'product', id: a.product.id, version: 1 }, price: 360 })).code).toBe('CONFLICT');
  });

  it('needs content.prices', async () => {
    await prisma().restaurant.update({ where: { id: a.restaurant.id }, data: { permissionPolicy: { OWNER: { grant: [], revoke: ['content.prices'] } } } });
    expect(failureOf(await run(prices.set, { menuId: a.menu.id, target: { kind: 'product', id: a.product.id, version: 1 }, price: 350 })).code).toBe('FORBIDDEN');
  });

  it('lists the grid with each product and its sizes at their own price', async () => {
    const grid = dataOf(await runQuery(prisma(), owner, priceQueries.grid, { menuId: a.menu.id }));
    expect(grid.currency).toBe('USD');
    expect(grid.categories[0]!.products[1]).toEqual({
      id: latte.id,
      names: { en: 'Latte' },
      price: 450,
      version: 1,
      variants: [{ id: latte.variantId, names: { en: 'Large' }, price: 550, version: 1 }],
    });
  });
});
