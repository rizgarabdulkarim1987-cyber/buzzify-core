import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveWheel, setMenuWheelEnabled } from '@/server/studio/actions/wheel';
import { menuWheel } from '@/server/studio/queries/wheel';
import { ask, codeOf, dataOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from '../pos/fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };
let b: { id: string };
let menuId = '';
let otherMenuId = '';
let owner: Person;
let photo = '';
let dishes: string[] = [];
let bare = '';
let foreignDish = '';

async function menuOf(restaurantId: string, slug: string) {
  const menu = await prisma().menu.create({ data: { restaurantId, name: slug, slug, currency: 'IQD', locales: ['en', 'ar'], defaultLocale: 'en', timezone: 'Asia/Baghdad' } });
  await prisma().menuSlug.create({ data: { slug, menuId: menu.id } });
  return menu.id;
}

async function dish(menu: string, slug: string, media: unknown[]) {
  const category = await prisma().category.create({ data: { menuId: menu, slug: `c-${slug}`, translations: { en: { name: 'Food' } } } });
  return (await prisma().product.create({ data: { menuId: menu, categoryId: category.id, slug, basePrice: 1000, translations: { en: { name: slug } }, media: media as never } })).id;
}

const wheel = (over: Record<string, unknown> = {}) => ({
  menuId,
  spinsPerDay: 1,
  startsAt: null,
  endsAt: null,
  title: { en: 'Spin and win' },
  slices: dishes.slice(0, 6).map((productId, index) => ({ productId, label: index === 0 ? { en: '10% off' } : {}, weight: 1 })),
  ...over,
});

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  await resetWorld();
  a = await restaurant('Wheel A', 'none');
  b = await restaurant('Wheel B', 'none');
  menuId = await menuOf(a.id, 'wheel-a');
  otherMenuId = await menuOf(b.id, 'wheel-b');
  owner = await person('wheel-owner', { membership: [a.id, 'OWNER'] });
  photo = (
    await prisma().mediaAsset.create({
      data: { restaurantId: a.id, kind: 'IMAGE', storageKey: 'k/p', contentHash: 'h-p', mime: 'image/png', bytes: 10, storedBytes: 10, width: 100, height: 100, variants: { original: 'k/p' } },
    })
  ).id;
  dishes = [];
  for (let n = 0; n < 13; n++) dishes.push(await dish(menuId, `d${n}`, [{ kind: 'asset', assetId: photo }]));
  bare = await dish(menuId, 'bare', [{ kind: 'art', art: 'plate', tone: '#fff' }]);
  foreignDish = await dish(otherMenuId, 'kebab', [{ kind: 'asset', assetId: photo }]);
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

describe('saving the wheel', () => {
  it('saves 6 slices, turns on, and the owner reads it back with candidates', async () => {
    dataOf(await run(owner, saveWheel, wheel()));
    dataOf(await run(owner, setMenuWheelEnabled, { menuId, enabled: true }));
    const read = dataOf(await ask(owner, menuWheel, { menuId }));
    expect(read.enabled).toBe(true);
    expect(read.slices).toHaveLength(6);
    expect(read.slices[0]).toMatchObject({ productId: dishes[0], label: { en: '10% off' }, weight: 1 });
    expect(read.candidates.map((c) => c.id)).not.toContain(bare);
    expect(read.candidates.map((c) => c.id)).toContain(dishes[12]);
  });

  it('replaces the slices on a second save', async () => {
    dataOf(await run(owner, saveWheel, wheel()));
    dataOf(await run(owner, saveWheel, wheel({ slices: dishes.slice(6, 10).map((productId) => ({ productId, label: {}, weight: 5 })) })));
    const rows = await prisma().wheelSlice.findMany({ orderBy: { sortOrder: 'asc' } });
    expect(rows.map((r) => r.productId)).toEqual(dishes.slice(6, 10));
    expect(rows.every((r) => r.weight === 5)).toBe(true);
  });

  it('refuses 3 or 13 slices', async () => {
    expect(codeOf(await run(owner, saveWheel, wheel({ slices: wheel().slices.slice(0, 3) })))).toBe('INVALID');
    expect(codeOf(await run(owner, saveWheel, wheel({ slices: dishes.slice(0, 13).map((productId) => ({ productId, label: {}, weight: 1 })) })))).toBe('INVALID');
    expect(await prisma().wheelSlice.count()).toBe(0);
  });

  it('refuses a duplicate dish, another menu dish and a dish with no photo', async () => {
    const four = dishes.slice(0, 4).map((productId) => ({ productId, label: {}, weight: 1 }));
    expect(codeOf(await run(owner, saveWheel, wheel({ slices: [...four.slice(0, 3), four[0]] })))).toBe('INVALID');
    expect(codeOf(await run(owner, saveWheel, wheel({ slices: [...four.slice(0, 3), { productId: foreignDish, label: {}, weight: 1 }] })))).toBe('NOT_FOUND');
    expect(codeOf(await run(owner, saveWheel, wheel({ slices: [...four.slice(0, 3), { productId: bare, label: {}, weight: 1 }] })))).toBe('INVALID');
    expect(await prisma().menuWheel.count()).toBe(0);
  });

  it('refuses weight 0 or 101, spinsPerDay out of range and a window that ends before it starts', async () => {
    const withWeight = (weight: number) => dishes.slice(0, 4).map((productId) => ({ productId, label: {}, weight }));
    expect(codeOf(await run(owner, saveWheel, wheel({ slices: withWeight(0) })))).toBe('INVALID');
    expect(codeOf(await run(owner, saveWheel, wheel({ slices: withWeight(101) })))).toBe('INVALID');
    expect(codeOf(await run(owner, saveWheel, wheel({ spinsPerDay: 0 })))).toBe('INVALID');
    expect(codeOf(await run(owner, saveWheel, wheel({ spinsPerDay: 11 })))).toBe('INVALID');
    expect(codeOf(await run(owner, saveWheel, wheel({ startsAt: '2026-11-02T00:00:00Z', endsAt: '2026-11-01T00:00:00Z' })))).toBe('INVALID');
  });

  it('turning it on without a saved wheel is refused', async () => {
    expect(codeOf(await run(owner, setMenuWheelEnabled, { menuId, enabled: true }))).toBe('INVALID');
  });

  it('needs the plan feature', async () => {
    dataOf(await run(owner, saveWheel, wheel()));
    await prisma().restaurant.update({ where: { id: a.id }, data: { plan: 'BASIC' } });
    expect(codeOf(await run(owner, setMenuWheelEnabled, { menuId, enabled: true }))).toBe('UPGRADE_REQUIRED');
  });
});
