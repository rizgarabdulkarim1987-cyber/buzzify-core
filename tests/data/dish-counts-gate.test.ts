import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { expireMenu } from '@/server/data/cache';
import { resolvePublicMenu } from '@/server/data/public-menu';
import { allows, defaultPlans, effectiveEntitlements } from '@/server/domain/entitlements';
import { guestFeatures } from '@/server/domain/plan-choices';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { createMenuFixture, resetTestData, testPrisma } from '../helpers/db';

process.env.DATABASE_URL = databaseUrl(TEST_DB);
const prisma = testPrisma();

let x: Awaited<ReturnType<typeof createMenuFixture>>;

/** The tenant the guest page would get, with the cached gate dropped first so a change in this test is seen. */
async function tenant() {
  expireMenu(['dish-counts-x'], x.menu.id);
  const result = await resolvePublicMenu('dish-counts-x');
  if (result.kind !== 'live') throw new Error('the fixture menu is not live');
  return result.tenant;
}

beforeEach(async () => {
  await resetTestData(prisma);
  x = await createMenuFixture(prisma, 'dish-counts-x');
  await prisma.restaurant.update({ where: { id: x.restaurant.id }, data: { plan: 'PRO' } });
});

afterAll(async () => {
  await resetTestData(prisma);
  await prisma.$disconnect();
});

describe('the dish counts entitlement', () => {
  it('starts in PRO: BASIC lacks it, and a restaurant extra grants it on BASIC', () => {
    const plans = defaultPlans();
    expect(allows(effectiveEntitlements({ plan: 'PRO', plans, extras: {} }), 'menu.dishCounts')).toBe(true);
    expect(allows(effectiveEntitlements({ plan: 'BASIC', plans, extras: {} }), 'menu.dishCounts')).toBe(false);
    expect(allows(effectiveEntitlements({ plan: 'BASIC', plans, extras: { 'menu.dishCounts': true } }), 'menu.dishCounts')).toBe(true);
    expect(guestFeatures(effectiveEntitlements({ plan: 'PRO', plans, extras: {} })).dishCounts).toBe(true);
  });
});

describe('tenant extras', () => {
  it('shows only when the plan holds the feature and the owner switched it on', async () => {
    expect((await tenant()).extras.dishCounts).toBe(false);
    await prisma.menu.update({ where: { id: x.menu.id }, data: { dishCountsEnabled: true } });
    expect((await tenant()).extras.dishCounts).toBe(true);
  });

  it('is hidden when the grant is removed, and when the owner switches off', async () => {
    await prisma.menu.update({ where: { id: x.menu.id }, data: { dishCountsEnabled: true } });
    await prisma.restaurant.update({ where: { id: x.restaurant.id }, data: { plan: 'BASIC' } });
    expect((await tenant()).extras.dishCounts).toBe(false);
    await prisma.restaurant.update({ where: { id: x.restaurant.id }, data: { planExtras: { features: { 'menu.dishCounts': true } } } });
    expect((await tenant()).extras.dishCounts).toBe(true);
    await prisma.menu.update({ where: { id: x.menu.id }, data: { dishCountsEnabled: false } });
    expect((await tenant()).extras.dishCounts).toBe(false);
  });
});
