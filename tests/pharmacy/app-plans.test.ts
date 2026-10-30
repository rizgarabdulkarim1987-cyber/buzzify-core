import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as appPlans from '@/server/studio/actions/app-plans';
import * as billing from '@/server/studio/actions/billing';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { createPasswordUser } from '@/server/studio/auth/users';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import { runQuery } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import { appPlansList } from '@/server/studio/queries/app-plans';
import { billingOverview } from '@/server/studio/queries/billing';
import { GOOD, person, pharmacy, prisma, resetWorld, useTestDatabase } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const META = { ip: '203.0.113.7', userAgent: 'vitest' };

const NAME = { en: 'Starter', ar: 'مبتدئة', ckb: 'دەستپێک' };
const LIMITS = { branches: 2, users: 5, storageMb: 500, aiMonthlyBudgetMinor: 0 };
const planInput = (extra: Record<string, unknown> = {}) => ({ code: 'starter', name: NAME, limits: LIMITS, sortOrder: 1, active: true, ...extra });

const run = <I, O>(actor: Actor, def: ActionDef<I, O>, input: unknown) => runAction(prisma(), actor, def, input, META);
const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  return result.data;
};
const failure = <T>(result: ActionResult<T>) => {
  if (result.ok) throw new Error('expected a refusal');
  return result.error;
};

async function superAdmin(email: string, isPlatformOwner: boolean): Promise<Actor> {
  const { userId } = await createPasswordUser(prisma(), { email, name: email.split('@')[0]!, password: GOOD, isSuperAdmin: true, isPlatformOwner });
  await prisma().user.update({ where: { id: userId }, data: { twoFactorEnabled: true } });
  return (await loadActor(prisma(), userId))!;
}

const WRONG_SECTOR = 'This product is not offered to this kind of business';

const row = (code = 'starter') => prisma().appPlan.findUniqueOrThrow({ where: { applicationId_code: { applicationId: 'pharmacy', code } } });

let owner: Actor;
let admin: Actor;

beforeAll(() => {
  useTestDatabase();
});

