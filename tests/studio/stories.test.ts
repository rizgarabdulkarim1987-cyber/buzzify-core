import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import { loadStories } from '@/server/data/stories';
import type { TenantInfo } from '@/server/data/tenant';
import { MAX_LIVE_STORIES } from '@/server/domain/stories';
import type { Catalog } from '@/server/domain/types';
import * as stories from '@/server/studio/actions/stories';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import { runQuery } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import * as storyQueries from '@/server/studio/queries/stories';
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

let dir: string;
let a: Awaited<ReturnType<typeof createMenuFixture>>;
let b: Awaited<ReturnType<typeof createMenuFixture>>;
let owner: Actor;
let picture: string;

const run = <I, O>(def: ActionDef<I, O>, input: unknown, actor: Actor = owner) => runAction(prisma(), actor, def, input, META);
const onPlan = (plan: 'BASIC' | 'PRO') => prisma().restaurant.update({ where: { id: a.restaurant.id }, data: { plan } });
const story = (overrides: Record<string, unknown> = {}) => ({ menuId: a.menu.id, assetId: picture, productId: null, captions: { en: 'Fresh baklava' }, isActive: true, ...overrides });

async function image(restaurantId: string | null, seed: string): Promise<string> {
  const hash = createHash('sha256').update(`${restaurantId}-${seed}`).digest('hex');
  const folder = `${restaurantId === null ? 'shared' : `r/${restaurantId}`}/${hash}`;
  const row = await prisma().mediaAsset.create({
    data: {
      restaurantId,
      kind: 'IMAGE',
      storageKey: folder,
      contentHash: hash,
      mime: 'image/png',
      bytes: 100,
      storedBytes: 100,
      width: 320,
      height: 200,
      variants: { original: `${folder}/original.png`, webp: { '320': `${folder}/webp-320.webp` }, avif: { '320': `${folder}/avif-320.avif` } },
    },
  });
  return row.id;
}

// The guest read needs only these parts of the tenant.
const tenantOf = () => ({ id: a.menu.id, restaurantId: a.restaurant.id, defaultLocale: 'en' }) as unknown as TenantInfo;
const noCatalog = (products: Array<{ id: string; slug: string; isHidden?: boolean }> = []) => ({ products: products.map((p) => ({ isHidden: false, ...p })) }) as unknown as Catalog;

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
  dir = mkdtempSync(join(tmpdir(), 'buzzify-stories-'));
  vi.stubEnv('MEDIA_LOCAL_DIR', dir);
  vi.stubEnv('MEDIA_PUBLIC_URL', '/api/dev-media');
});

beforeEach(async () => {
  await resetTestData(prisma());
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  a = await createMenuFixture(prisma(), 'stories-a');
  b = await createMenuFixture(prisma(), 'stories-b');
  await prisma().user.create({ data: { id: 'owner-a', name: 'Alpha Owner', email: 'owner-a@example.com' } });
  await prisma().membership.create({ data: { userId: 'owner-a', restaurantId: a.restaurant.id, role: 'OWNER' } });
  owner = (await loadActor(prisma(), 'owner-a')) as Actor;
  picture = await image(a.restaurant.id, 'baklava');
  await onPlan('PRO');
});

afterAll(async () => {
  await resetTestData(prisma());
  rmSync(dir, { recursive: true, force: true });
});

