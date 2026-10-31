import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { posGate, resolvePosActor } from '@/server/pos/actor';
import { phGate, resolvePhActor } from '@/server/pharmacy/actor';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runQuery, type QueryDef } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import { listMenus } from '@/server/studio/queries/menus';
import { listPharmacies } from '@/server/studio/queries/pharmacies';
import { posOverview } from '@/server/studio/queries/pos';
import { initialSectorOf } from '@/studio/sector-param';
import { person, pharmacy, prisma, resetWorld, useTestDatabase, NOW } from '../pharmacy/fixture';

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

/** A live subscription to an application, from NOW's own clock. */
async function subscribe(restaurantId: string, applicationId: string): Promise<void> {
  const now = Date.now();
  await prisma().subscription.create({
    data: {
      restaurantId,
      applicationId,
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

const retail = (name: string) => pharmacy(name, { sector: 'RETAIL', subscription: 'none' });

describe('a RETAIL business is neither a menu business nor a pharmacy', () => {
  it('a RETAIL business has no till actor and posGate is closed even with a cashier subscription', async () => {
    const shop = await retail('Shop One');
    const owner = await person('shop-owner', { membership: [shop.id, 'OWNER'] });
    const cashier = await person('shop-cashier', { posStaff: [shop.id, 'CASHIER'] });
    expect(await resolvePosActor(prisma(), owner.userId, shop.id)).toBeNull();
    expect(await resolvePosActor(prisma(), owner.userId)).toBeNull();
    expect(await resolvePosActor(prisma(), cashier.userId, shop.id)).toBeNull();
    await subscribe(shop.id, 'cashier');
    expect(await posGate(prisma(), shop.id, NOW)).toEqual({ open: false, reason: 'restaurantInactive' });
  });

  it('the pharmacy actor refuses it (notPharmacy)', async () => {
    const shop = await retail('Shop Two');
    const owner = await person('shop-owner-2', { membership: [shop.id, 'OWNER'] });
    await subscribe(shop.id, 'pharmacy');
    expect(await phGate(prisma(), shop.id, NOW)).toEqual({ state: 'closed', reason: 'notPharmacy' });
    expect(await resolvePhActor(prisma(), owner.userId, { restaurantId: shop.id })).toBeNull();
  });

  it('listMenus, posOverview and the Pharmacy page do not list it', async () => {
    const shop = await retail('Shop Three');
    const food = await pharmacy('Food Three', { sector: 'FOOD', subscription: 'none' });
    const ph = await pharmacy('Ph Three');
    const admin = await person('sep-admin', { superAdmin: true });
    await person('sep-shop-cashier', { posStaff: [shop.id, 'CASHIER'] });
    for (const id of [shop.id, food.id]) await subscribe(id, 'cashier');
    for (const [restaurantId, slug] of [
      [shop.id, 'shop-three-menu'],
      [food.id, 'food-three-menu'],
    ] as const) {
      await prisma().menu.create({
        data: { restaurantId, name: slug, slug, currency: 'IQD', status: 'DRAFT', timezone: 'Asia/Baghdad', locales: ['ar'] },
      });
    }

    const menus = dataOf(await ask(admin, listMenus, {}));
    expect(menus.rows.map((row) => row.restaurant.id)).toEqual([food.id]);
    expect(menus.restaurants.map((row) => row.id)).toEqual([food.id]);
    expect(dataOf(await ask(admin, posOverview, {})).rows.map((row) => row.id)).toEqual([food.id]);
    expect(dataOf(await ask(admin, listPharmacies, {})).rows.map((row) => row.id)).toEqual([ph.id]);
  });

  it('the new business form opens on RETAIL for ?sector=RETAIL and on Food for anything unknown', () => {
    expect(initialSectorOf({ sector: 'RETAIL' })).toBe('RETAIL');
    expect(initialSectorOf({ sector: 'PHARMACY' })).toBe('PHARMACY');
    expect(initialSectorOf({ sector: 'retail' })).toBe('FOOD');
    expect(initialSectorOf({})).toBe('FOOD');
  });

  // Passes once billing offers each sector its own product (Task 3): menu, cashier and pharmacy are refused for a
  // RETAIL business, and the pharmacy product is refused for it the other way round.
  it.todo('billing refuses menu, cashier and pharmacy for it and pharmacy refuses retail');
});