afterAll(async () => {
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

beforeEach(async () => {
  await resetWorld();
  owner = await superAdmin('alice@ph-test.example', true);
  admin = await superAdmin('carol@ph-test.example', false);
});

describe('pharmacy plans', () => {
  it('only the platform owner edits plans', async () => {
    expect(failure(await run(admin, appPlans.upsert, planInput())).code).toBe('FORBIDDEN');
    expect(failure(await run(admin, appPlans.deactivate, { code: 'starter', version: 1 })).code).toBe('FORBIDDEN');
    const restaurantOwner = await actorFor(await person('shop-owner'));
    expect(failure(await run(restaurantOwner, appPlans.upsert, planInput())).code).toBe('FORBIDDEN');
    expect(await prisma().appPlan.count()).toBe(0);

    dataOf(await run(owner, appPlans.upsert, planInput()));
    expect(await row()).toMatchObject({ code: 'starter', name: NAME, limits: LIMITS, active: true, version: 1 });
    // Another Super Admin can read the plans but is told they cannot edit them.
    const seen = dataOf(await runQuery(prisma(), admin, appPlansList, {}));
    expect(seen.canEdit).toBe(false);
    expect(seen.plans.map((p) => p.code)).toEqual(['starter']);
    expect(dataOf(await runQuery(prisma(), owner, appPlansList, {})).canEdit).toBe(true);
    // The audit row names the new plan by its id.
    const audit = await prisma().auditLog.findFirstOrThrow({ where: { action: 'app_plan.created' } });
    expect(audit).toMatchObject({ entityType: 'AppPlan', entityId: (await row()).id });
  });

  it('editing a plan with a stale version is refused naming who changed it', async () => {
    dataOf(await run(owner, appPlans.upsert, planInput()));
    const changed = dataOf(await run(owner, appPlans.upsert, planInput({ version: 1, limits: { ...LIMITS, branches: 4 } })));
    expect(changed.version).toBe(2);

    // Two tabs of the same owner is the only setup possible: there is exactly one platform owner.
    // The second tab still holds version 1.
    const stale = failure(await run(owner, appPlans.upsert, planInput({ version: 1, limits: { ...LIMITS, branches: 9 } })));
    expect(stale).toMatchObject({ code: 'CONFLICT', fields: { changedBy: 'alice' } });
    expect((await row()).limits).toMatchObject({ branches: 4 });
    // A fresh version goes through; saving what is already stored writes nothing.
    expect(dataOf(await run(owner, appPlans.upsert, planInput({ version: 2, limits: { ...LIMITS, branches: 4 } }))).version).toBe(2);
    expect((await row()).version).toBe(2);
    expect(failure(await run(owner, appPlans.deactivate, { code: 'starter', version: 1 })).code).toBe('CONFLICT');
  });

  it('refuses a duplicate code, bad limits and an edit of a plan that does not exist', async () => {
    dataOf(await run(owner, appPlans.upsert, planInput()));
    expect(failure(await run(owner, appPlans.upsert, planInput())).code).toBe('CONFLICT');
    expect(failure(await run(owner, appPlans.upsert, planInput({ code: 'two', limits: { ...LIMITS, users: -1 } }))).code).toBe('INVALID');
    expect(failure(await run(owner, appPlans.upsert, planInput({ code: 'Bad Code' }))).code).toBe('INVALID');
    expect(failure(await run(owner, appPlans.upsert, planInput({ code: 'ghost', version: 1 }))).code).toBe('NOT_FOUND');
    expect(await prisma().appPlan.count()).toBe(1);
  });

  it('a subscription to a pharmacy plan code that does not exist is refused', async () => {
    const { id } = await pharmacy('Newcomer', { subscription: 'none' });
    const trial = (planCode: string) => ({ restaurantId: id, applicationId: 'pharmacy', planCode, trialDays: 14, period: 'MONTHLY', currency: 'IQD' });
    const prices = (planCode: string) => ({ applicationId: 'pharmacy', planCode, prices: [{ currency: 'IQD', period: 'MONTHLY', amountMinor: 50_000 }] });

    // The Menu's tiers are not pharmacy plans, and a code nobody made is not one either.
    for (const code of ['PRO', 'ghost']) {
      expect(await run(owner, billing.startTrial, trial(code))).toMatchObject({ ok: false, error: { code: 'INVALID', fields: { planCode: expect.any(String) } } });
      expect(await run(owner, billing.setPrices, prices(code))).toMatchObject({ ok: false, error: { code: 'INVALID', fields: { planCode: expect.any(String) } } });
    }
    expect(await prisma().subscription.count({ where: { restaurantId: id } })).toBe(0);

    dataOf(await run(owner, appPlans.upsert, planInput()));
    dataOf(await run(owner, billing.setPrices, prices('starter')));
    dataOf(await run(owner, billing.startTrial, trial('starter')));
    expect(await prisma().subscription.findFirstOrThrow({ where: { restaurantId: id } })).toMatchObject({ applicationId: 'pharmacy', planCode: 'starter', status: 'TRIAL' });
    const overview = dataOf(await runQuery(prisma(), owner, billingOverview, {}));
    expect(overview.applications.find((a) => a.id === 'pharmacy')?.plans.map((p) => p.code)).toEqual(['starter']);
  });

  it('a product of the other sector is refused: no pharmacy plan for a FOOD business, no menu or cashier plan for a pharmacy', async () => {
    const shop = await pharmacy('Shop', { subscription: 'none' });
    const cafe = await pharmacy('Cafe', { sector: 'FOOD', subscription: 'none' });
    const trial = (restaurantId: string, applicationId: string, planCode: string) => ({ restaurantId, applicationId, planCode, trialDays: 14, period: 'MONTHLY', currency: 'IQD' });
    dataOf(await run(owner, appPlans.upsert, planInput()));
    dataOf(await run(owner, billing.setPrices, { applicationId: 'pharmacy', planCode: 'starter', prices: [{ currency: 'IQD', period: 'MONTHLY', amountMinor: 1_000 }] }));
    for (const applicationId of ['menu', 'cashier']) {
      dataOf(await run(owner, billing.setPrices, { applicationId, planCode: 'PRO', prices: [{ currency: 'IQD', period: 'MONTHLY', amountMinor: 1_000 }] }));
    }

    for (const [restaurantId, applicationId, planCode] of [
      [cafe.id, 'pharmacy', 'starter'],
      [shop.id, 'menu', 'PRO'],
      [shop.id, 'cashier', 'PRO'],
    ] as const) {
      expect(await run(owner, billing.startTrial, trial(restaurantId, applicationId, planCode))).toMatchObject({
        ok: false,
        error: { code: 'CONFLICT', message: WRONG_SECTOR },
      });
    }
    expect(await prisma().subscription.count()).toBe(0);
    // The matching pairs still start.
    dataOf(await run(owner, billing.startTrial, trial(shop.id, 'pharmacy', 'starter')));
    dataOf(await run(owner, billing.startTrial, trial(cafe.id, 'menu', 'PRO')));

    // A mismatched subscription written before this rule cannot move to another plan either.
    const legacy = await prisma().subscription.create({
      data: { restaurantId: shop.id, applicationId: 'menu', planCode: 'PRO', status: 'ACTIVE', period: 'MONTHLY', currency: 'IQD', priceMinor: 0, currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 86_400_000), graceDays: 7, version: 1 },
    });
    const change = await run(owner, billing.changePlan, { restaurantId: shop.id, subscriptionId: legacy.id, version: 1, planCode: 'BASIC', keepPrice: true });
    expect(change).toMatchObject({ ok: false, error: { code: 'CONFLICT', message: WRONG_SECTOR } });
    expect(await prisma().subscription.findUniqueOrThrow({ where: { id: legacy.id } })).toMatchObject({ planCode: 'PRO', version: 1 });
  });

  it('a mismatched subscription cannot be reactivated or paid: a FOOD business on a pharmacy plan and vice versa', async () => {
    const shop = await pharmacy('Shop', { subscription: 'none' });
    const cafe = await pharmacy('Cafe', { sector: 'FOOD', subscription: 'none' });
    const soon = new Date(Date.now() + 10 * 86_400_000);
    const legacy = (restaurantId: string, applicationId: string, planCode: string, status: 'CANCELLED' | 'ACTIVE') =>
      prisma().subscription.create({
        data: { restaurantId, applicationId, planCode, status, period: 'MONTHLY', currency: 'IQD', priceMinor: 0, currentPeriodStart: new Date(), currentPeriodEnd: soon, graceDays: 7, version: 1 },
      });
    const foodOnPharmacy = await legacy(cafe.id, 'pharmacy', 'starter', 'CANCELLED');
    const pharmacyOnMenu = await legacy(shop.id, 'menu', 'PRO', 'CANCELLED');

    for (const sub of [foodOnPharmacy, pharmacyOnMenu]) {
      expect(await run(owner, billing.reactivate, { restaurantId: sub.restaurantId, subscriptionId: sub.id, version: 1 })).toMatchObject({
        ok: false,
        error: { code: 'CONFLICT', message: WRONG_SECTOR },
      });
      expect(await prisma().subscription.findUniqueOrThrow({ where: { id: sub.id } })).toMatchObject({ status: 'CANCELLED', version: 1 });
    }

    const paying = [await legacy(cafe.id, 'pharmacy', 'starter2', 'ACTIVE'), await legacy(shop.id, 'cashier', 'PRO', 'ACTIVE')];
    for (const sub of paying) {
      const paid = await run(owner, billing.recordPayment, {
        restaurantId: sub.restaurantId,
        subscriptionId: sub.id,
        amountMinor: 1000,
        method: 'CASH',
        paidAt: new Date(),
        idempotencyKey: crypto.randomUUID(),
      });
      expect(paid).toMatchObject({ ok: false, error: { code: 'CONFLICT', message: WRONG_SECTOR } });
    }
    expect(await prisma().payment.count()).toBe(0);
  });

  it('a plan taken off sale cannot be chosen again but keeps its subscribers', async () => {
    const { id } = await pharmacy('Subscriber', { subscription: 'none' });
    dataOf(await run(owner, appPlans.upsert, planInput()));
    dataOf(await run(owner, billing.setPrices, { applicationId: 'pharmacy', planCode: 'starter', prices: [{ currency: 'IQD', period: 'MONTHLY', amountMinor: 1_000 }] }));
    dataOf(await run(owner, billing.startTrial, { restaurantId: id, applicationId: 'pharmacy', planCode: 'starter', trialDays: 14, period: 'MONTHLY', currency: 'IQD' }));

    dataOf(await run(owner, appPlans.deactivate, { code: 'starter', version: 1 }));

    expect(await row()).toMatchObject({ active: false, version: 2 });
    expect(await prisma().subscription.count({ where: { restaurantId: id, planCode: 'starter' } })).toBe(1);
    const other = await pharmacy('Other', { subscription: 'none' });
    expect(
      await run(owner, billing.startTrial, { restaurantId: other.id, applicationId: 'pharmacy', planCode: 'starter', trialDays: 14, period: 'MONTHLY', currency: 'IQD' }),
    ).toMatchObject({ ok: false, error: { code: 'INVALID' } });
    expect(dataOf(await runQuery(prisma(), owner, appPlansList, {})).plans[0]).toMatchObject({ code: 'starter', active: false, subscriptions: 1 });
  });
});

async function actorFor(who: { userId: string }): Promise<Actor> {
  return (await loadActor(prisma(), who.userId))!;
}
