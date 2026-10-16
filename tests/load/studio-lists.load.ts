import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { getCatalog, resolvePublicMenu } from '@/server/data/public-menu';
import { snapshotHash } from '@/server/domain/snapshot';
import { loadDraftSnapshot } from '@/server/publish/draft';
import type { Actor } from '@/server/studio/auth/actor';
import { runQuery, type QueryDef } from '@/server/studio/framework/query';
import { listActivity } from '@/server/studio/queries/activity';
import { listMenus } from '@/server/studio/queries/menus';
import { listRestaurants } from '@/server/studio/queries/restaurants';
import { LOAD_UNPUBLISHED_EVERY, loadSlug, seedLoad } from '../../prisma/seed/load';
import { seedDevUsers } from '../../prisma/seed/users';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData, seedAtelier, testPrisma } from '../helpers/db';

/**
 * How fast the Studio's lists are on a platform of 1,000 restaurants with a menu each (and ATELIER besides) and 20,000
 * audit rows: `npm run test:load`. Each case is warmed up twice, then timed 20 times; the 95th percentile has to stay
 * under 300 ms. This measures the queries (admission, filters, counts, the page), not signing in, so it acts as the
 * development Super Admin without loading the account.
 */

const RUNS = 20;
const WARM_UP = 2;
const P95_LIMIT_MS = 300;
const DEV_PASSWORD = 'dev-only-change-me-2026';

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let prisma: PrismaClient;
let admin: Actor;

interface Measured {
  query: string;
  case: string;
  total: number;
  p50: number;
  p95: number;
  max: number;
}
const measured: Measured[] = [];

