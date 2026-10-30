import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import * as content from '@/server/studio/actions/content';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import { runQuery } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import * as salesQueries from '@/server/studio/queries/sales';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { createMenuFixture, requireTestDb, resetTestData } from '../helpers/db';

/** Sales > Dishes: the selling fields of one dish, saved on their own (docs/superpowers/specs/2026-10-30-sales-dishes-page-design.md). */

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
let b: Awaited<ReturnType<typeof createMenuFixture>>;
let owner: Actor;

const run = <I, O>(def: ActionDef<I, O>, input: unknown) => runAction(prisma(), owner, def, input, META);
const productRow = () => prisma().product.findUniqueOrThrow({ where: { id: a.product.id } });
const set = (fields: Record<string, unknown>, version = 1) =>
  run(content.setSelling, { menuId: a.menu.id, productId: a.product.id, version, ...fields });

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
});

beforeEach(async () => {
  await resetTestData(prisma());
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  a = await createMenuFixture(prisma(), 'sales-dishes-a');
  b = await createMenuFixture(prisma(), 'sales-dishes-b');
  await prisma().user.create({ data: { id: 'owner-a', name: 'Alpha Owner', email: 'owner-a@example.com' } });
  await prisma().membership.create({ data: { userId: 'owner-a', restaurantId: a.restaurant.id, role: 'OWNER' } });
  owner = (await loadActor(prisma(), 'owner-a')) as Actor;
});

afterAll(async () => {
  await resetTestData(prisma());
});

describe('content.setSelling', () => {
  it('saves only the fields it is given and moves the version once', async () => {
    const before = await productRow();
    const saved = dataOf(await set({ isSignature: true, badges: ['NEW'], cost: 90, priority: 100, serves: 4, lowStockThreshold: 3 }, before.version));
    expect(saved.version).toBe(before.version + 1);
    const row = await productRow();
    expect(row).toMatchObject({ isSignature: true, badges: ['NEW'], cost: 90, priority: 100, serves: 4, lowStockThreshold: 3, version: before.version + 1 });
    // What it was not given is as it was.
    expect(row).toMatchObject({ isFeatured: before.isFeatured, basePrice: before.basePrice, slug: before.slug, translations: before.translations });
  });

  it('clears cost, serves and the low-stock threshold with null', async () => {
    dataOf(await set({ cost: 90, serves: 2, lowStockThreshold: 5 }));
    dataOf(await set({ cost: null, serves: null, lowStockThreshold: null }, 2));
    expect(await productRow()).toMatchObject({ cost: null, serves: null, lowStockThreshold: null });
  });

  it('names a stale version as a conflict and writes nothing', async () => {
    dataOf(await set({ serves: 3 }));
    expect(failureOf(await set({ serves: 5 }, 1)).code).toBe('CONFLICT');
    expect((await productRow()).serves).toBe(3);
  });

  it('needs the right to set prices to change a cost, but not for the other fields', async () => {
    await prisma().restaurant.update({ where: { id: a.restaurant.id }, data: { permissionPolicy: { OWNER: { grant: [], revoke: ['content.prices'] } } } });
    owner = (await loadActor(prisma(), 'owner-a')) as Actor;
    expect(failureOf(await set({ cost: 90 })).code).toBe('FORBIDDEN');
    expect((await productRow()).cost).toBeNull();
    dataOf(await set({ isFeatured: true, serves: 3 }));
    // Sending the cost it already has is not a price decision.
    dataOf(await set({ cost: null, priority: 75 }, 2));
  });

  it('refuses values outside the limits, naming the field', async () => {
    expect(failureOf(await set({ serves: 1 })).fields).toHaveProperty('serves');
    expect(failureOf(await set({ serves: 21 })).fields).toHaveProperty('serves');
    expect(failureOf(await set({ lowStockThreshold: 0 })).fields).toHaveProperty('lowStockThreshold');
    expect(failureOf(await set({ lowStockThreshold: 1000 })).fields).toHaveProperty('lowStockThreshold');
    expect(failureOf(await set({ priority: 120 })).fields).toHaveProperty('priority');
    expect(failureOf(await set({ cost: -1 })).fields).toHaveProperty('cost');
    expect(failureOf(await set({ badges: ['HOT'] })).code).toBe('INVALID');
    expect((await productRow()).version).toBe(1);
  });

  it('keeps badges in their fixed order and drops repeats', async () => {
    dataOf(await set({ badges: ['RECOMMENDED', 'NEW', 'NEW'] }));
    expect((await productRow()).badges).toEqual(['NEW', 'RECOMMENDED']);
  });

  it('changes nothing, and keeps the version, when every value is what it already is', async () => {
    const result = dataOf(await set({ isSignature: false, serves: null }));
    expect(result.version).toBe(1);
    expect((await productRow()).version).toBe(1);
    expect(await prisma().auditLog.count({ where: { action: 'product.updated' } })).toBe(0);
  });

  it('audits the fields that changed, and only those', async () => {
    dataOf(await set({ isSignature: true, serves: 4 }));
    const line = await prisma().auditLog.findFirstOrThrow({ where: { action: 'product.updated' } });
    expect(line.entityId).toBe(a.product.id);
    expect(line.changes).toEqual({ isSignature: { before: false, after: true }, serves: { before: null, after: 4 } });
  });

  it('marks the draft as changed, so a publish picks it up', async () => {
    const before = await prisma().menu.findUniqueOrThrow({ where: { id: a.menu.id } });
    dataOf(await set({ isFeatured: true }));
    const after = await prisma().menu.findUniqueOrThrow({ where: { id: a.menu.id } });
    expect(after.draftHash).not.toBe(before.draftHash);
  });

  it('does not reach a dish of another menu', async () => {
    const result = await run(content.setSelling, { menuId: b.menu.id, productId: a.product.id, version: 1, serves: 3 });
    expect(failureOf(result).code).toBe('NOT_FOUND');
    expect((await productRow()).serves).toBeNull();
  });
});

describe('sales.dishes', () => {
  it('lists every dish with its selling fields, versions and whether prices may be set', async () => {
    dataOf(await set({ isSignature: true, cost: 90, serves: 4 }));
    const view = dataOf(await runQuery(prisma(), owner, salesQueries.dishes, { menuId: a.menu.id }));
    const dish = view.categories.flatMap((category) => category.products).find((product) => product.id === a.product.id);
    expect(dish).toMatchObject({ version: 2, isSignature: true, isFeatured: false, badges: [], cost: 90, priority: 50, serves: 4, lowStockThreshold: null });
    expect(view.canPrice).toBe(true);
    expect(view.currency).toBe(a.menu.currency);
  });
});
