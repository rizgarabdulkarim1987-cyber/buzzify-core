import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { posGate, resolvePosActor } from '@/server/pos/actor';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runQuery, type QueryDef } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import { listMenus } from '@/server/studio/queries/menus';
import { posOverview } from '@/server/studio/queries/pos';
import { person, pharmacy, prisma, resetWorld, useTestDatabase, NOW } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

beforeAll(() => useTestDatabase());
beforeEach(resetWorld);
afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

const ask = async <I, O>(who: { userId: string }, def: QueryDef<I, O>, input: unknown = {}): Promise<ActionResult<O>> => {
  const actor = (await loadActor(prisma(), who.userId)) as Actor;
  return runQuery(prisma(), actor, def, input);
};
const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  return result.data;
};

/** A cashier subscription on a restaurant, live from NOW's own clock. */
async function subscribeCashier(restaurantId: string): Promise<void> {
  const now = Date.now();
  await prisma().subscription.create({
    data: {
      restaurantId,
      applicationId: 'cashier',
      planCode: 'standard',
      status: 'ACTIVE',
      period: 'MONTHLY',
      currency: 'IQD',
      priceMinor: 0,
      currentPeriodStart: new Date(now - 5 * 86_400_000),
      currentPeriodEnd: new Date(now + 25 * 86_400_000),
      version: 1,
    },
  });
}

describe('a pharmacy business and the till', () => {
  it('a pharmacy business has no till actor even for an owner', async () => {
    const ph = await pharmacy('Ph One');
    const owner = await person('till-owner', { membership: [ph.id, 'OWNER'] });
    const cashier = await person('till-cashier', { posStaff: [ph.id, 'CASHIER'] });
    expect(await resolvePosActor(prisma(), owner.userId, ph.id)).toBeNull();
    expect(await resolvePosActor(prisma(), owner.userId)).toBeNull();
    expect(await resolvePosActor(prisma(), cashier.userId, ph.id)).toBeNull();
    // Even a live cashier subscription does not open a pharmacy's till.
    await subscribeCashier(ph.id);
    expect(await posGate(prisma(), ph.id, NOW)).toEqual({ open: false, reason: 'restaurantInactive' });
  });

  it('a person of a pharmacy and a FOOD restaurant keeps the FOOD till', async () => {
    const ph = await pharmacy('Ph Two');
    const food = await pharmacy('Food Two', { sector: 'FOOD' });
    await subscribeCashier(food.id);
    const both = await person('till-both', { membership: [ph.id, 'OWNER'] });
    await prisma().membership.create({ data: { userId: both.userId, restaurantId: food.id, role: 'OWNER' } });
    expect(await resolvePosActor(prisma(), both.userId)).toMatchObject({ restaurantId: food.id, role: 'OWNER' });
    expect(await resolvePosActor(prisma(), both.userId, ph.id)).toBeNull();
    expect((await posGate(prisma(), food.id, NOW)).open).toBe(true);
  });
});

describe('a pharmacy business in the Studio lists', () => {
  it("a pharmacy business does not appear in the Studio's menus list or the cashier overview", async () => {
    const ph = await pharmacy('Ph Three');
    const food = await pharmacy('Food Three', { sector: 'FOOD' });
    await subscribeCashier(ph.id);
    await subscribeCashier(food.id);
    const admin = await person('sep-admin', { superAdmin: true });
    await person('sep-ph-cashier', { posStaff: [ph.id, 'CASHIER'] });
    for (const [restaurantId, slug] of [
      [ph.id, 'ph-three-menu'],
      [food.id, 'food-three-menu'],
    ] as const) {
      await prisma().menu.create({
        data: { restaurantId, name: slug, slug, currency: 'IQD', status: 'DRAFT', timezone: 'Asia/Baghdad', locales: ['ar'] },
      });
    }

    const menus = dataOf(await ask(admin, listMenus, {}));
    expect(menus.rows.map((row) => row.restaurant.id)).toEqual([food.id]);
    expect(menus.restaurants.map((row) => row.id)).toEqual([food.id]);

    const overview = dataOf(await ask(admin, posOverview, {}));
    expect(overview.rows.map((row) => row.id)).toEqual([food.id]);
  });
});