/** The nearest-rank percentile of sorted samples. */
function percentile(sorted: number[], p: number): number {
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

interface Page {
  total: number;
  rows: unknown[];
}

/** Runs one query as the admin: twice to warm up, then timed. The answer must be a real one, not a refusal timed fast. */
async function measure<I, O extends Page>(query: string, name: string, def: QueryDef<I, O>, input: Record<string, unknown>, expected: { total: number; rows: number }) {
  for (let i = 0; i < WARM_UP; i += 1) {
    const result = await runQuery(prisma, admin, def, input);
    if (!result.ok) throw new Error(`${query} (${name}) was refused: ${JSON.stringify(result.error)}`);
    expect({ total: result.data.total, rows: result.data.rows.length }).toEqual(expected);
  }
  const times: number[] = [];
  for (let i = 0; i < RUNS; i += 1) {
    const started = performance.now();
    const result = await runQuery(prisma, admin, def, input);
    times.push(performance.now() - started);
    expect(result.ok).toBe(true);
  }
  times.sort((a, b) => a - b);
  const row = { query, case: name, total: expected.total, p50: percentile(times, 50), p95: percentile(times, 95), max: times[times.length - 1]! };
  measured.push(row);
  expect(row.p95, `${query} (${name}): p95 ${row.p95.toFixed(1)} ms`).toBeLessThan(P95_LIMIT_MS);
}

beforeAll(async () => {
  requireTestDb();
  // The public read path, used below to check the seeded menus, reads the application's client: point it at the test database.
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
  prisma = testPrisma();
  await resetTestData(prisma);

  // ATELIER and the development users, as `npm run db:seed` leaves them, with the load seed beside them.
  const atelier = await seedAtelier(prisma);
  vi.stubEnv('DEV_SEED_PASSWORD', DEV_PASSWORD);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  await seedDevUsers(prisma, atelier.restaurant.id);
  vi.restoreAllMocks();
  const user = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@buzzify.test' } });
  admin = { userId: user.id, email: user.email, name: user.name, isSuperAdmin: true, twoFactorEnabled: true, locale: 'en', memberships: [] };

  const started = performance.now();
  const seeded = await seedLoad(prisma);
  console.log(
    `[load] Seeded ${seeded.restaurants} restaurants, ${seeded.menus} menus and ${seeded.auditRows} audit rows in ` +
      `${((performance.now() - started) / 1000).toFixed(1)} s`,
  );
});

afterAll(async () => {
  console.log(`\n[load] Query times over ${RUNS} runs after ${WARM_UP} warm-ups (ms; limit ${P95_LIMIT_MS} for p95)`);
  console.table(
    measured.map((m) => ({ query: m.query, case: m.case, total: m.total, p50: +m.p50.toFixed(1), p95: +m.p95.toFixed(1), max: +m.max.toFixed(1) })),
  );
  if (prisma) {
    await resetTestData(prisma);
    await prisma.$disconnect();
  }
  // The public read path's client, if it was used.
  await (globalForPrisma.__prisma as PrismaClient | undefined)?.$disconnect();
  delete globalForPrisma.__prisma;
  vi.unstubAllEnvs();
});

describe('the load seed', () => {
  it('leaves menus that guests open through the normal read path', async () => {
    for (const [n, name] of [
      [1, 'Load Test 0001'],
      [3, 'مطعم مازو'],
      [1000, 'Load Test 1000'],
    ] as const) {
      const resolved = await resolvePublicMenu(loadSlug(n));
      expect(resolved.kind).toBe('live');
      if (resolved.kind !== 'live') continue;
      expect(resolved.tenant).toMatchObject({ name, currency: 'IQD', defaultLocale: 'en', locales: ['en', 'ar', 'ckb'] });
      const catalog = await getCatalog(resolved.tenant);
      expect(catalog.categories).toHaveLength(1);
      expect(catalog.products).toHaveLength(5);
      expect(catalog.products[0]!.translations.ar?.name).toBe('إسبريسو');
    }
  });

  it('stores the revision exactly as a publish would, and marks every tenth menu as changed since', async () => {
    for (const n of [1, 9, 10, 500, 1000]) {
      const menu = await prisma.menu.findUniqueOrThrow({ where: { slug: loadSlug(n) } });
      expect(menu.status).toBe('PUBLISHED');
      expect(menu.liveHash).toBe(snapshotHash(await loadDraftSnapshot(prisma, menu.id)));
      expect(menu.draftHash !== menu.liveHash).toBe(n % LOAD_UNPUBLISHED_EVERY === 0);
    }
  });
});

describe('Menus', () => {
  const cases: Array<[string, Record<string, unknown>, { total: number; rows: number }]> = [
    ['no filter', {}, { total: 1001, rows: 50 }],
    ['search "load-07"', { q: 'load-07' }, { total: 100, rows: 50 }],
    ['search an Arabic name', { q: 'مازو' }, { total: 1, rows: 1 }],
    ['status PUBLISHED', { status: 'PUBLISHED' }, { total: 1001, rows: 50 }],
    ['city Duhok', { city: 'Duhok' }, { total: 125, rows: 50 }],
    ['unpublished changes', { unpublished: true }, { total: 100, rows: 50 }],
    ['sort by restaurant, page 10', { sort: 'restaurant', page: 10 }, { total: 1001, rows: 50 }],
  ];
  it.each(cases)('%s', async (name, input, expected) => {
    await measure('menus.list', name, listMenus, input, expected);
  });
});

describe('Restaurants', () => {
  // The list has no "published" state to filter by and no sort by restaurant, so these stand in: the status a restaurant
  // has, its type, and its city.
  const cases: Array<[string, Record<string, unknown>, { total: number; rows: number }]> = [
    ['no filter', {}, { total: 1001, rows: 50 }],
    ['search "Load Test 07"', { q: 'Load Test 07' }, { total: 100, rows: 50 }],
    ['search an Arabic name', { q: 'مقهى الربيع' }, { total: 1, rows: 1 }],
    ['status ACTIVE', { status: 'ACTIVE' }, { total: 1001, rows: 50 }],
    ['city Duhok', { city: 'Duhok' }, { total: 125, rows: 50 }],
    ['type CAFE', { type: 'CAFE' }, { total: 501, rows: 50 }],
    ['sort by city, page 10', { sort: 'city', page: 10 }, { total: 1001, rows: 50 }],
  ];
  it.each(cases)('%s', async (name, input, expected) => {
    await measure('restaurants.list', name, listRestaurants, input, expected);
  });
});

describe('Activity', () => {
  it('no filter', async () => {
    await measure('activity.list', 'no filter', listActivity, {}, { total: 20_000, rows: 50 });
  });

  it('one menu', async () => {
    const menu = await prisma.menu.findUniqueOrThrow({ where: { slug: loadSlug(1) }, select: { id: true } });
    // The 16 of its 20 rows that are about the menu; the other four are about its restaurant.
    await measure('activity.list', 'menu filter', listActivity, { menuId: menu.id }, { total: 16, rows: 16 });
  });

  it('one kind of change', async () => {
    await measure('activity.list', 'action filter', listActivity, { action: 'menu.published' }, { total: 8000, rows: 50 });
  });

  it('page 100', async () => {
    await measure('activity.list', 'page 100', listActivity, { page: 100 }, { total: 20_000, rows: 50 });
  });
});
