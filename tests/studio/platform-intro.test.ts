import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { deletePlatformAdvert, reorderPlatformAdverts, savePlatformAdvert, savePlatformIntroDefault } from '@/server/studio/actions/platform-intro';
import { menuIntro } from '@/server/studio/queries/intro';
import { platformIntro } from '@/server/studio/queries/platform-intro';
import { ask, codeOf, dataOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from '../pos/fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));
const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };
let b: { id: string };
let admin: Person;
let ownerA: Person;
let ownerB: Person;
let menuA = '';
let menuB = '';
let shared = '';
let own = '';

async function menuOf(restaurantId: string, slug: string) {
  const menu = await prisma().menu.create({ data: { restaurantId, name: slug, slug, currency: 'IQD', locales: ['en'], defaultLocale: 'en', timezone: 'Asia/Baghdad' } });
  await prisma().menuSlug.create({ data: { slug, menuId: menu.id } });
  return menu.id;
}

const image = (restaurantId: string | null, label: string) =>
  prisma().mediaAsset.create({ data: { restaurantId, kind: 'IMAGE', storageKey: `k/${label}`, contentHash: `h-${label}`, mime: 'image/png', bytes: 10, storedBytes: 10, variants: { original: `k/${label}` } } }).then((row) => row.id);

const advert = (over: Record<string, unknown> = {}) => ({ imageAssetId: shared, alts: { en: 'Sale' }, href: 'https://example.com', startsAt: null, endsAt: null, active: true, restaurantIds: [], ...over });

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  await resetWorld();
  a = await restaurant('Platform A', 'none');
  b = await restaurant('Platform B', 'none');
  menuA = await menuOf(a.id, 'plat-a');
  menuB = await menuOf(b.id, 'plat-b');
  admin = await person('plat-admin', { superAdmin: true });
  ownerA = await person('plat-owner-a', { membership: [a.id, 'OWNER'] });
  ownerB = await person('plat-owner-b', { membership: [b.id, 'OWNER'] });
  shared = await image(null, 'shared');
  own = await image(a.id, 'own');
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

describe('the platform intro', () => {
  it('is for Super Admins only', async () => {
    expect(codeOf(await run(ownerA, savePlatformAdvert, advert()))).toBe('FORBIDDEN');
    expect(codeOf(await run(ownerA, savePlatformIntroDefault, { backgroundAssetId: shared }))).toBe('FORBIDDEN');
    expect(codeOf(await ask(ownerA, platformIntro, {}))).toBe('FORBIDDEN');
    expect(await prisma().platformAdvert.count()).toBe(0);
  });

  it("takes a shared picture as the default background and refuses a restaurant's own", async () => {
    dataOf(await run(admin, savePlatformIntroDefault, { backgroundAssetId: shared }));
    expect(dataOf(await ask(admin, platformIntro, {})).backgroundAssetId).toBe(shared);
    expect(codeOf(await run(admin, savePlatformIntroDefault, { backgroundAssetId: own }))).toBe('NOT_FOUND');
    expect(codeOf(await run(admin, savePlatformAdvert, advert({ imageAssetId: own })))).toBe('NOT_FOUND');
  });

  it('shows an advert for two restaurants in both and in no third, and everyone sees one for all', async () => {
    dataOf(await run(admin, savePlatformAdvert, advert({ restaurantIds: [a.id] })));
    dataOf(await run(admin, savePlatformAdvert, advert({ restaurantIds: [] })));
    expect(dataOf(await ask(ownerA, menuIntro, { menuId: menuA })).platformAdverts).toHaveLength(2);
    expect(dataOf(await ask(ownerB, menuIntro, { menuId: menuB })).platformAdverts).toHaveLength(1);
  });

  it('refuses a restaurant that does not exist, a bad link and a backwards window', async () => {
    expect(codeOf(await run(admin, savePlatformAdvert, advert({ restaurantIds: ['ghost'] })))).toBe('INVALID');
    expect(codeOf(await run(admin, savePlatformAdvert, advert({ href: 'javascript:1' })))).toBe('INVALID');
    expect(codeOf(await run(admin, savePlatformAdvert, advert({ startsAt: '2026-11-02T00:00:00Z', endsAt: '2026-11-01T00:00:00Z' })))).toBe('INVALID');
  });

  it('orders and deletes adverts, and deleting removes it from every restaurant', async () => {
    const first = dataOf(await run(admin, savePlatformAdvert, advert())).advertId;
    const second = dataOf(await run(admin, savePlatformAdvert, advert())).advertId;
    dataOf(await run(admin, reorderPlatformAdverts, { ids: [second, first] }));
    expect(dataOf(await ask(admin, platformIntro, {})).adverts.map((x) => x.id)).toEqual([second, first]);
    dataOf(await run(admin, deletePlatformAdvert, { advertId: first }));
    expect(dataOf(await ask(ownerA, menuIntro, { menuId: menuA })).platformAdverts.map((x) => x.id)).toEqual([second]);
    expect(codeOf(await run(admin, deletePlatformAdvert, { advertId: first }))).toBe('NOT_FOUND');
  });
});
