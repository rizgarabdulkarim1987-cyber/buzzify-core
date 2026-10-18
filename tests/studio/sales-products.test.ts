import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import * as availability from '@/server/studio/actions/availability';
import * as content from '@/server/studio/actions/content';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import { runQuery } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import * as availabilityQueries from '@/server/studio/queries/availability';
import * as contentQueries from '@/server/studio/queries/content';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { createMenuFixture, requireTestDb, resetTestData } from '../helpers/db';

/** The sales fields of a product (docs/superpowers/plans/2026-10-18-sales-tools.md, Task 10). */

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

let a: Awaited<ReturnType<typeof createMenuFixture>>;
let owner: Actor;

const run = <I, O>(def: ActionDef<I, O>, input: unknown) => runAction(prisma(), owner, def, input, META);
const menuRow = () => prisma().menu.findUniqueOrThrow({ where: { id: a.menu.id } });

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
    variants: [],
    groups: [],
    cost: product.cost,
    priority: product.priority,
    serves: product.serves,
    lowStockThreshold: product.lowStockThreshold,
    ...overrides,
  };
}

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
});

beforeEach(async () => {
  await resetTestData(prisma());
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  a = await createMenuFixture(prisma(), 'sales-products');
  await prisma().user.create({ data: { id: 'owner-a', name: 'Alpha Owner', email: 'owner-a@example.com' } });
  await prisma().membership.create({ data: { userId: 'owner-a', restaurantId: a.restaurant.id, role: 'OWNER' } });
  owner = (await loadActor(prisma(), 'owner-a')) as Actor;
});

afterAll(async () => {
  await resetTestData(prisma());
});

describe('the sales fields of a product', () => {
  it('reads and saves its cost, how much to promote it, how many it serves and when it is running low', async () => {
    const before = dataOf(await runQuery(prisma(), owner, contentQueries.product, { menuId: a.menu.id, productId: a.product.id }));
    expect(before).toMatchObject({ cost: null, priority: 50, serves: null, lowStockThreshold: null });
    dataOf(await run(content.saveProduct, await drawer({ cost: 90, priority: 100, serves: 4, lowStockThreshold: 3 })));
    expect(await prisma().product.findUniqueOrThrow({ where: { id: a.product.id } })).toMatchObject({ cost: 90, priority: 100, serves: 4, lowStockThreshold: 3 });
  });

  it('keeps them when a save leaves them out', async () => {
    dataOf(await run(content.saveProduct, await drawer({ cost: 90, serves: 2 })));
    // A save from before the sales fields existed sends none of them.
    const older: Record<string, unknown> = await drawer({ names: { en: 'Ristretto' } });
    for (const field of ['cost', 'priority', 'serves', 'lowStockThreshold']) delete older[field];
    dataOf(await run(content.saveProduct, older));
    expect(await prisma().product.findUniqueOrThrow({ where: { id: a.product.id } })).toMatchObject({ cost: 90, serves: 2 });
  });

  it('audits clearing a cost as a change', async () => {
    dataOf(await run(content.saveProduct, await drawer({ cost: 90 })));
    dataOf(await run(content.saveProduct, await drawer({ cost: null })));
    const last = await prisma().auditLog.findFirstOrThrow({ where: { action: 'product.updated' }, orderBy: { occurredAt: 'desc' } });
    expect(last.changes).toMatchObject({ cost: { before: 90, after: null } });
  });

  it('needs the right to set prices to change a cost', async () => {
    await prisma().restaurant.update({ where: { id: a.restaurant.id }, data: { permissionPolicy: { OWNER: { grant: [], revoke: ['content.prices'] } } } });
    owner = (await loadActor(prisma(), 'owner-a')) as Actor;
    expect(failureOf(await run(content.saveProduct, await drawer({ cost: 90 }))).code).toBe('FORBIDDEN');
    dataOf(await run(content.saveProduct, await drawer({ serves: 3 })));
  });

  it('saves a product whose stored priority is not one of the three levels, leaving it as it was', async () => {
    await prisma().product.update({ where: { id: a.product.id }, data: { priority: 60 } });
    dataOf(await run(content.saveProduct, await drawer({ names: { en: 'Ristretto' } })));
    expect(await prisma().product.findUniqueOrThrow({ where: { id: a.product.id } })).toMatchObject({ priority: 60, translations: { en: { name: 'Ristretto' } } });
  });

  it('refuses a dish for one and promotion levels it does not offer', async () => {
    expect(failureOf(await run(content.saveProduct, await drawer({ serves: 1 }))).fields).toHaveProperty('serves');
    expect(failureOf(await run(content.saveProduct, await drawer({ priority: 120 }))).fields).toHaveProperty('priority');
  });
});

