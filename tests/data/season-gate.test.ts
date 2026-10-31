import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { expireMenu } from '@/server/data/cache';
import { resolvePublicMenu } from '@/server/data/public-menu';
import { guestSeason, isSeasonEffect, SEASON_EFFECTS } from '@/server/domain/seasons';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { createMenuFixture, resetTestData, testPrisma } from '../helpers/db';

process.env.DATABASE_URL = databaseUrl(TEST_DB);
const prisma = testPrisma();

let x: Awaited<ReturnType<typeof createMenuFixture>>;

/** The tenant the guest page would get, with the cached gate dropped first so a change in this test is seen. */
async function tenant() {
  expireMenu(['season-x'], x.menu.id);
  const result = await resolvePublicMenu('season-x');
  if (result.kind !== 'live') throw new Error('the fixture menu is not live');
  return result.tenant;
}

beforeEach(async () => {
  await resetTestData(prisma);
  x = await createMenuFixture(prisma, 'season-x');
  await prisma.restaurant.update({ where: { id: x.restaurant.id }, data: { plan: 'PRO' } });
});

afterAll(async () => {
  await resetTestData(prisma);
  await prisma.$disconnect();
});

describe('which effect guests get', () => {
  it('knows five effects and refuses anything else', () => {
    expect(SEASON_EFFECTS).toHaveLength(5);
    expect(isSeasonEffect('snow')).toBe(true);
    expect(isSeasonEffect('rain')).toBe(false);
    expect(isSeasonEffect(null)).toBe(false);
  });

  it('is the stored effect only when the plan allows it', () => {
    expect(guestSeason('leaves', true)).toBe('leaves');
    expect(guestSeason('leaves', false)).toBeNull();
    expect(guestSeason('rain', true)).toBeNull();
    expect(guestSeason(null, true)).toBeNull();
  });
});

describe('tenant extras', () => {
  it('has no effect until the owner chooses one, then follows the choice', async () => {
    expect((await tenant()).extras.season).toBeUndefined();
    await prisma.menu.update({ where: { id: x.menu.id }, data: { seasonEffect: 'snow' } });
    expect((await tenant()).extras.season).toBe('snow');
    await prisma.menu.update({ where: { id: x.menu.id }, data: { seasonEffect: null } });
    expect((await tenant()).extras.season).toBeUndefined();
  });

  it('is ignored on a plan without the feature, and comes back with it', async () => {
    await prisma.menu.update({ where: { id: x.menu.id }, data: { seasonEffect: 'petals' } });
    await prisma.restaurant.update({ where: { id: x.restaurant.id }, data: { plan: 'BASIC' } });
    expect((await tenant()).extras.season).toBeUndefined();
    await prisma.restaurant.update({ where: { id: x.restaurant.id }, data: { plan: 'PRO' } });
    expect((await tenant()).extras.season).toBe('petals');
  });

  it('the database refuses an effect it does not know', async () => {
    await expect(prisma.menu.update({ where: { id: x.menu.id }, data: { seasonEffect: 'rain' } })).rejects.toThrow();
  });
});
