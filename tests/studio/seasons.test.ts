import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setSeasonEffect } from '@/server/studio/actions/seasons';
import { designState } from '@/server/studio/services/design';
import { upgradeInfo } from '@/server/studio/services/plans';
import { effectiveEntitlements, defaultPlans } from '@/server/domain/entitlements';
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
const stored = async (id = menuId) => (await prisma().menu.findUniqueOrThrow({ where: { id } })).seasonEffect;

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  await resetWorld();
  a = await restaurant('Season A', 'none');
  b = await restaurant('Season B', 'none');
  await prisma().restaurant.update({ where: { id: a.id }, data: { plan: 'PRO' } });
  menuId = await menuOf(a.id, 'season-a');
  otherMenuId = await menuOf(b.id, 'season-b');
  owner = await person('season-owner', { membership: [a.id, 'DESIGNER'] });
  stranger = await person('season-stranger', { membership: [b.id, 'DESIGNER'] });
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

describe('the seasonal effect', () => {
  it('is chosen, changed and cleared, with each change audited', async () => {
    expect(dataOf(await run(owner, setSeasonEffect, { menuId, effect: 'snow' }))).toEqual({ effect: 'snow' });
    expect(await stored()).toBe('snow');
    expect(dataOf(await run(owner, setSeasonEffect, { menuId, effect: 'snow' }))).toEqual({ effect: 'snow' });
    expect(await prisma().auditLog.count({ where: { action: 'menu.season_changed' } })).toBe(1);
    dataOf(await run(owner, setSeasonEffect, { menuId, effect: 'leaves' }));
    dataOf(await run(owner, setSeasonEffect, { menuId, effect: null }));
    expect(await stored()).toBeNull();
    expect(await prisma().auditLog.count({ where: { action: 'menu.season_changed' } })).toBe(3);
  });

  it('refuses an effect that does not exist', async () => {
    expect(codeOf(await run(owner, setSeasonEffect, { menuId, effect: 'rain' }))).toBe('INVALID');
    expect(await stored()).toBeNull();
  });

  it('needs the plan feature to choose one, but never to clear one', async () => {
    dataOf(await run(owner, setSeasonEffect, { menuId, effect: 'sparks' }));
    await prisma().restaurant.update({ where: { id: a.id }, data: { plan: 'BASIC' } });
    expect(codeOf(await run(owner, setSeasonEffect, { menuId, effect: 'snow' }))).toBe('UPGRADE_REQUIRED');
    expect(await stored()).toBe('sparks');
    dataOf(await run(owner, setSeasonEffect, { menuId, effect: null }));
    expect(await stored()).toBeNull();
  });

  it("refuses another restaurant's menu", async () => {
    expect(codeOf(await run(stranger, setSeasonEffect, { menuId, effect: 'snow' }))).not.toBe('OK');
    expect(await stored()).toBeNull();
    expect(codeOf(await run(owner, setSeasonEffect, { menuId: otherMenuId, effect: 'snow' }))).not.toBe('OK');
    expect(await stored(otherMenuId)).toBeNull();
  });

  it('shows in the Design tab with whether the plan has it', async () => {
    dataOf(await run(owner, setSeasonEffect, { menuId, effect: 'confetti' }));
    const plans = defaultPlans();
    const pro = { entitlements: effectiveEntitlements({ plan: 'PRO', plans, extras: {} }), upgrade: {} as Awaited<ReturnType<typeof upgradeInfo>> };
    const view = await designState(prisma(), menuId, a.id, false, pro);
    expect(view.season).toBe('confetti');
    expect(view.plan.seasonalParticles).toBe(true);
    const basic = { entitlements: effectiveEntitlements({ plan: 'BASIC', plans, extras: {} }), upgrade: pro.upgrade };
    expect((await designState(prisma(), menuId, a.id, false, basic)).plan.seasonalParticles).toBe(false);
  });
});
