import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as appPlans from '@/server/studio/actions/app-plans';
import * as billing from '@/server/studio/actions/billing';
import * as people from '@/server/studio/actions/people';
import * as restaurants from '@/server/studio/actions/restaurants';
import * as retail from '@/server/studio/actions/retail';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { createPasswordUser } from '@/server/studio/auth/users';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import type { ActionResult } from '@/server/studio/framework/result';
import { sweepSubscriptions } from '@/server/studio/services/billing-sweep';
import { acceptInvitation, createInvitation } from '@/server/studio/services/invitations';
import * as restaurantServices from '@/server/studio/services/restaurants';
import { DAY, GOOD, person, pharmacy, prisma, resetWorld, useTestDatabase } from '../pharmacy/fixture';
import { linkOf, outboxOf, RETAIL_LIMITS, RETAIL_NAME, retailPlan, retailShop } from './world';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const META = { ip: '203.0.113.7', userAgent: 'vitest' };

const run = <I, O>(actor: Actor, def: ActionDef<I, O>, input: unknown) => runAction(prisma(), actor, def, input, META);
const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  return result.data;
};
const versionOf = async (restaurantId: string) => (await linkOf(restaurantId)).stateVersion;
const subOf = (restaurantId: string) => prisma().subscription.findFirstOrThrow({ where: { restaurantId }, orderBy: { createdAt: 'desc' } });

async function superAdmin(email: string, isPlatformOwner: boolean): Promise<Actor> {
  const { userId } = await createPasswordUser(prisma(), { email, name: email.split('@')[0]!, password: GOOD, isSuperAdmin: true, isPlatformOwner });
  await prisma().user.update({ where: { id: userId }, data: { twoFactorEnabled: true } });
  return (await loadActor(prisma(), userId))!;
}

/** A retail plan on sale with a price, so the billing screens can start a trial on it. */
async function sellable(code = 'shop') {
  await retailPlan(code);
  await prisma().planPrice.create({ data: { applicationId: 'retail', planCode: code, currency: 'IQD', period: 'MONTHLY', amountMinor: 1_000 } });
}
const trial = (restaurantId: string, applicationId = 'retail', planCode = 'shop') => ({ restaurantId, applicationId, planCode, trialDays: 14, period: 'MONTHLY', currency: 'IQD' });

let owner: Actor;
let admin: Actor;

