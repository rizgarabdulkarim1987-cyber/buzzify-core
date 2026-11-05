import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaKind } from '@/generated/prisma/client';
import { getPrisma } from '@/server/data/prisma';
import { loadDraftSnapshot } from '@/server/publish/draft';
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

let a: Awaited<ReturnType<typeof createMenuFixture>>;
let b: Awaited<ReturnType<typeof createMenuFixture>>;
let owner: Actor;

const run = <I, O>(def: ActionDef<I, O>, input: unknown) => runAction(prisma(), owner, def, input, META);
const onPlan = (plan: 'BASIC' | 'PREMIUM') => prisma().restaurant.update({ where: { id: a.restaurant.id }, data: { plan } });

async function asset(restaurantId: string | null, kind: MediaKind, seed: string): Promise<string> {
  const hash = createHash('sha256').update(`${restaurantId}-${seed}`).digest('hex');
  const folder = `${restaurantId === null ? 'shared' : `r/${restaurantId}`}/${hash}`;
  const file = kind === 'MODEL' ? 'original.glb' : 'original.png';
  const row = await prisma().mediaAsset.create({
    data: {
      restaurantId,
      kind,
      storageKey: folder,
      contentHash: hash,
      mime: kind === 'MODEL' ? 'model/gltf-binary' : 'image/png',
      bytes: 100,
      storedBytes: 100,
      variants: { original: `${folder}/${file}` },
    },
  });
  return row.id;
}

/** What the dish drawer sends for the fixture's espresso, as it stands: change what the test needs. */
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
    ...overrides,
  };
}

const withModel = (id: string) => drawer({ media: [{ kind: 'model', assetId: id }] });

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
  vi.stubEnv('MEDIA_LOCAL_DIR', 'unused');
  vi.stubEnv('MEDIA_PUBLIC_URL', '/api/dev-media');
});

beforeEach(async () => {
  await resetTestData(prisma());
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  a = await createMenuFixture(prisma(), 'dish-model-a');
  b = await createMenuFixture(prisma(), 'dish-model-b');
  await prisma().user.create({ data: { id: 'owner-a', name: 'Alpha Owner', email: 'owner-a@example.com' } });
  await prisma().membership.create({ data: { userId: 'owner-a', restaurantId: a.restaurant.id, role: 'OWNER' } });
  owner = (await loadActor(prisma(), 'owner-a')) as Actor;
  await onPlan('PREMIUM');
});

afterAll(() => resetTestData(prisma()));

describe("a dish's 3D model", () => {
  it('is saved with the dish, and publishes as a playable model with the asset it came from', async () => {
    const model = await asset(a.restaurant.id, 'MODEL', 'espresso');
    dataOf(await run(content.saveProduct, await withModel(model)));
    expect((await prisma().product.findUniqueOrThrow({ where: { id: a.product.id } })).media).toEqual([{ kind: 'model', assetId: model }]);

    const snapshot = await loadDraftSnapshot(prisma(), a.menu.id);
    const media = snapshot.catalog.products.find((product) => product.id === a.product.id)!.media;
    expect(media).toEqual([{ kind: 'model3d', url: expect.stringContaining('original.glb'), assetId: model }]);
  });

  it('is refused on a plan without the feature, but a stored one is kept and can be removed', async () => {
    const model = await asset(a.restaurant.id, 'MODEL', 'espresso');
    await onPlan('BASIC');
    expect(failureOf(await run(content.saveProduct, await withModel(model))).code).toBe('UPGRADE_REQUIRED');
    expect((await prisma().product.findUniqueOrThrow({ where: { id: a.product.id } })).media).toEqual([]);

    await onPlan('PREMIUM');
    dataOf(await run(content.saveProduct, await withModel(model)));
    await onPlan('BASIC');
    // Saving the dish again with the stored model, or without it, both work on the lower plan.
    dataOf(await run(content.saveProduct, await drawer({ names: { en: 'Espresso 2' } })));
    expect((await prisma().product.findUniqueOrThrow({ where: { id: a.product.id } })).media).toEqual([{ kind: 'model', assetId: model }]);
    dataOf(await run(content.saveProduct, await drawer({ media: [] })));
    expect((await prisma().product.findUniqueOrThrow({ where: { id: a.product.id } })).media).toEqual([]);
  });

  it("refuses another restaurant's model, a picture picked as a model, and an unknown one", async () => {
    const theirs = await asset(b.restaurant.id, 'MODEL', 'theirs');
    const picture = await asset(a.restaurant.id, 'IMAGE', 'photo');
    for (const id of [theirs, picture, 'nothing']) {
      expect(failureOf(await run(content.saveProduct, await withModel(id))).code, id).toBe('NOT_FOUND');
    }
    expect((await prisma().product.findUniqueOrThrow({ where: { id: a.product.id } })).media).toEqual([]);
  });

  it('is one per dish, and never an address typed in', async () => {
    const one = await asset(a.restaurant.id, 'MODEL', 'one');
    const two = await asset(a.restaurant.id, 'MODEL', 'two');
    const both = await drawer({ media: [{ kind: 'model', assetId: one }, { kind: 'model', assetId: two }] });
    expect(failureOf(await run(content.saveProduct, both))).toMatchObject({ code: 'INVALID', fields: { media: expect.any(String) } });
    const typed = await drawer({ media: [{ kind: 'model3d', url: 'https://example.com/x.glb' }] });
    expect(failureOf(await run(content.saveProduct, typed)).code).toBe('INVALID');
  });

  it('stops a publish when the model has left the library', async () => {
    const model = await asset(a.restaurant.id, 'MODEL', 'espresso');
    dataOf(await run(content.saveProduct, await withModel(model)));
    await prisma().mediaAsset.delete({ where: { id: model } });
    const snapshot = await loadDraftSnapshot(prisma(), a.menu.id);
    expect(snapshot.catalog.products.find((product) => product.id === a.product.id)!.media).toEqual([{ kind: 'model', assetId: model }]);
  });
});
