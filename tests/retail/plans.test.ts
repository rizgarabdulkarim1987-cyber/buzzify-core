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
import { GOOD, pharmacy, prisma, resetWorld, useTestDatabase } from '../pharmacy/fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const META = { ip: '203.0.113.7', userAgent: 'vitest' };

const NAME = { en: 'Shop Starter', ar: 'متجر مبتدئ', ckb: 'فرۆشگا دەستپێک' };
const LIMITS = { branches: 2, users: 5, terminals: 3, storageMb: 500, aiMonthly: 100 };
const PHARMACY_LIMITS = { branches: 2, users: 5, storageMb: 500, aiMonthlyBudgetMinor: 0 };
const planInput = (extra: Record<string, unknown> = {}) => ({ applicationId: 'retail', code: 'shop', name: NAME, limits: LIMITS, sortOrder: 1, active: true, ...extra });
const WRONG_SECTOR = 'This product is not offered to this kind of business';

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

const row = (applicationId: string, code: string) => prisma().appPlan.findUniqueOrThrow({ where: { applicationId_code: { applicationId, code } } });
const trial = (restaurantId: string, applicationId: string, planCode: string) => ({ restaurantId, applicationId, planCode, trialDays: 14, period: 'MONTHLY', currency: 'IQD' });
const price = (applicationId: string, planCode: string) => ({ applicationId, planCode, prices: [{ currency: 'IQD', period: 'MONTHLY', amountMinor: 1_000 }] });

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
  owner = await superAdmin('alice@rt-test.example', true);
  admin = await superAdmin('carol@rt-test.example', false);
});

describe('retail plans', () => {
  it('the platform owner creates a retail plan with the five limits', async () => {
    dataOf(await run(owner, appPlans.upsert, planInput()));
    expect(await row('retail', 'shop')).toMatchObject({ applicationId: 'retail', code: 'shop', name: NAME, limits: LIMITS, active: true, version: 1 });

    const changed = dataOf(await run(owner, appPlans.upsert, planInput({ version: 1, limits: { ...LIMITS, terminals: 4 } })));
    expect(changed.version).toBe(2);
    expect((await row('retail', 'shop')).limits).toMatchObject({ terminals: 4 });

    dataOf(await run(owner, appPlans.deactivate, { applicationId: 'retail', code: 'shop', version: 2 }));
    expect(await row('retail', 'shop')).toMatchObject({ active: false, version: 3 });
    expect(await prisma().appPlan.count({ where: { applicationId: 'pharmacy' } })).toBe(0);
  });

  it('a pharmacy-shaped limits object is refused for retail and vice versa', async () => {
    expect(failure(await run(owner, appPlans.upsert, planInput({ limits: PHARMACY_LIMITS }))).code).toBe('INVALID');
    expect(failure(await run(owner, appPlans.upsert, planInput({ limits: { ...LIMITS, extra: 1 } }))).code).toBe('INVALID');
    expect(failure(await run(owner, appPlans.upsert, planInput({ applicationId: 'pharmacy', limits: LIMITS }))).code).toBe('INVALID');
    expect(failure(await run(owner, appPlans.upsert, planInput({ applicationId: 'menu' }))).code).toBe('INVALID');
    expect(await prisma().appPlan.count()).toBe(0);
    // Without an applicationId the call is the pharmacy's, as before.
    const bare: Record<string, unknown> = planInput({ code: 'old', limits: PHARMACY_LIMITS });
    delete bare.applicationId;
    dataOf(await run(owner, appPlans.upsert, bare));
    expect(await row('pharmacy', 'old')).toMatchObject({ limits: PHARMACY_LIMITS });
  });

  it('a Super Admin who is not the owner cannot write', async () => {
    expect(failure(await run(admin, appPlans.upsert, planInput())).code).toBe('FORBIDDEN');
    expect(failure(await run(admin, appPlans.deactivate, { applicationId: 'retail', code: 'shop', version: 1 })).code).toBe('FORBIDDEN');
    expect(await prisma().appPlan.count()).toBe(0);
  });

  it('appPlansList({applicationId:retail}) lists only retail plans with subscription counts', async () => {
    dataOf(await run(owner, appPlans.upsert, planInput()));
    dataOf(await run(owner, appPlans.upsert, planInput({ applicationId: 'pharmacy', code: 'starter', limits: PHARMACY_LIMITS })));
    dataOf(await run(owner, billing.setPrices, price('retail', 'shop')));
    const shop = await pharmacy('Shop', { sector: 'RETAIL', subscription: 'none' });
    dataOf(await run(owner, billing.startTrial, trial(shop.id, 'retail', 'shop')));

    const retail = dataOf(await runQuery(prisma(), admin, appPlansList, { applicationId: 'retail' }));
    expect(retail.canEdit).toBe(false);
    expect(retail.plans).toHaveLength(1);
    expect(retail.plans[0]).toMatchObject({ code: 'shop', limits: LIMITS, subscriptions: 1 });
    const pharmacies = dataOf(await runQuery(prisma(), admin, appPlansList, {}));
    expect(pharmacies.plans.map((plan) => plan.code)).toEqual(['starter']);
    expect(pharmacies.plans[0]).toMatchObject({ limits: PHARMACY_LIMITS, subscriptions: 0 });
  });

  it('startTrial on a RETAIL business with a retail plan succeeds', async () => {
    const shop = await pharmacy('Shop', { sector: 'RETAIL', subscription: 'none' });
    dataOf(await run(owner, appPlans.upsert, planInput()));
    dataOf(await run(owner, billing.setPrices, price('retail', 'shop')));
    dataOf(await run(owner, billing.startTrial, trial(shop.id, 'retail', 'shop')));
    expect(await prisma().subscription.findFirstOrThrow({ where: { restaurantId: shop.id } })).toMatchObject({ applicationId: 'retail', planCode: 'shop', status: 'TRIAL' });
    const overview = dataOf(await runQuery(prisma(), owner, billingOverview, {}));
    expect(overview.applications.find((a) => a.id === 'retail')?.plans.map((p) => p.code)).toEqual(['shop']);
  });

  it('startTrial on a RETAIL business with pharmacy, cashier or menu is WRONG_SECTOR, and retail is refused for the other sectors', async () => {
    const shop = await pharmacy('Shop', { sector: 'RETAIL', subscription: 'none' });
    const chemist = await pharmacy('Chemist', { sector: 'PHARMACY', subscription: 'none' });
    const cafe = await pharmacy('Cafe', { sector: 'FOOD', subscription: 'none' });
    dataOf(await run(owner, appPlans.upsert, planInput()));
    dataOf(await run(owner, appPlans.upsert, planInput({ applicationId: 'pharmacy', code: 'starter', limits: PHARMACY_LIMITS })));
    dataOf(await run(owner, billing.setPrices, price('retail', 'shop')));
    for (const [restaurantId, applicationId, planCode] of [
      [shop.id, 'pharmacy', 'starter'],
      [shop.id, 'cashier', 'PRO'],
      [shop.id, 'menu', 'PRO'],
      [chemist.id, 'retail', 'shop'],
      [cafe.id, 'retail', 'shop'],
    ] as const) {
      expect(await run(owner, billing.startTrial, trial(restaurantId, applicationId, planCode))).toMatchObject({
        ok: false,
        error: { code: 'CONFLICT', message: WRONG_SECTOR },
      });
    }
    expect(await prisma().subscription.count()).toBe(0);
  });
});