beforeAll(() => useTestDatabase());
afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});
beforeEach(async () => {
  await resetWorld();
  owner = await superAdmin('alice@rt-test.example', true);
  admin = await superAdmin('carol@rt-test.example', false);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('what enqueues a retail snapshot', () => {
  it('accepting the owner invitation enqueues', async () => {
    const shop = await retailShop('Invited', { owner: false });
    const { url } = await createInvitation(prisma(), {
      email: 'new-owner@rt-test.example', restaurantId: shop.id, role: 'OWNER', asSuperAdmin: false, invitedById: admin.userId, now: new Date(),
    });
    expect(await outboxOf(shop.id)).toBeNull();
    await acceptInvitation(prisma(), { token: url.slice(url.lastIndexOf('/') + 1), signedInUserId: null, name: 'New Owner', password: GOOD, now: new Date() });
    expect(await versionOf(shop.id)).toBe(1);
    expect(await outboxOf(shop.id)).toMatchObject({ dueVersion: 1 });

    // A designer invitation does not change who owns the shop.
    const designer = await createInvitation(prisma(), {
      email: 'designer@rt-test.example', restaurantId: shop.id, role: 'DESIGNER', asSuperAdmin: false, invitedById: admin.userId, now: new Date(),
    });
    await acceptInvitation(prisma(), { token: designer.url.slice(designer.url.lastIndexOf('/') + 1), signedInUserId: null, name: 'Des', password: GOOD, now: new Date() });
    expect(await versionOf(shop.id)).toBe(1);
  });

  it('starting a retail trial enqueues', async () => {
    await sellable();
    const shop = await retailShop('Trial', { subscription: 'none' });
    dataOf(await run(owner, billing.startTrial, trial(shop.id)));
    expect(await versionOf(shop.id)).toBe(1);
    expect(await outboxOf(shop.id)).toMatchObject({ dueVersion: 1 });
  });

  it('a pharmacy trial does not', async () => {
    await prisma().appPlan.create({ data: { applicationId: 'pharmacy', code: 'standard', name: RETAIL_NAME, limits: { branches: 1, users: 1, storageMb: 1, aiMonthlyBudgetMinor: 0 } } });
    await prisma().planPrice.create({ data: { applicationId: 'pharmacy', planCode: 'standard', currency: 'IQD', period: 'MONTHLY', amountMinor: 1_000 } });
    const shop = await pharmacy('Pharma', { subscription: 'none' });
    dataOf(await run(owner, billing.startTrial, trial(shop.id, 'pharmacy', 'standard')));
    expect(await prisma().retailOutbox.count()).toBe(0);
  });

  it('changing plan, cancelling, reactivating and paying each enqueue', async () => {
    await sellable('shop');
    await sellable('big');
    const shop = await retailShop('Lifecycle', { subscription: 'none' });
    dataOf(await run(owner, billing.startTrial, trial(shop.id)));
    let sub = await subOf(shop.id);
    dataOf(await run(owner, billing.changePlan, { restaurantId: shop.id, subscriptionId: sub.id, version: sub.version, planCode: 'big', keepPrice: true }));
    expect(await versionOf(shop.id)).toBe(2);
    sub = await subOf(shop.id);
    dataOf(await run(owner, billing.cancel, { restaurantId: shop.id, subscriptionId: sub.id, version: sub.version }));
    expect(await versionOf(shop.id)).toBe(3);
    sub = await subOf(shop.id);
    dataOf(await run(owner, billing.reactivate, { restaurantId: shop.id, subscriptionId: sub.id, version: sub.version }));
    expect(await versionOf(shop.id)).toBe(4);
    dataOf(
      await run(owner, billing.recordPayment, {
        restaurantId: shop.id, subscriptionId: sub.id, amountMinor: 1_000, paidAt: new Date().toISOString(), idempotencyKey: randomUUID(),
      }),
    );
    expect(await versionOf(shop.id)).toBe(5);
    expect(await outboxOf(shop.id)).toMatchObject({ dueVersion: 5 });
  });

  it('the sweep moving a retail subscription to GRACE enqueues', async () => {
    const shop = await retailShop('Sweep', { periodEndsInDays: 25 });
    const pharma = await pharmacy('Sweep Pharma', { periodEndsInDays: 25 });
    const now = new Date((await subOf(shop.id)).currentPeriodEnd.getTime() + DAY);
    expect(await sweepSubscriptions(prisma(), now)).toEqual({ graced: 2, expired: 0, failed: 0 });
    expect((await subOf(shop.id)).status).toBe('GRACE');
    expect((await subOf(pharma.id)).status).toBe('GRACE');
    expect(await versionOf(shop.id)).toBe(1);
    expect(await prisma().retailOutbox.count()).toBe(1);
    // Nothing more is due: a second run changes nothing and enqueues nothing.
    await sweepSubscriptions(prisma(), now);
    expect(await versionOf(shop.id)).toBe(1);
  });

  it('suspending enqueues', async () => {
    const shop = await retailShop('Suspend');
    dataOf(await run(admin, restaurants.setRestaurantStatus, { restaurantId: shop.id, status: 'SUSPENDED' }));
    expect(await versionOf(shop.id)).toBe(1);
    // Setting the status it already has writes nothing.
    dataOf(await run(admin, restaurants.setRestaurantStatus, { restaurantId: shop.id, status: 'SUSPENDED' }));
    expect(await versionOf(shop.id)).toBe(1);
    dataOf(await run(admin, restaurants.setRestaurantStatus, { restaurantId: shop.id, status: 'ARCHIVED' }));
    expect(await versionOf(shop.id)).toBe(2);
  });

  it("changing a retail plan's limits enqueues every business on it", async () => {
    const plan = await retailPlan('shop');
    const a = await retailShop('Plan A');
    const b = await retailShop('Plan B');
    const c = await retailShop('Plan C', { planCode: 'big' });
    const input = { applicationId: 'retail', code: 'shop', name: RETAIL_NAME, sortOrder: 0, active: true };
    dataOf(await run(owner, appPlans.upsert, { ...input, limits: { ...RETAIL_LIMITS, terminals: 9 }, version: plan.version }));
    expect([await versionOf(a.id), await versionOf(b.id), await versionOf(c.id)]).toEqual([1, 1, 0]);
    // A sort order change alone is not part of the snapshot.
    dataOf(await run(owner, appPlans.upsert, { ...input, limits: { ...RETAIL_LIMITS, terminals: 9 }, sortOrder: 5, version: plan.version + 1 }));
    expect(await versionOf(a.id)).toBe(1);
    dataOf(await run(owner, appPlans.upsert, { ...input, name: { ...RETAIL_NAME, en: 'Renamed' }, limits: { ...RETAIL_LIMITS, terminals: 9 }, sortOrder: 5, version: plan.version + 2 }));
    expect(await versionOf(a.id)).toBe(2);
    dataOf(await run(owner, appPlans.deactivate, { applicationId: 'retail', code: 'shop', version: plan.version + 3 }));
    expect([await versionOf(a.id), await versionOf(b.id), await versionOf(c.id)]).toEqual([3, 3, 0]);
  });

  it("changing the owner's email enqueues", async () => {
    const shop = await retailShop('Email');
    dataOf(await run(admin, people.changeUserEmail, { userId: shop.owner!.userId, email: 'moved@rt-test.example' }));
    expect(await versionOf(shop.id)).toBe(1);
  });

  it('deactivating, reactivating and unassigning the owner enqueue', async () => {
    const shop = await retailShop('Owner Life');
    const userId = shop.owner!.userId;
    // A co-owner, so the shop keeps an owner while the first one is off or gone (owners.test.ts covers the refusal).
    await person('co-owner', { membership: [shop.id, 'OWNER'] });
    dataOf(await run(admin, people.deactivateUser, { userId }));
    expect(await versionOf(shop.id)).toBe(1);
    dataOf(await run(admin, people.reactivateUser, { userId }));
    expect(await versionOf(shop.id)).toBe(2);
    dataOf(await run(admin, people.unassignMember, { userId, restaurantId: shop.id }));
    expect(await versionOf(shop.id)).toBe(3);
    // A designer leaving changes nothing Retails sees.
    const designer = await person('shop-designer', { membership: [shop.id, 'DESIGNER'] });
    dataOf(await run(admin, people.unassignMember, { userId: designer.userId, restaurantId: shop.id }));
    expect(await versionOf(shop.id)).toBe(3);
  });

  it('setAiIntake is audited with its reason and enqueues', async () => {
    const shop = await retailShop('AI');
    expect((await run(admin, retail.setAiIntake, { restaurantId: shop.id, enabled: true, reason: 'pilot shop' })).ok).toBe(false);
    dataOf(await run(owner, retail.setAiIntake, { restaurantId: shop.id, enabled: true, reason: '  pilot shop  ' }));
    expect(await linkOf(shop.id)).toMatchObject({ aiIntake: true, stateVersion: 1 });
    const row = await prisma().auditLog.findFirstOrThrow({ where: { action: 'retail.ai_intake_changed' } });
    expect(row).toMatchObject({ actorId: owner.userId, restaurantId: shop.id, entityType: 'RetailLink', entityId: shop.id });
    expect(row.changes).toEqual({ aiIntake: { before: false, after: true }, reason: { before: null, after: 'pilot shop' } });
    // A too-short reason is refused and nothing changes; the same value again writes nothing.
    const short = await run(owner, retail.setAiIntake, { restaurantId: shop.id, enabled: false, reason: 'no' });
    expect(short.ok ? 'OK' : short.error.code).toBe('INVALID');
    dataOf(await run(owner, retail.setAiIntake, { restaurantId: shop.id, enabled: true, reason: 'again' }));
    expect(await linkOf(shop.id)).toMatchObject({ aiIntake: true, stateVersion: 1 });
    expect(await prisma().auditLog.count({ where: { action: 'retail.ai_intake_changed' } })).toBe(1);
  });

  it('setAiIntake and resync refuse a business that is not retail', async () => {
    const food = await pharmacy('Food', { sector: 'FOOD', subscription: 'none' });
    expect(dataOrCode(await run(owner, retail.setAiIntake, { restaurantId: food.id, enabled: true, reason: 'pilot shop' }))).toBe('NOT_FOUND');
    expect(dataOrCode(await run(admin, retail.resync, { restaurantId: food.id }))).toBe('NOT_FOUND');
    expect(await prisma().retailOutbox.count()).toBe(0);
  });

  it('resync enqueues a higher version', async () => {
    const shop = await retailShop('Resync');
    dataOf(await run(admin, restaurants.setRestaurantStatus, { restaurantId: shop.id, status: 'SUSPENDED' }));
    await prisma().retailOutbox.delete({ where: { restaurantId: shop.id } });
    await prisma().retailLink.update({ where: { restaurantId: shop.id }, data: { acceptedVersion: 1 } });
    expect(dataOf(await run(admin, retail.resync, { restaurantId: shop.id }))).toEqual({ version: 2 });
    expect(await outboxOf(shop.id)).toMatchObject({ dueVersion: 2 });
    const row = await prisma().auditLog.findFirstOrThrow({ where: { action: 'retail.resync' } });
    expect(row).toMatchObject({ actorId: admin.userId, restaurantId: shop.id, entityId: shop.id });
  });

  it('a refused (rolled back) change enqueues nothing', async () => {
    const shop = await retailShop('Refused');
    // The status change fails after its write (and after the hook): the whole transaction is undone.
    vi.spyOn(restaurantServices, 'expireMenusAfterCommit').mockRejectedValueOnce(new Error('boom'));
    const result = await run(admin, restaurants.setRestaurantStatus, { restaurantId: shop.id, status: 'SUSPENDED' });
    expect(result.ok).toBe(false);
    expect((await prisma().restaurant.findUniqueOrThrow({ where: { id: shop.id } })).status).toBe('ACTIVE');
    expect(await versionOf(shop.id)).toBe(0);
    expect(await outboxOf(shop.id)).toBeNull();
    // A change refused before its write (a stale plan version) enqueues nothing either.
    const plan = await retailPlan('shop');
    const stale = await run(owner, appPlans.upsert, { applicationId: 'retail', code: 'shop', name: RETAIL_NAME, limits: { ...RETAIL_LIMITS, users: 1 }, version: plan.version + 7 });
    expect(stale.ok).toBe(false);
    expect(await prisma().retailOutbox.count()).toBe(0);
  });
});

function dataOrCode(result: ActionResult<unknown>): string {
  return result.ok ? 'OK' : result.error.code;
}

describe('a retail plan must allow the branches the shop has', () => {
  const TOO_FEW = 'This plan allows fewer branches than the shop has';
  const refusal = (result: ActionResult<unknown>) => (result.ok ? 'OK' : { code: result.error.code, message: result.error.message, fields: result.error.fields });
  const sellableWith = async (code: string, branches: number) => {
    await retailPlan(code, { limits: { ...RETAIL_LIMITS, branches } });
    await prisma().planPrice.create({ data: { applicationId: 'retail', planCode: code, currency: 'IQD', period: 'MONTHLY', amountMinor: 1_000 } });
  };

  it('startTrial, changePlan and reactivate refuse a plan with fewer branches; nothing is queued', async () => {
    await sellableWith('small', 2);
    await sellableWith('big', 5);
    const shop = await retailShop('Three Branches', { subscription: 'none', branches: 3 });

    expect(refusal(await run(owner, billing.startTrial, trial(shop.id, 'retail', 'small')))).toEqual({
      code: 'CONFLICT',
      message: TOO_FEW,
      fields: { limitCode: 'PLAN_LIMIT', limitKind: 'branches', limit: '2' },
    });
    expect(await prisma().subscription.count({ where: { restaurantId: shop.id } })).toBe(0);
    expect(await outboxOf(shop.id)).toBeNull();

    dataOf(await run(owner, billing.startTrial, trial(shop.id, 'retail', 'big')));
    let sub = await subOf(shop.id);
    const changed = await run(owner, billing.changePlan, { restaurantId: shop.id, subscriptionId: sub.id, version: sub.version, planCode: 'small', keepPrice: true });
    expect(refusal(changed)).toMatchObject({ code: 'CONFLICT', message: TOO_FEW });
    expect((await subOf(shop.id)).planCode).toBe('big');

    // The plan shrinks while the subscription is cancelled: reactivating it is refused.
    dataOf(await run(owner, billing.cancel, { restaurantId: shop.id, subscriptionId: sub.id, version: sub.version }));
    await prisma().appPlan.update({ where: { applicationId_code: { applicationId: 'retail', code: 'big' } }, data: { limits: { ...RETAIL_LIMITS, branches: 1 } } });
    sub = await subOf(shop.id);
    expect(refusal(await run(owner, billing.reactivate, { restaurantId: shop.id, subscriptionId: sub.id, version: sub.version }))).toMatchObject({
      code: 'CONFLICT',
      message: TOO_FEW,
    });
    expect((await subOf(shop.id)).status).toBe('CANCELLED');
  });

  it('a plan with exactly as many branches is fine', async () => {
    await sellableWith('exact', 3);
    const shop = await retailShop('Exact', { subscription: 'none', branches: 3 });
    dataOf(await run(owner, billing.startTrial, trial(shop.id, 'retail', 'exact')));
  });
});
