import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setMenuDishCountsEnabled } from '@/server/studio/actions/dish-counts';
import { salesSettingsView } from '@/server/studio/services/sales';
import { codeOf, dataOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from '../pos/fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };
let b: { id: string };
let menuId = '';
let otherMenuId = '';
let owner: Person;
let stranger: Person;

async function menuOf(restaurantId: string, slug: string) {
  const menu = await prisma().menu.create({ data: { restaurantId, name: slug, slug, currency: 'IQD', locales: ['en', 'ar'], defaultLocale: 'en', timezone: 'Asia/Baghdad' } });
  await prisma().menuSlug.create({ data: { slug, menuId: menu.id } });
  return menu.id;
}

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  await resetWorld();
  a = await restaurant('Counts A', 'none');
  b = await restaurant('Counts B', 'none');
  await prisma().restaurant.update({ where: { id: a.id }, data: { plan: 'PRO' } });
  menuId = await menuOf(a.id, 'counts-a');
  otherMenuId = await menuOf(b.id, 'counts-b');
  owner = await person('counts-owner', { membership: [a.id, 'OWNER'] });
  stranger = await person('counts-stranger', { membership: [b.id, 'OWNER'] });
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

describe('the dish counts switch', () => {
  it('lets the owner switch it on and off, and audits the change', async () => {
    expect(dataOf(await run(owner, setMenuDishCountsEnabled, { menuId, enabled: true }))).toEqual({ enabled: true });
    expect((await prisma().menu.findUniqueOrThrow({ where: { id: menuId } })).dishCountsEnabled).toBe(true);
    expect(await prisma().auditLog.count({ where: { action: 'menu.dish_counts_changed' } })).toBe(1);
    expect(dataOf(await run(owner, setMenuDishCountsEnabled, { menuId, enabled: false }))).toEqual({ enabled: false });
    expect((await prisma().menu.findUniqueOrThrow({ where: { id: menuId } })).dishCountsEnabled).toBe(false);
  });

  it('is refused without the grant, and a Super Admin extra opens it for one restaurant', async () => {
    await prisma().restaurant.update({ where: { id: a.id }, data: { plan: 'BASIC' } });
    expect(codeOf(await run(owner, setMenuDishCountsEnabled, { menuId, enabled: true }))).toBe('UPGRADE_REQUIRED');
    await prisma().restaurant.update({ where: { id: a.id }, data: { planExtras: { features: { 'menu.dishCounts': true } } } });
    expect(dataOf(await run(owner, setMenuDishCountsEnabled, { menuId, enabled: true }))).toEqual({ enabled: true });
  });

  it("refuses another restaurant's menu", async () => {
    expect(codeOf(await run(stranger, setMenuDishCountsEnabled, { menuId, enabled: true }))).not.toBe('OK');
    expect((await prisma().menu.findUniqueOrThrow({ where: { id: menuId } })).dishCountsEnabled).toBe(false);
    expect(codeOf(await run(owner, setMenuDishCountsEnabled, { menuId: otherMenuId, enabled: true }))).not.toBe('OK');
    expect((await prisma().menu.findUniqueOrThrow({ where: { id: otherMenuId } })).dishCountsEnabled).toBe(false);
  });

  it("shows in the Sales settings view as the menu's current switch", async () => {
    expect((await salesSettingsView(prisma(), menuId)).dishCountsEnabled).toBe(false);
    dataOf(await run(owner, setMenuDishCountsEnabled, { menuId, enabled: true }));
    expect((await salesSettingsView(prisma(), menuId)).dishCountsEnabled).toBe(true);
  });
});