describe('offers when what they name goes', () => {
  async function offerOn(productIds: string[], categoryIds: string[]) {
    return prisma().promotion.create({ data: { menuId: a.menu.id, kind: 'SPECIAL', productIds, categoryIds, translations: { en: { title: 'Special' } } } });
  }

  it('drops a deleted dish from every offer and deletes an offer left with nothing', async () => {
    const latte = await prisma().product.create({ data: { menuId: a.menu.id, categoryId: a.category.id, slug: 'latte', basePrice: 450, translations: { en: { name: 'Latte' } } } });
    const both = await offerOn([a.product.id, latte.id], []);
    const lone = await offerOn([latte.id], []);
    dataOf(await run(content.deleteProduct, { menuId: a.menu.id, productId: latte.id, version: 1 }));
    expect((await prisma().promotion.findUniqueOrThrow({ where: { id: both.id } })).productIds).toEqual([a.product.id]);
    expect(await prisma().promotion.findUnique({ where: { id: lone.id } })).toBeNull();
  });

  it('drops a deleted category from every offer and its pairings', async () => {
    const empty = await prisma().category.create({ data: { menuId: a.menu.id, slug: 'empty', sortOrder: 1, translations: { en: { name: 'Empty' } } } });
    const offer = await offerOn([a.product.id], [empty.id]);
    await prisma().pairingRule.create({ data: { menuId: a.menu.id, sourceType: 'CATEGORY', sourceCategoryId: empty.id, targetProductId: a.product.id, translations: {} } });
    dataOf(await run(content.deleteCategory, { menuId: a.menu.id, categoryId: empty.id, version: 1 }));
    expect((await prisma().promotion.findUniqueOrThrow({ where: { id: offer.id } })).categoryIds).toEqual([]);
    expect(await prisma().pairingRule.count()).toBe(0);
  });
});

describe('portions left', () => {
  it('sets how many are left at once, without a publish or a version, and shows it on the board', async () => {
    const before = await menuRow();
    dataOf(await run(availability.setStock, { menuId: a.menu.id, productId: a.product.id, stockCount: 4 }));
    expect(await prisma().product.findUniqueOrThrow({ where: { id: a.product.id } })).toMatchObject({ stockCount: 4, version: 1 });
    expect((await menuRow()).draftHash).toBe(before.draftHash);
    const board = dataOf(await runQuery(prisma(), owner, availabilityQueries.board, { menuId: a.menu.id }));
    expect(board.categories[0]?.products[0]).toMatchObject({ stockCount: 4, lowStockThreshold: null });
    dataOf(await run(availability.setStock, { menuId: a.menu.id, productId: a.product.id, stockCount: null }));
    expect((await prisma().product.findUniqueOrThrow({ where: { id: a.product.id } })).stockCount).toBeNull();
    expect((await prisma().auditLog.findMany()).map((row) => row.action)).toContain('product.stock_changed');
  });

  it('refuses a negative count', async () => {
    expect(failureOf(await run(availability.setStock, { menuId: a.menu.id, productId: a.product.id, stockCount: -1 })).code).toBe('INVALID');
  });
});
