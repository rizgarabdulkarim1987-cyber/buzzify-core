import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRetailState, stateHash, type Built } from '@/server/retail/snapshot';
import { bumpRetailState } from '@/server/retail/outbox';
import * as restaurants from '@/server/studio/actions/restaurants';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runAction } from '@/server/studio/framework/action';
import { DAY, NOW, person, prisma, resetWorld, useTestDatabase } from '../pharmacy/fixture';
import { coreStateSchema } from './contract-oracle';
import { RETAIL_LIMITS, retailPlan, retailShop } from './world';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const META = { ip: '203.0.113.7', userAgent: 'vitest' };

const build = (restaurantId: string) => prisma().$transaction((tx) => buildRetailState(tx, restaurantId));
const bump = (restaurantId: string) => prisma().$transaction((tx) => bumpRetailState(tx, restaurantId));
const ready = (built: Built) => {
  if (!built.ready) throw new Error(`expected a ready snapshot, waiting for ${built.waitingFor}`);
  return built;
};

beforeAll(() => useTestDatabase());
afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});
beforeEach(async () => {
  await resetWorld();
});

describe('buildRetailState', () => {
  it('waits for the owner', async () => {
    const admin = (await loadActor(prisma(), (await person('root', { superAdmin: true })).userId)) as Actor;
    const created = await runAction(prisma(), admin, restaurants.createRestaurant, {
      name: 'Pending Shop',
      type: 'OTHER',
      sector: 'RETAIL',
      branches: [{ name: 'Main' }],
      currencies: ['IQD'],
      ownerEmail: 'boss@retail-test.example',
    }, META);
    if (!created.ok) throw new Error(JSON.stringify(created.error));
    const { restaurantId } = created.data;
    expect(await prisma().invitation.count({ where: { restaurantId, acceptedAt: null } })).toBe(1);
    expect(await build(restaurantId)).toEqual({ ready: false, waitingFor: 'OWNER' });
  });

  it('waits for a subscription', async () => {
    const shop = await retailShop('No Sub', { subscription: 'none' });
    expect(await build(shop.id)).toEqual({ ready: false, waitingFor: 'SUBSCRIPTION' });
  });

  it("builds a state that passes Retails' schema", async () => {
    await retailPlan('shop');
    const shop = await retailShop('Good Shop', { aiIntake: true });
    expect(await bump(shop.id)).toBe(1);
    const built = ready(await build(shop.id));
    expect(() => coreStateSchema.parse(built.state)).not.toThrow();
    const owner = await prisma().user.findUniqueOrThrow({ where: { id: shop.owner!.userId } });
    expect(built.state).toEqual({
      coreBusinessId: shop.id,
      version: 1,
      status: 'ACTIVE',
      plan: { code: 'shop', name: 'Shop Starter', maxBranches: 2, maxTerminals: 3, maxUsers: 5, storageMb: 500, aiMonthly: 100 },
      subscription: {
        status: 'ACTIVE',
        trialEndsAt: null,
        currentPeriodStart: new Date(NOW.getTime() - 5 * DAY).toISOString(),
        currentPeriodEnd: new Date(NOW.getTime() + 25 * DAY).toISOString(),
        graceDays: 7,
      },
      aiIntake: true,
      owner: { coreUserId: owner.id, email: owner.email, emailVerified: owner.emailVerified, name: owner.name },
    });
    expect(built.provision).toEqual({
      coreBusinessId: shop.id,
      name: 'Good Shop',
      activityType: 'MIXED',
      capabilities: [],
      branches: [{ name: 'Good Shop branch 1' }, { name: 'Good Shop branch 2' }],
      currencies: ['IQD', 'USD'],
      state: built.state,
    });
    expect(built.hash).toBe(stateHash(built.state));
    expect(built.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('TRIAL carries trialEndsAt', async () => {
    await retailPlan('shop');
    const shop = await retailShop('Trial Shop', { subscription: 'TRIAL', periodEndsInDays: 14 });
    await bump(shop.id);
    const { state } = ready(await build(shop.id));
    expect(state.subscription).toMatchObject({ status: 'TRIAL', trialEndsAt: new Date(NOW.getTime() + 14 * DAY).toISOString() });
    expect(() => coreStateSchema.parse(state)).not.toThrow();
  });

  it('a missing plan sends zero limits', async () => {
    const shop = await retailShop('Planless', { planCode: 'gone' });
    await bump(shop.id);
    const { state } = ready(await build(shop.id));
    expect(state.plan).toEqual({ code: 'gone', name: 'gone', maxBranches: 0, maxTerminals: 0, maxUsers: 0, storageMb: 0, aiMonthly: 0 });
    expect(() => coreStateSchema.parse(state)).not.toThrow();

    // Limits that are not a valid set read the same way, and a blank English name falls back to the code.
    await retailPlan('broken', { limits: { ...RETAIL_LIMITS, extra: 1 }, name: { en: '  ', ar: 'x', ckb: 'x' } });
    await prisma().subscription.update({ where: { id: shop.subscriptionId! }, data: { planCode: 'broken' } });
    const again = ready(await build(shop.id));
    expect(again.state.plan).toEqual({ code: 'broken', name: 'broken', maxBranches: 0, maxTerminals: 0, maxUsers: 0, storageMb: 0, aiMonthly: 0 });
  });

  it('the live subscription wins, else the newest', async () => {
    await retailPlan('shop');
    await retailPlan('big', { limits: { ...RETAIL_LIMITS, branches: 9 } });
    const shop = await retailShop('Two Subs', { subscription: 'EXPIRED', planCode: 'big' });
    await bump(shop.id);
    expect(ready(await build(shop.id)).state).toMatchObject({ plan: { code: 'big' }, subscription: { status: 'EXPIRED' } });
    const end = new Date(NOW.getTime() + 10 * DAY);
    await prisma().subscription.create({
      data: {
        restaurantId: shop.id, applicationId: 'retail', planCode: 'shop', status: 'ACTIVE', period: 'MONTHLY', currency: 'IQD',
        priceMinor: 0, currentPeriodStart: new Date(end.getTime() - 30 * DAY), currentPeriodEnd: end, graceDays: 3, version: 1,
        // Older than the expired row: the live one still wins.
        createdAt: new Date(NOW.getTime() - 400 * DAY),
      },
    });
    expect(ready(await build(shop.id)).state).toMatchObject({ plan: { code: 'shop', maxBranches: 2 }, subscription: { status: 'ACTIVE', graceDays: 3 } });
  });

  it('earliest active owner wins, a deactivated earlier owner is skipped', async () => {
    await retailPlan('shop');
    const shop = await retailShop('Owners');
    const later = await person('later-owner', { membership: [shop.id, 'OWNER'] });
    await person('designer', { membership: [shop.id, 'DESIGNER'] });
    await prisma().membership.updateMany({ where: { userId: later.userId }, data: { createdAt: new Date(Date.now() + 60_000) } });
    await prisma().user.update({ where: { id: later.userId }, data: { name: `  ${'N'.repeat(250)}  ` } });
    await bump(shop.id);
    expect(ready(await build(shop.id)).state.owner.coreUserId).toBe(shop.owner!.userId);

    await prisma().user.update({ where: { id: shop.owner!.userId }, data: { deactivatedAt: NOW } });
    const { state } = ready(await build(shop.id));
    expect(state.owner).toEqual({ coreUserId: later.userId, email: later.email, emailVerified: true, name: 'N'.repeat(200) });
    expect(() => coreStateSchema.parse(state)).not.toThrow();

    await prisma().user.update({ where: { id: later.userId }, data: { deactivatedAt: NOW } });
    expect(await build(shop.id)).toEqual({ ready: false, waitingFor: 'OWNER' });
  });

  it('hash ignores version', async () => {
    await retailPlan('shop');
    const shop = await retailShop('Hashed');
    await bump(shop.id);
    const first = ready(await build(shop.id));
    await bump(shop.id);
    const second = ready(await build(shop.id));
    expect(second.state.version).toBe(2);
    expect(second.hash).toBe(first.hash);
    // Key order does not matter; content does.
    const { owner, plan, ...rest } = first.state;
    const reversed = Object.fromEntries(Object.entries(plan).reverse()) as typeof plan;
    const reordered = { owner, ...rest, plan: reversed };
    expect(stateHash(reordered)).toBe(first.hash);
    expect(stateHash({ ...first.state, aiIntake: !first.state.aiIntake })).not.toBe(first.hash);
  });

  it('refuses a business without a RetailLink', async () => {
    const food = await prisma().restaurant.create({ data: { name: 'Food' }, select: { id: true } });
    await expect(build(food.id)).rejects.toThrow(/not a linked retail business/);
  });
});
