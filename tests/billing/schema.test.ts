import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { seedApplications } from '../../prisma/seed/applications';
import { resetTestData, testPrisma } from '../helpers/db';

process.env.DATABASE_URL = databaseUrl(TEST_DB);
const prisma = testPrisma();

const now = new Date('2026-10-22T00:00:00Z');
const later = new Date('2026-11-22T00:00:00Z');

function subscription(restaurantId: string, status: 'TRIAL' | 'ACTIVE' | 'GRACE' | 'EXPIRED' | 'CANCELLED') {
  return {
    restaurantId,
    applicationId: 'menu',
    planCode: 'PRO',
    status,
    period: 'MONTHLY' as const,
    currency: 'IQD' as const,
    priceMinor: 25000,
    currentPeriodStart: now,
    currentPeriodEnd: later,
    version: 1,
  };
}

beforeAll(async () => {
  await resetTestData(prisma);
  await seedApplications(prisma);
});

afterAll(async () => {
  await resetTestData(prisma);
  await prisma.$disconnect();
});

describe('billing tables', () => {
  it('refuses a second live subscription for the same restaurant and application', async () => {
    const restaurant = await prisma.restaurant.create({ data: { name: 'Live twice' } });
    await prisma.subscription.create({ data: subscription(restaurant.id, 'ACTIVE') });
    const error = await prisma.subscription.create({ data: subscription(restaurant.id, 'TRIAL') }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'P2002' });
    expect(JSON.stringify((error as { meta?: unknown }).meta)).toContain('Subscription_live_key');
  });

  it('accepts an expired subscription beside a live one', async () => {
    const restaurant = await prisma.restaurant.create({ data: { name: 'Expired beside live' } });
    await prisma.subscription.create({ data: subscription(restaurant.id, 'ACTIVE') });
    await prisma.subscription.create({ data: subscription(restaurant.id, 'EXPIRED') });
    expect(await prisma.subscription.count({ where: { restaurantId: restaurant.id } })).toBe(2);
  });

  it('leaves exactly two applications however often the seed runs', async () => {
    await seedApplications(prisma);
    await seedApplications(prisma);
    const apps = await prisma.application.findMany({ orderBy: { sortOrder: 'asc' } });
    expect(apps.map((a) => [a.id, a.status])).toEqual([
      ['menu', 'ACTIVE'],
      ['cashier', 'DISABLED'],
    ]);
  });

  it('does not touch a restaurant plan, extras or version', async () => {
    const restaurant = await prisma.restaurant.create({
      data: { name: 'Untouched', plan: 'BASIC', planExtras: { features: { 'design.fontPairs': true } } },
    });
    await prisma.subscription.create({ data: subscription(restaurant.id, 'ACTIVE') });
    const after = await prisma.restaurant.findUniqueOrThrow({ where: { id: restaurant.id } });
    expect(after.plan).toBe('BASIC');
    expect(after.planExtras).toEqual({ features: { 'design.fontPairs': true } });
    expect(after.version).toBe(1);
  });
});
