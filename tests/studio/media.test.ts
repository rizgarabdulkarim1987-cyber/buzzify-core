import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import { snapshotHash } from '@/server/domain/snapshot';
import { loadDraftSnapshot } from '@/server/publish/draft';
import * as media from '@/server/studio/actions/media';
import * as menuActions from '@/server/studio/actions/menus';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import { runQuery, type QueryDef } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import * as mediaQueries from '@/server/studio/queries/media';
import { getStorage, type Storage } from '@/server/storage/storage';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { createMenuFixture, publishFixture, requireTestDb, resetTestData } from '../helpers/db';

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
const ask = <I, O>(actor: Actor, def: QueryDef<I, O>, input: unknown) => runQuery(prisma(), actor, def, input);

const photo = (color = '#C8261C', width = 700, height = 400) =>
  sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer().then((b) => new Uint8Array(b));

let dir: string;
let storage: Storage;
let a: Awaited<ReturnType<typeof createMenuFixture>>;
let b: Awaited<ReturnType<typeof createMenuFixture>>;
let admin: Actor;
let ownerOfA: Actor;
let designerOfA: Actor;

async function person(id: string, memberships: Array<[string, 'DESIGNER' | 'OWNER']> = [], superAdmin = false): Promise<Actor> {
  await prisma().user.create({ data: { id, name: `Person ${id}`, email: `${id}@example.com`, isSuperAdmin: superAdmin, twoFactorEnabled: superAdmin } });
  for (const [restaurantId, role] of memberships) await prisma().membership.create({ data: { userId: id, restaurantId, role } });
  return (await loadActor(prisma(), id)) as Actor;
}

/** What the browser does: asks for a slot, sends the file to it, then asks for it to be finalized. */
async function upload(actor: Actor, restaurantId: string, body: Uint8Array, extra: Record<string, unknown> = {}) {
  const slot = dataOf(await run(actor, media.requestUpload, { restaurantId, fileName: 'photo.png', mime: 'image/png', bytes: body.length }));
  await storage.put(slot.uploadKey, body, { contentType: 'image/png', cacheControl: 'no-store' });
  return { slot, result: await run(actor, media.finalize, { restaurantId, uploadKey: slot.uploadKey, ...extra }) };
}

async function useInProduct(productId: string, assetId: string) {
  await prisma().product.update({ where: { id: productId }, data: { media: [{ kind: 'asset', assetId }] } });
}

beforeAll(async () => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
  dir = mkdtempSync(join(tmpdir(), 'buzzify-media-actions-'));
  vi.stubEnv('MEDIA_LOCAL_DIR', dir);
  vi.stubEnv('MEDIA_PUBLIC_URL', '/api/dev-media');
  storage = getStorage();
});

beforeEach(async () => {
  await resetTestData(prisma());
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  a = await createMenuFixture(prisma(), 'media-a');
  b = await createMenuFixture(prisma(), 'media-b');
  admin = await person('admin', [], true);
  ownerOfA = await person('owner-a', [[a.restaurant.id, 'OWNER']]);
  designerOfA = await person('designer-a', [[a.restaurant.id, 'DESIGNER']]);
});

