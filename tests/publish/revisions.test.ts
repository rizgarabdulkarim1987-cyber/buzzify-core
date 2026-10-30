import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { getPrisma } from '@/server/data/prisma';
import { getCatalog, getTenant } from '@/server/data/public-menu';
import { parseSnapshot, snapshotHash } from '@/server/domain/snapshot';
import { loadDraftSnapshot, refreshDraftHash } from '@/server/publish/draft';
import { activateDueRevisions, cancelSchedule, restoreDraftFromSnapshot, RevisionError, rollbackMenu, scheduleRevision } from '@/server/publish/revisions';
import * as content from '@/server/studio/actions/content';
import * as menus from '@/server/studio/actions/menus';
import * as prices from '@/server/studio/actions/prices';
import * as revisions from '@/server/studio/actions/revisions';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import { runQuery } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import * as contentQueries from '@/server/studio/queries/content';
import * as revisionQueries from '@/server/studio/queries/revisions';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { createMenuFixture, publishFixture, requireTestDb, resetTestData } from '../helpers/db';

const prisma = (): PrismaClient => getPrisma();
const META = { ip: '203.0.113.7', userAgent: 'vitest' };
const MINUTE = 60_000;

const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  return result.data;
};
const failureOf = (result: ActionResult<unknown>) => {
  if (result.ok) throw new Error(`expected a failure, got ${JSON.stringify(result.data)}`);
  return result.error;
};

let a: Awaited<ReturnType<typeof createMenuFixture>>;
let r1: { id: string; snapshotHash: string; snapshot: unknown };
let designer: Actor;

const run = <I, O>(def: ActionDef<I, O>, input: unknown) => runAction(prisma(), designer, def, input, META);
const menuRow = () => prisma().menu.findUniqueOrThrow({ where: { id: a.menu.id } });
const livePrice = async () => (await getCatalog((await getTenant('rev-a'))!)).products.find((product) => product.id === a.product.id)!.basePrice;

async function setPrice(price: number) {
  await prisma().product.update({ where: { id: a.product.id }, data: { basePrice: price } });
  await refreshDraftHash(prisma(), a.menu.id);
}

const schedule = (goLiveAt: Date, now: Date, menuId = a.menu.id, replacePending = false) =>
  prisma().$transaction((tx) => scheduleRevision(tx, { menuId, actorId: null, goLiveAt, replacePending, now }));

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
});

beforeEach(async () => {
  await resetTestData(prisma());
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  a = await createMenuFixture(prisma(), 'rev-a');
  r1 = await prisma().menuRevision.findFirstOrThrow({ where: { menuId: a.menu.id, number: 1 }, select: { id: true, snapshotHash: true, snapshot: true } });
  await prisma().user.create({ data: { id: 'designer-a', name: 'Alpha Designer', email: 'designer-a@example.com' } });
  await prisma().membership.create({ data: { userId: 'designer-a', restaurantId: a.restaurant.id, role: 'DESIGNER' } });
  designer = (await loadActor(prisma(), 'designer-a')) as Actor;
});

afterAll(async () => {
  await resetTestData(prisma());
});

describe('rollback', () => {
  it('rolls back by moving the live revision and copying nothing', async () => {
    await setPrice(500);
    await publishFixture(prisma(), a.menu.id);
    expect(await livePrice()).toBe(500);
    expect(await prisma().$transaction((tx) => rollbackMenu(tx, { menuId: a.menu.id, revisionId: r1.id }))).toEqual({ number: 1 });
    expect(await prisma().menuRevision.count({ where: { menuId: a.menu.id } })).toBe(2);
    expect(await menuRow()).toMatchObject({ liveRevisionId: r1.id, liveHash: r1.snapshotHash });
    expect(await livePrice()).toBe(300);
  });

  it('refuses to roll back to a revision that never went live, or to the live one', async () => {
    const now = new Date();
    const pending = await schedule(new Date(now.getTime() + 60 * MINUTE), now);
    if (!pending.ok) throw new Error('blocked');
    await expect(prisma().$transaction((tx) => rollbackMenu(tx, { menuId: a.menu.id, revisionId: pending.revisionId }))).rejects.toMatchObject({ code: 'NOT_LIVE_BEFORE' });
    await expect(prisma().$transaction((tx) => rollbackMenu(tx, { menuId: a.menu.id, revisionId: r1.id }))).rejects.toMatchObject({ code: 'ALREADY_LIVE' });
  });

  it('rolls back through the action, with its audit row', async () => {
    await setPrice(500);
    await publishFixture(prisma(), a.menu.id);
    expect(dataOf(await run(revisions.rollback, { menuId: a.menu.id, revisionId: r1.id }))).toEqual({ number: 1 });
    expect(await prisma().auditLog.findFirstOrThrow({ where: { action: 'menu.rolled_back' } })).toMatchObject({ entityType: 'Menu', entityId: a.menu.id });
  });
});

