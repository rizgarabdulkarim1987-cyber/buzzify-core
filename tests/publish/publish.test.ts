import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { scopedClient } from '@/server/data/tenant-db';
import { parseSnapshot, snapshotHash } from '@/server/domain/snapshot';
import { refreshDraftHash } from '@/server/publish/draft';
import { PublishError, publishMenu } from '@/server/publish/publish';
import { createMenuFixture, resetTestData, testPrisma } from '../helpers/db';

const prisma = testPrisma();
const NOW = new Date('2026-10-16T09:30:00.000Z');

const publish = (menuId: string, extra: { actorId?: string | null; note?: string } = {}) =>
  prisma.$transaction((tx) => publishMenu(tx, { menuId, actorId: null, now: NOW, ...extra }));

const menuRow = (menuId: string) => prisma.menu.findUniqueOrThrow({ where: { id: menuId } });

describe('publishMenu', () => {
  let a: Awaited<ReturnType<typeof createMenuFixture>>;

  beforeEach(async () => {
    await resetTestData(prisma);
    a = await createMenuFixture(prisma, 'publish-a', { publish: false });
  });

  afterAll(async () => {
    await resetTestData(prisma);
    await prisma.$disconnect();
  });

  it('creates revision 1 and makes the menu PUBLISHED', async () => {
    expect(a.menu).toMatchObject({ status: 'DRAFT', liveRevisionId: null });
    const out = await publish(a.menu.id);
    expect(out).toMatchObject({ ok: true, number: 1 });
    expect(await menuRow(a.menu.id)).toMatchObject({ status: 'PUBLISHED', liveRevisionId: out.ok && out.revisionId });
  });

  it('freezes the draft, the settings and the restaurant name into the revision', async () => {
    const out = await publish(a.menu.id, { actorId: 'user-1', note: 'Autumn menu' });
    if (!out.ok) throw new Error('expected the publish to succeed');
    const revision = await prisma.menuRevision.findUniqueOrThrow({ where: { id: out.revisionId } });
    expect(revision).toMatchObject({
      menuId: a.menu.id,
      number: 1,
      schemaVersion: 1,
      wentLiveAt: NOW,
      goLiveAt: null,
      cancelledAt: null,
      createdById: 'user-1',
      note: 'Autumn menu',
    });
    const snapshot = parseSnapshot(revision.snapshot);
    expect(revision.snapshotHash).toBe(snapshotHash(snapshot));
    expect(snapshot.menu).toMatchObject({ name: 'Menu publish-a', displayName: 'Restaurant publish-a', currency: 'USD' });
    expect(snapshot.catalog.products.map((p) => [p.id, p.basePrice])).toEqual([[a.product.id, 300]]);
  });

  it('publishes past warnings and returns them', async () => {
    const out = await publish(a.menu.id);
    if (!out.ok) throw new Error('expected the publish to succeed');
    // The fixture product has no image and only an English name.
    expect(out.warnings).toContainEqual(expect.objectContaining({ code: 'NO_IMAGE', severity: 'warn' }));
    expect(out.warnings).toContainEqual(expect.objectContaining({ code: 'MISSING_TRANSLATION', locale: 'ckb' }));
    expect(out.warnings.every((issue) => issue.severity === 'warn')).toBe(true);
  });

  it('refuses to publish when a block issue exists and creates no revision', async () => {
    await prisma.category.create({ data: { menuId: a.menu.id, slug: 'empty', translations: { en: { name: 'Empty' } } } });
    const out = await publish(a.menu.id);
    expect(out.ok).toBe(false);
    expect(!out.ok && out.issues).toContainEqual(expect.objectContaining({ code: 'EMPTY_CATEGORY', severity: 'block' }));
    expect(await prisma.menuRevision.count({ where: { menuId: a.menu.id } })).toBe(0);
    expect(await menuRow(a.menu.id)).toMatchObject({ status: 'DRAFT', liveRevisionId: null, liveHash: null });
  });

  it('numbers successive publishes and keeps the latest live', async () => {
    const first = await publish(a.menu.id);
    await prisma.product.update({ where: { id: a.product.id }, data: { basePrice: 350 } });
    const second = await publish(a.menu.id);
    expect([first.ok && first.number, second.ok && second.number]).toEqual([1, 2]);
    expect((await menuRow(a.menu.id)).liveRevisionId).toBe(second.ok && second.revisionId);
  });

  it('numbers concurrent publishes consecutively', async () => {
    const results = await Promise.all([1, 2, 3].map(() => publish(a.menu.id)));
    expect(results.map((r) => r.ok && r.number).sort()).toEqual([1, 2, 3]);
    const live = await prisma.menuRevision.findUniqueOrThrow({
      where: { id: (await menuRow(a.menu.id)).liveRevisionId! },
    });
    // The publishes queue on the menu row, so the last to commit holds the highest number and stays live.
    expect(live.number).toBe(3);
  });

  it('keeps a suspended menu suspended and refuses an archived one', async () => {
    await prisma.menu.update({ where: { id: a.menu.id }, data: { status: 'SUSPENDED' } });
    const out = await publish(a.menu.id);
    expect(out).toMatchObject({ ok: true, number: 1 });
    expect(await menuRow(a.menu.id)).toMatchObject({ status: 'SUSPENDED', liveRevisionId: out.ok && out.revisionId });

    await prisma.menu.update({ where: { id: a.menu.id }, data: { status: 'ARCHIVED' } });
    const refused = publish(a.menu.id);
    await expect(refused).rejects.toBeInstanceOf(PublishError);
    await expect(refused).rejects.toMatchObject({ code: 'ARCHIVED' });
    expect(await prisma.menuRevision.count({ where: { menuId: a.menu.id } })).toBe(1);
  });

  it('refuses a menu that does not exist', async () => {
    await expect(publish('no-such-menu')).rejects.toMatchObject({ name: 'PublishError', code: 'NOT_FOUND' });
  });

  it('takes the menu row with a version increment', async () => {
    await publish(a.menu.id);
    expect((await menuRow(a.menu.id)).version).toBe(a.menu.version + 1);
  });

  it('sets liveHash equal to draftHash after publishing', async () => {
    const out = await publish(a.menu.id);
    if (!out.ok) throw new Error('expected the publish to succeed');
    const menu = await menuRow(a.menu.id);
    const revision = await prisma.menuRevision.findUniqueOrThrow({ where: { id: out.revisionId } });
    expect(menu.liveHash).toBe(revision.snapshotHash);
    expect(menu.draftHash).toBe(menu.liveHash);
    // Recomputing from the untouched draft gives the same hash; a draft edit changes it.
    expect(await refreshDraftHash(prisma, a.menu.id)).toBe(menu.liveHash);
    await prisma.product.update({ where: { id: a.product.id }, data: { basePrice: 450 } });
    const edited = await refreshDraftHash(prisma, a.menu.id);
    expect(edited).not.toBe(menu.liveHash);
    expect((await menuRow(a.menu.id)).draftHash).toBe(edited);
  });

  it('does not count live changes as unpublished changes', async () => {
    const out = await publish(a.menu.id);
    if (!out.ok) throw new Error('expected the publish to succeed');
    await prisma.product.update({ where: { id: a.product.id }, data: { isAvailable: false, isHidden: true, stockCount: 4 } });
    expect(await refreshDraftHash(prisma, a.menu.id)).toBe((await menuRow(a.menu.id)).liveHash);
  });

  it('publishes through a transaction scoped to the menu', async () => {
    const db = scopedClient(prisma, { menuId: a.menu.id, restaurantId: a.restaurant.id });
    const out = await db.$transaction((tx) => publishMenu(tx, { menuId: a.menu.id, actorId: null, now: NOW }));
    expect(out).toMatchObject({ ok: true, number: 1 });
    const revision = await prisma.menuRevision.findFirstOrThrow({ where: { menuId: a.menu.id } });
    expect(parseSnapshot(revision.snapshot).catalog.products).toHaveLength(1);
  });
});