afterAll(async () => {
  await resetTestData(prisma());
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe('uploading', () => {
  it('uploads through a signed slot and finalizes into variants under the restaurant key', async () => {
    const { slot, result } = await upload(ownerOfA, a.restaurant.id, await photo(), { alt: { en: 'Red', ar: 'أحمر' }, folder: 'Drinks' });
    expect(slot.uploadKey.startsWith(`uploads/${a.restaurant.id}/`)).toBe(true);
    expect(new URL(slot.url, 'http://x').searchParams.get('method')).toBe('PUT');
    const { assetId, deduplicated } = dataOf(result);
    expect(deduplicated).toBe(false);

    const asset = await prisma().mediaAsset.findUniqueOrThrow({ where: { id: assetId } });
    expect(asset).toMatchObject({ restaurantId: a.restaurant.id, kind: 'IMAGE', mime: 'image/png', width: 700, height: 400, folder: 'Drinks', uploadedById: 'owner-a' });
    expect(asset.alt).toEqual({ en: 'Red', ar: 'أحمر' });
    expect(asset.storageKey).toBe(`r/${a.restaurant.id}/${asset.contentHash}`);
    expect(await storage.head(`r/${a.restaurant.id}/${asset.contentHash}/webp-320.webp`)).toMatchObject({ contentType: 'image/webp' });
    expect(await storage.head(slot.uploadKey)).toBeNull();
    expect(await prisma().auditLog.findFirstOrThrow({ where: { action: 'media.uploaded' } })).toMatchObject({
      restaurantId: a.restaurant.id,
      entityType: 'MediaAsset',
      entityId: assetId,
    });
  });

  it("refuses to finalize another restaurant's upload key and leaves it alone", async () => {
    const owner = await person('owner-b', [[b.restaurant.id, 'OWNER']]);
    const slot = dataOf(await run(owner, media.requestUpload, { restaurantId: b.restaurant.id, fileName: 'x.png', mime: 'image/png', bytes: 10 }));
    await storage.put(slot.uploadKey, await photo(), { contentType: 'image/png', cacheControl: 'no-store' });
    expect(failureOf(await run(ownerOfA, media.finalize, { restaurantId: a.restaurant.id, uploadKey: slot.uploadKey })).code).toBe('NOT_FOUND');
    expect(await storage.head(slot.uploadKey)).not.toBeNull();
    expect(await prisma().mediaAsset.count()).toBe(0);
  });

  it('reuses the asset when the same file is uploaded twice to one library', async () => {
    const bytes = await photo('#123456');
    const first = dataOf((await upload(ownerOfA, a.restaurant.id, bytes)).result);
    const { slot, result } = await upload(designerOfA, a.restaurant.id, bytes);
    expect(dataOf(result)).toEqual({ assetId: first.assetId, deduplicated: true });
    expect(await prisma().mediaAsset.count()).toBe(1);
    expect(await storage.head(slot.uploadKey)).toBeNull();
  });

  it('refuses a file over 15 MB at the slot and at finalize, and leaves nothing in storage', async () => {
    const tooBig = failureOf(await run(ownerOfA, media.requestUpload, { restaurantId: a.restaurant.id, fileName: 'x.png', mime: 'image/png', bytes: 15_728_641 }));
    expect(tooBig).toMatchObject({ code: 'INVALID', fields: { file: 'SIZE' } });

    const slot = dataOf(await run(ownerOfA, media.requestUpload, { restaurantId: a.restaurant.id, fileName: 'x.png', mime: 'image/png', bytes: 100 }));
    const big = new Uint8Array(15_728_641);
    big.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await storage.put(slot.uploadKey, big, { contentType: 'image/png', cacheControl: 'no-store' });
    expect(failureOf(await run(ownerOfA, media.finalize, { restaurantId: a.restaurant.id, uploadKey: slot.uploadKey }))).toMatchObject({
      code: 'INVALID',
      fields: { file: 'SIZE' },
    });
    expect(await storage.head(slot.uploadKey)).toBeNull();
    expect(await prisma().mediaAsset.count()).toBe(0);
  });

  it('refuses an HTML page uploaded as image/svg+xml, naming the reason', async () => {
    const slot = dataOf(await run(ownerOfA, media.requestUpload, { restaurantId: a.restaurant.id, fileName: 'logo.svg', mime: 'image/svg+xml', bytes: 60 }));
    await storage.put(slot.uploadKey, new TextEncoder().encode('<!doctype html><html><svg onload="x()"/></html>'), { contentType: 'image/svg+xml', cacheControl: 'no-store' });
    expect(failureOf(await run(ownerOfA, media.finalize, { restaurantId: a.restaurant.id, uploadKey: slot.uploadKey }))).toMatchObject({
      code: 'INVALID',
      fields: { file: 'TYPE' },
    });
    expect(await storage.head(slot.uploadKey)).toBeNull();
  });

  it('refuses a type the library does not take before the upload', async () => {
    expect(failureOf(await run(ownerOfA, media.requestUpload, { restaurantId: a.restaurant.id, fileName: 'a.gif', mime: 'image/gif', bytes: 10 }))).toMatchObject({
      code: 'INVALID',
      fields: { file: 'TYPE' },
    });
  });
});

describe('the library', () => {
  it('lets an owner upload but not rename or delete', async () => {
    const { assetId } = dataOf((await upload(ownerOfA, a.restaurant.id, await photo())).result);
    expect(failureOf(await run(ownerOfA, media.updateAsset, { restaurantId: a.restaurant.id, assetId, version: 1, alt: {}, folder: 'x', tags: [] })).code).toBe('FORBIDDEN');
    expect(failureOf(await run(ownerOfA, media.deleteAsset, { restaurantId: a.restaurant.id, assetId })).code).toBe('FORBIDDEN');
    expect(dataOf(await run(designerOfA, media.updateAsset, { restaurantId: a.restaurant.id, assetId, version: 1, alt: { en: 'Red' }, folder: 'Mains', tags: ['red', 'Red', ' hot '] }))).toEqual({ version: 2 });
    expect(await prisma().mediaAsset.findUniqueOrThrow({ where: { id: assetId } })).toMatchObject({ folder: 'Mains', tags: ['hot', 'red'], version: 2 });
  });

  it('lists the restaurant library with the shared one, marked, and never another restaurant', async () => {
    const own = dataOf((await upload(ownerOfA, a.restaurant.id, await photo('#111111'), { folder: 'Drinks' })).result).assetId;
    const sharedSlot = dataOf(await run(admin, media.requestSharedUpload, { fileName: 's.png', mime: 'image/png', bytes: 10 }));
    expect(sharedSlot.uploadKey.startsWith('uploads/shared/')).toBe(true);
    await storage.put(sharedSlot.uploadKey, await photo('#222222'), { contentType: 'image/png', cacheControl: 'no-store' });
    const shared = dataOf(await run(admin, media.finalizeShared, { uploadKey: sharedSlot.uploadKey })).assetId;
    const ownerOfB = await person('owner-b', [[b.restaurant.id, 'OWNER']]);
    dataOf((await upload(ownerOfB, b.restaurant.id, await photo('#333333'))).result);

    const listed = dataOf(await ask(ownerOfA, mediaQueries.listMedia, { restaurantId: a.restaurant.id }));
    expect(listed.rows.map((row) => [row.id, row.shared]).sort()).toEqual([[own, false], [shared, true]].sort());
    expect(listed.total).toBe(2);
    expect(listed.folders).toEqual(['Drinks']);
    expect(listed.rows.find((row) => row.id === own)!.thumbUrl).toMatch(/^\/api\/dev-media\/r\/.+\/webp-320\.webp$/);
    expect(dataOf(await ask(ownerOfA, mediaQueries.listMedia, { restaurantId: a.restaurant.id, folder: 'Drinks' })).rows.map((r) => r.id)).toEqual([own]);
    expect(dataOf(await ask(ownerOfA, mediaQueries.listMedia, {})).rows.map((r) => r.id)).toEqual([shared]);
  });

  it('refuses to delete an asset a draft or a revision uses, and lists where', async () => {
    const { assetId } = dataOf((await upload(designerOfA, a.restaurant.id, await photo())).result);
    await useInProduct(a.product.id, assetId);
    const refused = failureOf(await run(designerOfA, media.deleteAsset, { restaurantId: a.restaurant.id, assetId }));
    expect(refused).toMatchObject({ code: 'INVALID', fields: { usage: '1' } });
    const usage = dataOf(await ask(designerOfA, mediaQueries.usage, { restaurantId: a.restaurant.id, assetId }));
    expect(usage.drafts).toEqual([{ menuId: a.menu.id, menuName: a.menu.name, where: 'product', label: 'Espresso' }]);

    // Published, then taken out of the draft: the revision still shows it to guests.
    await publishFixture(prisma(), a.menu.id);
    await prisma().product.update({ where: { id: a.product.id }, data: { media: [] } });
    const stillUsed = dataOf(await ask(designerOfA, mediaQueries.usage, { restaurantId: a.restaurant.id, assetId }));
    expect(stillUsed).toEqual({ drafts: [], revisions: [{ menuId: a.menu.id, menuName: a.menu.name, number: 2 }] });
    expect(failureOf(await run(designerOfA, media.deleteAsset, { restaurantId: a.restaurant.id, assetId })).code).toBe('INVALID');
    expect(await prisma().mediaAsset.count()).toBe(1);
  });

  it('deletes the files only when no other asset shares them', async () => {
    const { assetId } = dataOf((await upload(designerOfA, a.restaurant.id, await photo())).result);
    const asset = await prisma().mediaAsset.findUniqueOrThrow({ where: { id: assetId } });
    const copy = await prisma().mediaAsset.create({
      data: {
        restaurantId: b.restaurant.id,
        kind: asset.kind,
        storageKey: asset.storageKey,
        contentHash: asset.contentHash,
        mime: asset.mime,
        bytes: asset.bytes,
        storedBytes: asset.storedBytes,
        variants: asset.variants as object,
        alt: asset.alt as object,
      },
    });
    const file = `${asset.storageKey}/webp-320.webp`;

    expect(dataOf(await run(designerOfA, media.deleteAsset, { restaurantId: a.restaurant.id, assetId }))).toEqual({ deleted: true });
    expect(await storage.head(file)).not.toBeNull();
    expect(await prisma().auditLog.count({ where: { action: 'media.deleted', entityId: assetId } })).toBe(1);

    const designerOfB = await person('designer-b', [[b.restaurant.id, 'DESIGNER']]);
    dataOf(await run(designerOfB, media.deleteAsset, { restaurantId: b.restaurant.id, assetId: copy.id }));
    expect(await storage.head(file)).toBeNull();
  });

  it('refreshes the draft hash of menus whose draft uses an asset when its alt text changes', async () => {
    const { assetId } = dataOf((await upload(designerOfA, a.restaurant.id, await photo(), { alt: { en: 'Red' } })).result);
    await useInProduct(a.product.id, assetId);
    const before = await loadDraftSnapshot(prisma(), a.menu.id);
    await prisma().menu.update({ where: { id: a.menu.id }, data: { draftHash: snapshotHash(before) } });

    dataOf(await run(designerOfA, media.updateAsset, { restaurantId: a.restaurant.id, assetId, version: 1, alt: { en: 'Crimson' }, folder: '', tags: [] }));
    const menu = await prisma().menu.findUniqueOrThrow({ where: { id: a.menu.id } });
    expect(menu.draftHash).not.toBe(snapshotHash(before));
    expect(menu.draftHash).toBe(snapshotHash(await loadDraftSnapshot(prisma(), a.menu.id)));
  });

  it('refuses a stale save of an asset', async () => {
    const { assetId } = dataOf((await upload(designerOfA, a.restaurant.id, await photo())).result);
    dataOf(await run(designerOfA, media.updateAsset, { restaurantId: a.restaurant.id, assetId, version: 1, alt: {}, folder: 'One', tags: [] }));
    expect(failureOf(await run(designerOfA, media.updateAsset, { restaurantId: a.restaurant.id, assetId, version: 1, alt: {}, folder: 'Two', tags: [] })).code).toBe('CONFLICT');
  });
});

describe('duplicating a menu into another restaurant', () => {
  it('copies assets into the target restaurant, so the copy keeps its images after the source is gone', async () => {
    const { assetId } = dataOf((await upload(designerOfA, a.restaurant.id, await photo())).result);
    await useInProduct(a.product.id, assetId);
    const url = (await loadDraftSnapshot(prisma(), a.menu.id)).catalog.products[0]!.media[0] as { url: string };

    const { menuId } = dataOf(await run(admin, menuActions.duplicateMenu, { menuId: a.menu.id, name: 'Copy', slug: 'media-copy', targetRestaurantId: b.restaurant.id }));
    const copied = await prisma().product.findFirstOrThrow({ where: { menuId } });
    const copiedAssetId = (copied.media as Array<{ kind: string; assetId: string }>)[0]!;
    expect(copiedAssetId.kind).toBe('asset');
    expect(copiedAssetId.assetId).not.toBe(assetId);
    const copy = await prisma().mediaAsset.findUniqueOrThrow({ where: { id: copiedAssetId.assetId } });
    const source = await prisma().mediaAsset.findUniqueOrThrow({ where: { id: assetId } });
    expect(copy).toMatchObject({ restaurantId: b.restaurant.id, storageKey: source.storageKey, contentHash: source.contentHash });

    // The source menu and its asset go; the copy's draft still shows the same image, whose files are still there.
    await prisma().menu.update({ where: { id: a.menu.id }, data: { status: 'ARCHIVED' } });
    dataOf(await run(admin, menuActions.deleteMenu, { menuId: a.menu.id, confirmName: a.menu.name }));
    dataOf(await run(admin, media.deleteAsset, { restaurantId: a.restaurant.id, assetId }));
    const image = (await loadDraftSnapshot(prisma(), menuId)).catalog.products[0]!.media[0] as { url: string };
    expect(image.url).toBe(url.url);
    expect(await storage.head(image.url.replace('/api/dev-media/', ''))).not.toBeNull();
  });

  it('keeps shared assets shared on a cross-restaurant duplicate', async () => {
    const slot = dataOf(await run(admin, media.requestSharedUpload, { fileName: 's.png', mime: 'image/png', bytes: 10 }));
    await storage.put(slot.uploadKey, await photo('#00AA00'), { contentType: 'image/png', cacheControl: 'no-store' });
    const shared = dataOf(await run(admin, media.finalizeShared, { uploadKey: slot.uploadKey })).assetId;
    await useInProduct(a.product.id, shared);
    const { menuId } = dataOf(await run(admin, menuActions.duplicateMenu, { menuId: a.menu.id, name: 'Copy', slug: 'media-copy-shared', targetRestaurantId: b.restaurant.id }));
    const copied = await prisma().product.findFirstOrThrow({ where: { menuId } });
    expect(copied.media).toEqual([{ kind: 'asset', assetId: shared }]);
    expect(await prisma().mediaAsset.count()).toBe(1);
  });

  it('links the same assets when duplicating inside the restaurant', async () => {
    const { assetId } = dataOf((await upload(designerOfA, a.restaurant.id, await photo())).result);
    await useInProduct(a.product.id, assetId);
    const { menuId } = dataOf(await run(designerOfA, menuActions.duplicateMenu, { menuId: a.menu.id, name: 'Copy', slug: 'media-copy-same' }));
    expect((await prisma().product.findFirstOrThrow({ where: { menuId } })).media).toEqual([{ kind: 'asset', assetId }]);
  });
});
