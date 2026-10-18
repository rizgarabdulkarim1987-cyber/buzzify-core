import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { slotOf, type SnapshotMotion } from '@/server/domain/menu-motions';
import { parseSnapshot, snapshotHash, type MenuSnapshot } from '@/server/domain/snapshot';
import { loadDraftSnapshot, restoreDraftFromSnapshot, writeDraftFromSnapshot } from '@/server/publish/draft';
import { createMenuFixture, publishFixture, requireTestDb, resetTestData, testPrisma } from '../helpers/db';

/** A menu's motions as draft rows and in its revisions (spec: 2026-10-18-menu-motions-design.md, sections 6 and 7). */

const prisma = testPrisma();
let a: Awaited<ReturnType<typeof createMenuFixture>>;

/** Writes a placement row the way the motions service does: the slot and the category together. */
function place(menuId: string, motion: { place: 'hero' | 'signature' | 'category'; categoryId?: string; motionId: string; params?: object; texts?: object }) {
  return prisma.menuMotion.create({
    data: {
      menuId,
      slot: slotOf(motion.place, motion.categoryId),
      categoryId: motion.categoryId ?? null,
      motionId: motion.motionId,
      params: motion.params ?? {},
      texts: motion.texts ?? {},
    },
  });
}

async function liveSnapshot(menuId: string): Promise<{ snapshot: MenuSnapshot; hash: string }> {
  const menu = await prisma.menu.findUniqueOrThrow({ where: { id: menuId } });
  const revision = await prisma.menuRevision.findUniqueOrThrow({ where: { id: menu.liveRevisionId! } });
  return { snapshot: parseSnapshot(revision.snapshot), hash: revision.snapshotHash };
}

beforeEach(async () => {
  requireTestDb();
  await resetTestData(prisma);
  a = await createMenuFixture(prisma, 'motions-a');
});

afterAll(async () => {
  await resetTestData(prisma);
});

describe('a menu’s motions', () => {
  it('leaves a menu without motions with no motions key, so its hash is the one it had', async () => {
    const draft = await loadDraftSnapshot(prisma, a.menu.id);
    expect(draft).not.toHaveProperty('motions');
    expect(snapshotHash(draft)).toBe((await liveSnapshot(a.menu.id)).hash);
  });

  it('publishes the menu’s motions, cleaned and sorted by slot', async () => {
    await place(a.menu.id, { place: 'signature', motionId: 'soft-glow' });
    await place(a.menu.id, { place: 'category', categoryId: a.category.id, motionId: 'golden-particles', params: { count: 999, made: 1 } });
    await publishFixture(prisma, a.menu.id);
    const { snapshot } = await liveSnapshot(a.menu.id);
    expect(snapshot.motions).toEqual([
      { place: 'category', categoryId: a.category.id, motionId: 'golden-particles', params: { color: '#d4a64a', background: '#0d0b09', count: 400 }, texts: {} },
      expect.objectContaining({ place: 'signature', motionId: 'soft-glow', texts: {} }),
    ]);
  });

  it('drops, when reading a revision, a motion it cannot place', async () => {
    await place(a.menu.id, { place: 'hero', motionId: 'golden-particles' });
    const draft = await loadDraftSnapshot(prisma, a.menu.id);
    const stored = JSON.parse(JSON.stringify(draft)) as MenuSnapshot & { motions: unknown[] };
    stored.motions.push(
      { place: 'hero', motionId: 'add-to-cart', params: {}, texts: {} },
      { place: 'category', categoryId: 'gone', motionId: 'coffee-steam', params: {}, texts: {} },
      'junk',
    );
    expect(parseSnapshot(stored).motions?.map((motion: SnapshotMotion) => motion.motionId)).toEqual(['golden-particles']);
    expect(parseSnapshot({ ...stored, motions: ['junk'] })).not.toHaveProperty('motions');
  });

  it('brings a revision’s motions back when it is restored to the draft', async () => {
    await place(a.menu.id, { place: 'hero', motionId: 'text-reveal', params: { color: '#112233' }, texts: { text: { en: 'Fresh' } } });
    await publishFixture(prisma, a.menu.id);
    await prisma.menuMotion.deleteMany({ where: { menuId: a.menu.id } });
    const { snapshot } = await liveSnapshot(a.menu.id);
    await prisma.$transaction((tx) => restoreDraftFromSnapshot(tx, a.menu.id, snapshot));
    const rows = await prisma.menuMotion.findMany({ where: { menuId: a.menu.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ slot: 'hero', categoryId: null, motionId: 'text-reveal', texts: { text: { en: 'Fresh' } } });
    expect(rows[0]!.params).toMatchObject({ color: '#112233' });
  });

  it('maps a category’s motion onto the copy’s category when a menu is written into another', async () => {
    await place(a.menu.id, { place: 'hero', motionId: 'aurora-background' });
    await place(a.menu.id, { place: 'category', categoryId: a.category.id, motionId: 'coffee-steam' });
    const source = await loadDraftSnapshot(prisma, a.menu.id);
    const b = await createMenuFixture(prisma, 'motions-b', { publish: false });
    await place(b.menu.id, { place: 'signature', motionId: 'soft-glow' });
    await prisma.$transaction((tx) => writeDraftFromSnapshot(tx, b.menu.id, source));

    const copied = await prisma.category.findFirstOrThrow({ where: { menuId: b.menu.id } });
    const rows = await prisma.menuMotion.findMany({ where: { menuId: b.menu.id }, orderBy: { slot: 'asc' } });
    expect(rows.map((row) => [row.slot, row.categoryId, row.motionId])).toEqual([
      [`category:${copied.id}`, copied.id, 'coffee-steam'],
      ['hero', null, 'aurora-background'],
    ]);
  });

  it('deletes a category’s motion with the category', async () => {
    await place(a.menu.id, { place: 'category', categoryId: a.category.id, motionId: 'coffee-steam' });
    await prisma.product.deleteMany({ where: { categoryId: a.category.id } });
    await prisma.category.delete({ where: { id: a.category.id } });
    expect(await prisma.menuMotion.count({ where: { menuId: a.menu.id } })).toBe(0);
  });
});
