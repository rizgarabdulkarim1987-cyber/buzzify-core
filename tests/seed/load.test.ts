import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { getCatalog, resolvePublicMenu } from '@/server/data/public-menu';
import { snapshotHash } from '@/server/domain/snapshot';
import { loadDraftSnapshot } from '@/server/publish/draft';
import { LOAD_CITIES, loadSlug, seedLoad } from '../../prisma/seed/load';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { createMenuFixture, resetTestData, testPrisma } from '../helpers/db';

// The public read path uses the app's client; point it at the test database.
process.env.DATABASE_URL = databaseUrl(TEST_DB);

// Fifty-five is more than one batch (the seed writes fifty menus to a transaction), so a batch boundary is crossed.
const COUNT = 55;

let prisma: PrismaClient;

beforeAll(() => {
  prisma = testPrisma();
});

beforeEach(async () => {
  await resetTestData(prisma);
});

afterAll(async () => {
  await resetTestData(prisma);
  await prisma.$disconnect();
});

/** The row counts a run leaves behind, to compare one run with the next. */
async function counts() {
  return {
    restaurants: await prisma.restaurant.count(),
    menus: await prisma.menu.count(),
    slugs: await prisma.menuSlug.count(),
    revisions: await prisma.menuRevision.count(),
    brands: await prisma.brandConfig.count(),
    categories: await prisma.category.count(),
    products: await prisma.product.count(),
    audit: await prisma.auditLog.count(),
  };
}

describe('seedLoad', () => {
  it('seeds restaurants with one published menu each, in three languages', async () => {
    const seeded = await seedLoad(prisma, COUNT);

    expect(seeded).toEqual({ restaurants: COUNT, menus: COUNT, auditRows: COUNT * 20 });
    expect(await counts()).toEqual({
      restaurants: COUNT,
      menus: COUNT,
      slugs: COUNT,
      revisions: COUNT,
      brands: COUNT,
      categories: COUNT,
      products: COUNT * 5,
      audit: COUNT * 20,
    });

    const first = await prisma.restaurant.findFirstOrThrow({ where: { name: 'Load Test 0001' }, include: { menus: true } });
    expect(first).toMatchObject({ type: 'RESTAURANT', city: LOAD_CITIES[0], country: 'Iraq' });
    expect(first.menus).toEqual([expect.objectContaining({ slug: 'load-0001', status: 'PUBLISHED' })]);
    expect(await prisma.restaurant.findFirstOrThrow({ where: { name: 'Load Test 0002' } })).toMatchObject({ type: 'CAFE', city: LOAD_CITIES[1] });
    expect(new Set((await prisma.restaurant.findMany()).map((r) => r.city))).toEqual(new Set(LOAD_CITIES));
  });

  it('gives two restaurants Arabic names, for the search tests', async () => {
    await seedLoad(prisma, COUNT);
    const names = (await prisma.restaurant.findMany({ where: { name: { not: { startsWith: 'Load Test' } } } })).map((r) => r.name);
    expect(names.sort()).toEqual(['مطعم مازو', 'مقهى الربيع'].sort());
    expect(await prisma.menu.count({ where: { name: { in: ['مطعم مازو', 'مقهى الربيع'] } } })).toBe(2);
  });

  it('publishes a menu the way a guest can open it, with the hash a publish would store', async () => {
    await seedLoad(prisma, COUNT);
    for (const n of [1, 3, 50, 51, COUNT]) {
      const menu = await prisma.menu.findUniqueOrThrow({ where: { slug: loadSlug(n) }, include: { liveRevision: true } });
      expect(menu.liveRevision?.number).toBe(1);
      expect(menu.liveHash).toBe(menu.liveRevision?.snapshotHash);
      expect(menu.liveHash).toBe(snapshotHash(await loadDraftSnapshot(prisma, menu.id)));

      const resolved = await resolvePublicMenu(loadSlug(n));
      expect(resolved.kind).toBe('live');
      if (resolved.kind !== 'live') continue;
      const catalog = await getCatalog(resolved.tenant);
      expect(catalog.products.map((p) => p.slug)).toEqual(['espresso', 'latte', 'black-tea', 'croissant', 'cheesecake']);
    }
  });

  it('marks every tenth menu as changed since it was published', async () => {
    await seedLoad(prisma, COUNT);
    const menus = await prisma.menu.findMany({ select: { slug: true, liveHash: true, draftHash: true } });
    const changed = menus.filter((m) => m.draftHash !== m.liveHash).map((m) => m.slug);
    expect(changed.sort()).toEqual(['load-0010', 'load-0020', 'load-0030', 'load-0040', 'load-0050']);
  });

  it('can run again: what it made is replaced, not added to', async () => {
    await seedLoad(prisma, COUNT);
    const before = await counts();

    await seedLoad(prisma, COUNT);

    expect(await counts()).toEqual(before);
  });

  it('leaves other restaurants and menus alone, and removes only its own', async () => {
    const other = await createMenuFixture(prisma, 'cafe-one');
    await seedLoad(prisma, COUNT);
    await seedLoad(prisma, 10);

    expect(await prisma.restaurant.count()).toBe(11);
    expect(await prisma.menu.count()).toBe(11);
    expect(await prisma.menu.findUnique({ where: { id: other.menu.id } })).not.toBeNull();
    expect(await prisma.menuSlug.count({ where: { slug: { startsWith: 'load-' } } })).toBe(10);
  });
});