describe('saving a story (plan feature guest.stories)', () => {
  it('creates a story that runs for a day unless told otherwise, and edits it', async () => {
    const before = Date.now();
    const { storyId } = dataOf(await run(stories.saveStory, story()));
    const row = await prisma().menuStory.findUniqueOrThrow({ where: { id: storyId } });
    expect(row).toMatchObject({ menuId: a.menu.id, assetId: picture, isActive: true, captions: { en: 'Fresh baklava' } });
    expect(row.expiresAt.getTime() - before).toBeGreaterThan(23.9 * 3600_000);
    expect(row.expiresAt.getTime() - before).toBeLessThan(24.1 * 3600_000);

    dataOf(await run(stories.saveStory, story({ storyId, captions: { en: 'Baklava', ar: 'بقلاوة' }, hours: 6 })));
    const edited = await prisma().menuStory.findUniqueOrThrow({ where: { id: storyId } });
    expect(edited.captions).toEqual({ en: 'Baklava', ar: 'بقلاوة' });
    expect(edited.expiresAt.getTime() - Date.now()).toBeLessThan(6.1 * 3600_000);
  });

  it('keeps the end time when an edit gives no hours', async () => {
    const { storyId } = dataOf(await run(stories.saveStory, story({ hours: 48 })));
    const first = (await prisma().menuStory.findUniqueOrThrow({ where: { id: storyId } })).expiresAt.getTime();
    dataOf(await run(stories.saveStory, story({ storyId, isActive: false })));
    expect((await prisma().menuStory.findUniqueOrThrow({ where: { id: storyId } })).expiresAt.getTime()).toBe(first);
  });

  it('refuses a plan without stories, naming the plan that has them, and saves none', async () => {
    await onPlan('BASIC');
    expect(failureOf(await run(stories.saveStory, story()))).toMatchObject({ code: 'UPGRADE_REQUIRED', upgrade: { feature: 'guest.stories', plan: 'PRO' } });
    expect(await prisma().menuStory.count()).toBe(0);
  });

  it('lets a plan without stories delete the ones it has, so a downgrade can clear them', async () => {
    const { storyId } = dataOf(await run(stories.saveStory, story()));
    await onPlan('BASIC');
    dataOf(await run(stories.deleteStory, { menuId: a.menu.id, storyId }));
    expect(await prisma().menuStory.count()).toBe(0);
  });

  it('takes only a picture of the restaurant’s own library or the shared one, and only a dish of this menu', async () => {
    const theirs = await image(b.restaurant.id, 'theirs');
    expect(failureOf(await run(stories.saveStory, story({ assetId: theirs }))).code).toBe('NOT_FOUND');
    expect(failureOf(await run(stories.saveStory, story({ assetId: 'missing' }))).code).toBe('NOT_FOUND');
    dataOf(await run(stories.saveStory, story({ assetId: await image(null, 'shared') })));

    const foreignDish = await prisma().product.create({ data: { menuId: b.menu.id, categoryId: b.category.id, slug: 'x', basePrice: 100, translations: { en: { name: 'X' } } } });
    expect(failureOf(await run(stories.saveStory, story({ productId: foreignDish.id }))).code).toBe('NOT_FOUND');
    dataOf(await run(stories.saveStory, story({ productId: a.product.id })));
  });

  it('allows at most the shown number of running stories', async () => {
    for (let i = 0; i < MAX_LIVE_STORIES; i += 1) dataOf(await run(stories.saveStory, story({ captions: { en: `s${i}` } })));
    expect(failureOf(await run(stories.saveStory, story())).code).toBe('INVALID');
    // One switched off does not count, so it can still be saved.
    dataOf(await run(stories.saveStory, story({ isActive: false })));
  });

  it('will not touch another menu’s story', async () => {
    const other = await prisma().menuStory.create({ data: { menuId: b.menu.id, assetId: picture, expiresAt: new Date(Date.now() + 3600_000) } });
    expect(failureOf(await run(stories.saveStory, story({ storyId: other.id }))).code).toBe('NOT_FOUND');
    expect(failureOf(await run(stories.deleteStory, { menuId: a.menu.id, storyId: other.id })).code).toBe('NOT_FOUND');
  });
});

describe('the Studio list', () => {
  it('lists every story, ended ones included, newest first, with a thumbnail and the plan’s allowance', async () => {
    const first = dataOf(await run(stories.saveStory, story({ captions: { en: 'One' } }))).storyId;
    await prisma().menuStory.update({ where: { id: first }, data: { expiresAt: new Date(Date.now() - 1000), createdAt: new Date(Date.now() - 10_000) } });
    dataOf(await run(stories.saveStory, story({ captions: { en: 'Two' } })));
    const view = dataOf(await runQuery(prisma(), owner, storyQueries.menuStories, { menuId: a.menu.id }));
    expect(view.stories.map((row) => [row.captions.en, row.ended])).toEqual([['Two', false], ['One', true]]);
    expect(view.stories[0]?.thumb).toContain('webp-320');
    expect(view.upgrade.allowed).toContain('guest.stories');
  });
});

describe('the guest read', () => {
  it('returns the running stories newest first in the guest’s language, leaving out ended and switched-off ones', async () => {
    const live = dataOf(await run(stories.saveStory, story({ captions: { en: 'Fresh baklava', ar: 'بقلاوة طازجة' } }))).storyId;
    dataOf(await run(stories.saveStory, story({ captions: { en: 'Off' }, isActive: false })));
    const ended = dataOf(await run(stories.saveStory, story({ captions: { en: 'Ended' } }))).storyId;
    await prisma().menuStory.update({ where: { id: ended }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const english = await loadStories(tenantOf(), 'en', noCatalog(), new Date());
    expect(english.map((s) => s.id)).toEqual([live]);
    expect(english[0]).toMatchObject({ caption: 'Fresh baklava', productSlug: null });
    expect(english[0]?.image).toMatchObject({ kind: 'image', width: 320, height: 200 });
    expect((await loadStories(tenantOf(), 'ar', noCatalog(), new Date()))[0]?.caption).toBe('بقلاوة طازجة');
    // A guest whose language has no caption gets the menu's own.
    expect((await loadStories(tenantOf(), 'ckb', noCatalog(), new Date()))[0]?.caption).toBe('Fresh baklava');
  });

  it('links a dish that is still on the menu and drops the link to one that is hidden or gone', async () => {
    dataOf(await run(stories.saveStory, story({ productId: a.product.id })));
    expect((await loadStories(tenantOf(), 'en', noCatalog([{ id: a.product.id, slug: 'burger' }]), new Date()))[0]?.productSlug).toBe('burger');
    expect((await loadStories(tenantOf(), 'en', noCatalog([{ id: a.product.id, slug: 'burger', isHidden: true }]), new Date()))[0]?.productSlug).toBeNull();
    expect((await loadStories(tenantOf(), 'en', noCatalog(), new Date()))[0]?.productSlug).toBeNull();
  });

  it('leaves out a story whose picture has left the library', async () => {
    dataOf(await run(stories.saveStory, story()));
    await prisma().mediaAsset.delete({ where: { id: picture } });
    expect(await loadStories(tenantOf(), 'en', noCatalog(), new Date())).toEqual([]);
  });
});
