import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTenant, resolvePublicMenu } from '@/server/data/public-menu';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { createMenuFixture, resetTestData, testPrisma } from '../helpers/db';

// Production runs more than one server process, and a cache expiry made in one (the Studio action) does not reach the
// others, which keep serving their cached answer for a slug for minutes. This holds every slug's first answer for good,
// as such a process would, so the tests show what a guest gets from a stale answer.
const stale = vi.hoisted(() => new Map<string, unknown>());
vi.mock('@/server/data/cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/data/cache')>();
  return {
    ...actual,
    cachedSlugResolution: async <T,>(slug: string, load: () => Promise<T>): Promise<T> => {
      if (!stale.has(slug)) stale.set(slug, await load());
      return stale.get(slug) as T;
    },
  };
});

process.env.DATABASE_URL = databaseUrl(TEST_DB);
const prisma = testPrisma();
const DAY = 86_400_000;

describe('public menu behind a stale cached answer', () => {
  let a: Awaited<ReturnType<typeof createMenuFixture>>;

  beforeEach(async () => {
    stale.clear();
    await resetTestData(prisma);
    a = await createMenuFixture(prisma, 'stale-a');
    await prisma.application.create({ data: { id: 'menu', name: { en: 'Menu' } } });
  });

  afterAll(async () => {
    await resetTestData(prisma);
    await prisma.$disconnect();
  });

  const subscribe = (status: 'ACTIVE' | 'CANCELLED') =>
    prisma.subscription.create({
      data: {
        restaurantId: a.restaurant.id,
        applicationId: 'menu',
        planCode: 'pro',
        status,
        period: 'MONTHLY',
        currency: 'IQD',
        priceMinor: 0,
        currentPeriodStart: new Date(Date.now() - 5 * DAY),
        currentPeriodEnd: new Date(Date.now() + 25 * DAY),
        version: 1,
      },
    });

  it('closes at once when the Menu subscription is cancelled after the menu was cached open', async () => {
    const sub = await subscribe('ACTIVE');
    expect(await resolvePublicMenu('stale-a')).toMatchObject({ kind: 'live' });

    await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'CANCELLED' } });
    expect(await resolvePublicMenu('stale-a')).toEqual({ kind: 'unavailable', menuId: a.menu.id, name: 'Restaurant stale-a', defaultLocale: 'en', locales: ['en', 'ar', 'ckb'] });
    expect(await getTenant('stale-a')).toBeNull();
  });

  it('reopens at once when the Menu subscription is reactivated after the menu was cached closed', async () => {
    const sub = await subscribe('CANCELLED');
    expect(await resolvePublicMenu('stale-a')).toMatchObject({ kind: 'unavailable' });

    await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'ACTIVE' } });
    expect(await resolvePublicMenu('stale-a')).toMatchObject({ kind: 'live', tenant: { id: a.menu.id } });
    expect(await getTenant('stale-a')).toMatchObject({ id: a.menu.id });
  });

  it('follows a suspended and restored menu at once', async () => {
    expect(await resolvePublicMenu('stale-a')).toMatchObject({ kind: 'live' });
    await prisma.menu.update({ where: { id: a.menu.id }, data: { status: 'SUSPENDED' } });
    expect(await resolvePublicMenu('stale-a')).toMatchObject({ kind: 'unavailable' });

    stale.clear();
    expect(await resolvePublicMenu('stale-a')).toMatchObject({ kind: 'unavailable' });
    await prisma.menu.update({ where: { id: a.menu.id }, data: { status: 'PUBLISHED' } });
    expect(await resolvePublicMenu('stale-a')).toMatchObject({ kind: 'live' });
  });
});
