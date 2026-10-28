import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { introCsv, clickRate } from '@/server/domain/intro-report';
import { introReports } from '@/server/studio/queries/intro-reports';
import { ask, codeOf, dataOf, person, prisma, resetWorld, restaurant, useTestDatabase, type Person } from '../pos/fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));
const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };
let b: { id: string };
let admin: Person;
let ownerA: Person;
let menuA = '';
let menuB = '';
let adAlive = '';
const GONE = 'removed-advert-id';

async function menuOf(restaurantId: string, slug: string) {
  const menu = await prisma().menu.create({ data: { restaurantId, name: slug, slug, currency: 'IQD', locales: ['en'], defaultLocale: 'en', timezone: 'Asia/Baghdad' } });
  await prisma().menuSlug.create({ data: { slug, menuId: menu.id } });
  return menu.id;
}

const day = (advertId: string, menuId: string, restaurantId: string, date: string, views: number, clicks: number) =>
  prisma().platformAdvertDaily.create({ data: { advertId, shownMenuId: menuId, shownRestaurantId: restaurantId, day: date, views, clicks } });

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  await resetWorld();
  a = await restaurant('Report A', 'none');
  b = await restaurant('Report B', 'none');
  menuA = await menuOf(a.id, 'rep-a');
  menuB = await menuOf(b.id, 'rep-b');
  admin = await person('rep-admin', { superAdmin: true });
  ownerA = await person('rep-owner-a', { membership: [a.id, 'OWNER'] });
  const image = await prisma().mediaAsset.create({ data: { restaurantId: null, kind: 'IMAGE', storageKey: 'k/r', contentHash: 'h-r', mime: 'image/png', bytes: 10, storedBytes: 10, variants: { original: 'k/r' } } });
  adAlive = (await prisma().platformAdvert.create({ data: { imageAssetId: image.id, alts: { en: 'Summer sale' }, href: 'https://example.com', restaurantIds: [], menuIds: [] } })).id;
  await day(adAlive, menuA, a.id, '2026-10-01', 100, 10);
  await day(adAlive, menuA, a.id, '2026-10-02', 50, 0);
  await day(adAlive, menuB, b.id, '2026-10-02', 50, 5);
  await day(GONE, menuB, b.id, '2026-10-02', 10, 1);
  await day(adAlive, menuA, a.id, '2026-09-01', 999, 99);
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

const report = async (from = '2026-10-01', to = '2026-10-31') => dataOf(await ask(admin, introReports, { from, to }));

describe('the intro report', () => {
  it('totals the range only, with the click rate', async () => {
    const data = await report();
    expect(data.totals).toEqual({ views: 210, clicks: 16, rate: 16 / 210 });
  });

  it('breaks down by advert, naming one that was removed', async () => {
    const { adverts } = await report();
    expect(adverts.map((row) => [row.label, row.views, row.clicks, row.removed])).toEqual([
      ['Summer sale', 200, 15, false],
      ['', 10, 1, true],
    ]);
  });

  it('breaks down by restaurant and menu, and by day in order', async () => {
    const data = await report();
    expect(data.restaurants.map((row) => [row.name, row.views, row.clicks])).toEqual([['Report A', 150, 10], ['Report B', 60, 6]]);
    expect(data.menus.map((row) => [row.name, row.views])).toEqual([['rep-a', 150], ['rep-b', 60]]);
    expect(data.days).toEqual([{ day: '2026-10-01', views: 100, clicks: 10 }, { day: '2026-10-02', views: 110, clicks: 6 }]);
  });

  it('is empty and not an error for a range with no data', async () => {
    const data = await report('2025-01-01', '2025-01-31');
    expect(data.totals).toEqual({ views: 0, clicks: 0, rate: 0 });
    expect(data.adverts).toEqual([]);
  });

  it('refuses a backwards range, a bad date and a range over a year', async () => {
    for (const range of [['2026-10-31', '2026-10-01'], ['10/01/2026', '2026-10-31'], ['2024-01-01', '2026-10-31']]) {
      expect(codeOf(await ask(admin, introReports, { from: range[0], to: range[1] }))).toBe('INVALID');
    }
  });

  it('is for the Super Admin only', async () => {
    expect(codeOf(await ask(ownerA, introReports, { from: '2026-10-01', to: '2026-10-31' }))).toBe('FORBIDDEN');
  });
});

describe('the csv', () => {
  it('writes a header, quotes what needs it and guards against formulas', () => {
    const csv = introCsv([{ label: '=SUM(A1)', views: 3, clicks: 1 }, { label: 'a, "b"', views: 0, clicks: 0 }]);
    expect(csv.split('\n')).toEqual(["name,views,clicks,click rate", "'=SUM(A1),3,1,33.3%", '"a, ""b""",0,0,0.0%']);
  });

  it('has a click rate of zero when nothing was seen', () => {
    expect(clickRate(0, 0)).toBe(0);
    expect(clickRate(1, 4)).toBe(0.25);
  });
});