describe('restore to draft', () => {
  it('restores a revision into the draft with its own ids, the live switches and its settings', async () => {
    await setPrice(950);
    await prisma().product.create({ data: { menuId: a.menu.id, categoryId: a.category.id, slug: 'added', basePrice: 100, translations: { en: { name: 'Added' } } } });
    await prisma().menu.update({ where: { id: a.menu.id }, data: { currency: 'EUR', seo: { en: { title: 'Changed', description: '' } } } });
    await prisma().product.update({ where: { id: a.product.id }, data: { isAvailable: false } });

    await prisma().$transaction((tx) => restoreDraftFromSnapshot(tx, a.menu.id, parseSnapshot(r1.snapshot)));
    const draft = await loadDraftSnapshot(prisma(), a.menu.id);
    expect(draft.catalog.products.map((product) => product.id)).toEqual(parseSnapshot(r1.snapshot).catalog.products.map((product) => product.id));
    expect(snapshotHash(draft)).toBe(r1.snapshotHash);
    expect((await menuRow()).draftHash).toBe(r1.snapshotHash);
    expect(await prisma().product.findUniqueOrThrow({ where: { id: a.product.id } })).toMatchObject({ isAvailable: false, basePrice: 300, version: 2 });
    expect((await menuRow()).currency).toBe('USD');
  });

  it('restores occasions, showcase cards and a set people count, so the draft hashes as the revision', async () => {
    const menuId = a.menu.id;
    const occasion = await prisma().occasion.create({ data: { menuId, startsOn: '2026-01-01', endsOn: '2026-12-31', translations: { en: { name: 'Eid' } } } });
    const offer = await prisma().promotion.create({
      data: { menuId, kind: 'DISCOUNT', percentOff: 10, productIds: [a.product.id], categoryIds: [], translations: { en: { title: 'Ten off' } } },
    });
    const set = await prisma().bundle.create({
      data: { menuId, slug: 'family', price: 1500, dayparts: [], translations: { en: { name: 'Family' } }, people: 4, items: { create: [{ menuId, productId: a.product.id, quantity: 2 }] } },
    });
    await prisma().showcaseCard.createMany({
      data: [
        { menuId, slot: 'ABOVE_SEARCH', kind: 'OFFER', sortOrder: 0, promotionId: offer.id, occasionId: occasion.id, translations: {} },
        { menuId, slot: 'ABOVE_SEARCH', kind: 'SET', sortOrder: 1, bundleId: set.id, translations: {} },
        { menuId, slot: 'BELOW_SEARCH', kind: 'BUFFET', sortOrder: 0, price: 2000, occasionId: occasion.id, translations: { en: { title: 'Buffet' } } },
      ],
    });
    const published = await publishFixture(prisma(), menuId);
    const r2 = await prisma().menuRevision.findUniqueOrThrow({ where: { id: published.revisionId } });
    const before = await prisma().showcaseCard.findMany({ where: { menuId }, orderBy: { id: 'asc' } });
    const versions = new Map(before.map((card) => [card.id, card.version]));

    // Edits after the publish: the set loses its people count, the offer and its card go, a card is added.
    await prisma().bundle.update({ where: { id: set.id }, data: { people: null } });
    await prisma().promotion.delete({ where: { id: offer.id } });
    await prisma().showcaseCard.create({ data: { menuId, slot: 'BELOW_SEARCH', kind: 'BUFFET', sortOrder: 5, price: 1, translations: {} } });
    await refreshDraftHash(prisma(), menuId);
    expect((await menuRow()).draftHash).not.toBe(r2.snapshotHash);

    await prisma().$transaction((tx) => restoreDraftFromSnapshot(tx, menuId, parseSnapshot(r2.snapshot)));
    expect(snapshotHash(await loadDraftSnapshot(prisma(), menuId))).toBe(r2.snapshotHash);
    expect((await menuRow()).draftHash).toBe(r2.snapshotHash);
    const after = await prisma().showcaseCard.findMany({ where: { menuId }, orderBy: { id: 'asc' } });
    expect(after.map((card) => card.id)).toEqual(before.map((card) => card.id));
    // A card that was still there moves on a version; the offer card the delete took with it comes back at 1.
    const setCard = after.find((card) => card.kind === 'SET')!;
    expect(setCard.version).toBe(versions.get(setCard.id)! + 1);
    expect(after.find((card) => card.kind === 'OFFER')!.version).toBe(1);
    expect(await prisma().occasion.findUniqueOrThrow({ where: { id: occasion.id } })).toMatchObject({ version: 2, startsOn: '2026-01-01' });
    expect(await prisma().bundle.findUniqueOrThrow({ where: { id: set.id } })).toMatchObject({ people: 4 });
    expect(await prisma().promotion.findUnique({ where: { id: offer.id } })).not.toBeNull();
  });

  it('publishes and restores a menu whose cards that are on point at an offer and a set that are off', async () => {
    const menuId = a.menu.id;
    const offer = await prisma().promotion.create({
      data: { menuId, kind: 'SPECIAL', productIds: [a.product.id], categoryIds: [], isActive: false, translations: { en: { title: 'Off offer' } } },
    });
    const set = await prisma().bundle.create({
      data: { menuId, slug: 'off-set', price: 900, dayparts: [], isActive: false, translations: { en: { name: 'Off set' } }, items: { create: [{ menuId, productId: a.product.id }] } },
    });
    await prisma().showcaseCard.createMany({
      data: [
        { menuId, slot: 'ABOVE_SEARCH', kind: 'OFFER', sortOrder: 0, promotionId: offer.id, translations: {} },
        { menuId, slot: 'ABOVE_SEARCH', kind: 'SET', sortOrder: 1, bundleId: set.id, translations: {} },
        { menuId, slot: 'BELOW_SEARCH', kind: 'BUFFET', sortOrder: 0, price: 2000, translations: { en: { title: 'Buffet' } } },
      ],
    });
    // The snapshot leaves out a card whose offer or set it does not hold, so the revision stays whole.
    const draft = await loadDraftSnapshot(prisma(), menuId);
    expect(draft.catalog.showcaseCards?.map((card) => card.kind)).toEqual(['BUFFET']);
    const published = await publishFixture(prisma(), menuId);
    const r2 = await prisma().menuRevision.findUniqueOrThrow({ where: { id: published.revisionId } });
    expect(r2.snapshotHash).toBe(snapshotHash(draft));

    await prisma().$transaction((tx) => restoreDraftFromSnapshot(tx, menuId, parseSnapshot(r2.snapshot)));
    expect((await menuRow()).draftHash).toBe(r2.snapshotHash);
  });

  it('restores an old snapshot whose card points at an offer it does not hold, leaving that card out', async () => {
    const snapshot = parseSnapshot(r1.snapshot);
    snapshot.catalog.showcaseCards = [
      { id: 'orphan', slot: 'ABOVE_SEARCH', kind: 'OFFER', sortOrder: 0, occasionId: null, promotionId: 'gone-offer', bundleId: null, price: null, startMinute: null, endMinute: null, daysOfWeek: 127, translations: {} },
      { id: 'lost-occasion', slot: 'ABOVE_SEARCH', kind: 'BUFFET', sortOrder: 1, occasionId: 'gone-occasion', promotionId: null, bundleId: null, price: 5, startMinute: null, endMinute: null, daysOfWeek: 127, translations: {} },
    ];
    await prisma().$transaction((tx) => restoreDraftFromSnapshot(tx, a.menu.id, snapshot));
    expect(await prisma().showcaseCard.count({ where: { menuId: a.menu.id } })).toBe(0);
  });

  it('restores the rail choice, the logo text, the font pair and the logos', async () => {
    const logo = await prisma().mediaAsset.create({
      data: {
        restaurantId: a.restaurant.id,
        kind: 'IMAGE',
        storageKey: `r/${a.restaurant.id}/logo`,
        contentHash: 'logo',
        mime: 'image/png',
        bytes: 1,
        storedBytes: 1,
        width: 800,
        height: 400,
        variants: { original: `r/${a.restaurant.id}/logo/original.png`, webp: { '640': `r/${a.restaurant.id}/logo/webp-640.webp` } },
      },
    });
    await prisma().brandConfig.create({
      data: { menuId: a.menu.id, tokens: {}, typography: {}, logoText: 'Atelier', railStyle: 'drum', motionIntensity: 'none', fontPairId: 'cafe', logoAssetId: logo.id },
    });
    const published = await publishFixture(prisma(), a.menu.id);
    const r2 = await prisma().menuRevision.findUniqueOrThrow({ where: { id: published.revisionId } });
    await prisma().brandConfig.update({ where: { menuId: a.menu.id }, data: { logoText: 'Other', railStyle: 'grains', motionIntensity: 'subtle', fontPairId: 'classic', logoAssetId: null } });

    await prisma().$transaction((tx) => restoreDraftFromSnapshot(tx, a.menu.id, parseSnapshot(r2.snapshot)));
    expect(await prisma().brandConfig.findUniqueOrThrow({ where: { menuId: a.menu.id } })).toMatchObject({
      logoText: 'Atelier',
      railStyle: 'drum',
      motionIntensity: 'none',
      fontPairId: 'cafe',
      logoAssetId: logo.id,
    });
    expect((await menuRow()).draftHash).toBe(r2.snapshotHash);
  });

  it('refuses an editor opened before the restore', async () => {
    const product = dataOf(await runQuery(prisma(), designer, contentQueries.product, { menuId: a.menu.id, productId: a.product.id }));
    await prisma().$transaction((tx) => restoreDraftFromSnapshot(tx, a.menu.id, parseSnapshot(r1.snapshot)));
    const stale = {
      menuId: a.menu.id,
      productId: product.id,
      version: product.version,
      slug: product.slug,
      categoryId: product.categoryId,
      names: { en: 'Late' },
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

  it('names who restored, not who edited the row before the restore', async () => {
    await prisma().user.create({ data: { id: 'owner-a', name: 'Alpha Owner', email: 'owner-a@example.com' } });
    await prisma().membership.create({ data: { userId: 'owner-a', restaurantId: a.restaurant.id, role: 'OWNER' } });
    const owner = (await loadActor(prisma(), 'owner-a')) as Actor;
    const asOwner = <I, O>(def: ActionDef<I, O>, input: unknown) => runAction(prisma(), owner, def, input, META);
    const category = await prisma().category.findUniqueOrThrow({ where: { id: a.category.id } });
    const renamed = { menuId: a.menu.id, categoryId: category.id, names: { en: 'Hot drinks' }, slug: category.slug, isActive: true };
    const categoryVersion = dataOf(await asOwner(content.updateCategory, { ...renamed, version: category.version })).version;
    const product = await prisma().product.findUniqueOrThrow({ where: { id: a.product.id } });
    const reprice = (version: number, price: number) => asOwner(prices.set, { menuId: a.menu.id, target: { kind: 'product', id: product.id, version }, price });
    const productVersion = dataOf(await reprice(product.version, 700)).version;
    dataOf(await run(revisions.restore, { menuId: a.menu.id, revisionId: r1.id, expectedDraftHash: (await menuRow()).draftHash }));

    expect(failureOf(await reprice(productVersion, 800))).toMatchObject({ code: 'CONFLICT', fields: { changedBy: 'Alpha Designer' } });
    expect(failureOf(await asOwner(content.updateCategory, { ...renamed, version: categoryVersion }))).toMatchObject({
      code: 'CONFLICT',
      fields: { changedBy: 'Alpha Designer' },
    });
  });

  it('restores through the action only into the draft that was read', async () => {
    await setPrice(700);
    const { draftHash } = await menuRow();
    expect(failureOf(await run(revisions.restore, { menuId: a.menu.id, revisionId: r1.id, expectedDraftHash: 'stale' })).code).toBe('CONFLICT');
    dataOf(await run(revisions.restore, { menuId: a.menu.id, revisionId: r1.id, expectedDraftHash: draftHash }));
    expect((await prisma().product.findUniqueOrThrow({ where: { id: a.product.id } })).basePrice).toBe(300);
    expect(await prisma().auditLog.findFirstOrThrow({ where: { action: 'menu.restored_to_draft' } })).toMatchObject({ entityId: a.menu.id });
  });
});

describe('scheduled publishing', () => {
  it('schedules one revision and refuses a second unless it replaces the first', async () => {
    const now = new Date();
    const first = await schedule(new Date(now.getTime() + 60 * MINUTE), now);
    expect(first).toMatchObject({ ok: true, number: 2 });
    expect(await menuRow()).toMatchObject({ liveRevisionId: r1.id });
    await expect(schedule(new Date(now.getTime() + 90 * MINUTE), now)).rejects.toMatchObject({ code: 'PENDING_EXISTS', pending: { number: 2 } });
    const second = await schedule(new Date(now.getTime() + 90 * MINUTE), now, a.menu.id, true);
    expect(second).toMatchObject({ ok: true, number: 3 });
    expect((await prisma().menuRevision.findFirstOrThrow({ where: { menuId: a.menu.id, number: 2 } })).cancelledAt).not.toBeNull();
  });

  it('refuses a time under a minute ahead, in the past, or more than a year away', async () => {
    const now = new Date();
    await expect(schedule(new Date(now.getTime() + 30_000), now)).rejects.toBeInstanceOf(RevisionError);
    await expect(schedule(new Date(now.getTime() + 30_000), now)).rejects.toMatchObject({ code: 'TOO_SOON' });
    await expect(schedule(new Date(now.getTime() + 367 * 24 * 60 * MINUTE), now)).rejects.toMatchObject({ code: 'TOO_FAR' });
    const soon = failureOf(await run(revisions.schedule, { menuId: a.menu.id, goLiveAt: new Date(Date.now() + 30_000).toISOString() }));
    expect(soon).toMatchObject({ code: 'INVALID', fields: { goLiveAt: expect.any(String) } });
    expect(failureOf(await run(revisions.schedule, { menuId: a.menu.id, goLiveAt: new Date(Date.now() - 60 * MINUTE).toISOString() })).code).toBe('INVALID');
  });

  it('answers a second schedule with the pending one, and cancels it', async () => {
    const goLiveAt = new Date(Date.now() + 60 * MINUTE).toISOString();
    const { number, revisionId } = dataOf(await run(revisions.schedule, { menuId: a.menu.id, goLiveAt }));
    expect(number).toBe(2);
    expect(failureOf(await run(revisions.schedule, { menuId: a.menu.id, goLiveAt }))).toMatchObject({ code: 'CONFLICT', fields: { pendingNumber: '2', pendingAt: goLiveAt } });
    dataOf(await run(revisions.cancelSchedule, { menuId: a.menu.id, revisionId }));
    expect((await prisma().menuRevision.findUniqueOrThrow({ where: { id: revisionId } })).cancelledAt).not.toBeNull();
    expect(await prisma().auditLog.count({ where: { action: { in: ['menu.publish_scheduled', 'menu.schedule_cancelled'] } } })).toBe(2);
  });

  it('keeps the pending schedule when publishing now, and says so', async () => {
    const goLiveAt = new Date(Date.now() + 60 * MINUTE);
    dataOf(await run(revisions.schedule, { menuId: a.menu.id, goLiveAt: goLiveAt.toISOString() }));
    await setPrice(400);
    const published = dataOf(await run(menus.publish, { menuId: a.menu.id }));
    expect(published).toMatchObject({ number: 3, pendingSchedule: { number: 2, goLiveAt: goLiveAt.toISOString() } });
    expect(await prisma().menuRevision.findFirstOrThrow({ where: { menuId: a.menu.id, number: 2 } })).toMatchObject({ wentLiveAt: null, cancelledAt: null });
  });

  it('makes a due revision live and leaves a future one pending', async () => {
    const b = await createMenuFixture(prisma(), 'rev-b');
    const now = new Date();
    await setPrice(800);
    const due = await schedule(new Date(now.getTime() + 2 * MINUTE), now);
    const later = await schedule(new Date(now.getTime() + 60 * MINUTE), now, b.menu.id);
    if (!due.ok || !later.ok) throw new Error('blocked');

    expect(await activateDueRevisions(prisma(), new Date(now.getTime() + 3 * MINUTE))).toEqual({ activated: 1, cancelled: 0 });
    expect(await menuRow()).toMatchObject({ liveRevisionId: due.revisionId });
    expect(await livePrice()).toBe(800);
    expect((await prisma().menuRevision.findUniqueOrThrow({ where: { id: later.revisionId } })).wentLiveAt).toBeNull();
    expect(await prisma().auditLog.findFirstOrThrow({ where: { action: 'menu.schedule_went_live' } })).toMatchObject({ actorId: null, menuId: a.menu.id, entityId: a.menu.id });
  });

  it('cancels a due revision of an archived menu', async () => {
    const now = new Date();
    const due = await schedule(new Date(now.getTime() + 2 * MINUTE), now);
    if (!due.ok) throw new Error('blocked');
    await prisma().menu.update({ where: { id: a.menu.id }, data: { status: 'ARCHIVED', statusBeforeArchive: 'PUBLISHED' } });
    expect(await activateDueRevisions(prisma(), new Date(now.getTime() + 3 * MINUTE))).toEqual({ activated: 0, cancelled: 1 });
    expect((await prisma().menuRevision.findUniqueOrThrow({ where: { id: due.revisionId } })).cancelledAt).not.toBeNull();
    expect(await menuRow()).toMatchObject({ liveRevisionId: r1.id });
  });

  it('activates a due revision once when two cron runs overlap', async () => {
    const now = new Date();
    const due = await schedule(new Date(now.getTime() + 2 * MINUTE), now);
    if (!due.ok) throw new Error('blocked');
    const later = new Date(now.getTime() + 3 * MINUTE);
    const results = await Promise.all([activateDueRevisions(prisma(), later), activateDueRevisions(prisma(), later)]);
    expect(results.reduce((sum, result) => sum + result.activated, 0)).toBe(1);
    expect(await prisma().auditLog.count({ where: { action: 'menu.schedule_went_live' } })).toBe(1);
  });

  it('cancels a pending revision once', async () => {
    const now = new Date();
    const due = await schedule(new Date(now.getTime() + 60 * MINUTE), now);
    if (!due.ok) throw new Error('blocked');
    await prisma().$transaction((tx) => cancelSchedule(tx, { menuId: a.menu.id, revisionId: due.revisionId, now }));
    await expect(prisma().$transaction((tx) => cancelSchedule(tx, { menuId: a.menu.id, revisionId: due.revisionId, now }))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('the revision list', () => {
  it('lists every revision newest first with its state, and the pending one', async () => {
    await setPrice(500);
    await publishFixture(prisma(), a.menu.id);
    const goLiveAt = new Date(Date.now() + 60 * MINUTE);
    await schedule(goLiveAt, new Date());
    const list = dataOf(await runQuery(prisma(), designer, revisionQueries.list, { menuId: a.menu.id, page: 1 }));
    expect(list.rows.map((row) => [row.number, row.state])).toEqual([
      [3, 'scheduled'],
      [2, 'live'],
      [1, 'past'],
    ]);
    expect(list).toMatchObject({ total: 3, timezone: 'Asia/Baghdad', pending: { number: 3, goLiveAt: goLiveAt.toISOString() } });
  });

  it('shows a revision as guests saw it', async () => {
    await setPrice(500);
    await publishFixture(prisma(), a.menu.id);
    const { view } = dataOf(await runQuery(prisma(), designer, revisionQueries.view, { menuId: a.menu.id, revisionId: r1.id, locale: 'en' }));
    expect(JSON.stringify(view)).toContain('Espresso');
  });
});


describe('restoring the sales tools', () => {
  it('brings back a promotion and a rule with their own ids and moves their versions on', async () => {
    const promotion = await prisma().promotion.create({
      data: { menuId: a.menu.id, kind: 'DISCOUNT', percentOff: 15, productIds: [a.product.id], translations: { en: { title: 'Happy hour' } } },
    });
    const other = await prisma().product.create({ data: { menuId: a.menu.id, categoryId: a.category.id, slug: 'latte', basePrice: 450, translations: { en: { name: 'Latte' } } } });
    const rule = await prisma().upsellRule.create({ data: { menuId: a.menu.id, sourceProductId: a.product.id, targetProductId: other.id, translations: {} } });
    await refreshDraftHash(prisma(), a.menu.id);
    const snapshot = await loadDraftSnapshot(prisma(), a.menu.id);

    await prisma().promotion.update({ where: { id: promotion.id }, data: { percentOff: 30, version: 4 } });
    await prisma().$transaction((tx) => restoreDraftFromSnapshot(tx, a.menu.id, snapshot));

    expect(await prisma().promotion.findUniqueOrThrow({ where: { id: promotion.id } })).toMatchObject({ percentOff: 15, version: 5 });
    expect(await prisma().upsellRule.findUniqueOrThrow({ where: { id: rule.id } })).toMatchObject({ version: 2 });
    expect(snapshotHash(await loadDraftSnapshot(prisma(), a.menu.id))).toBe(snapshotHash(snapshot));
  });

  it('keeps an old menu up to date: a publish before the sales tools still matches its draft', async () => {
    // r1 was published by the fixture before any sales field existed in its rows.
    await refreshDraftHash(prisma(), a.menu.id);
    const menu = await menuRow();
    expect(menu.draftHash).toBe(menu.liveHash);
    expect(r1.snapshot).not.toHaveProperty('catalog.promotions');
  });
});
