import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkCreation,
  checkLimit,
  countActiveStaff,
  limitsOf,
  pharmacyLimitsSchema,
  type PharmacyLimits,
} from '@/server/domain/pharmacy/limits';
import * as restaurants from '@/server/studio/actions/restaurants';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import type { ActionResult } from '@/server/studio/framework/result';
import { NOW, person, pharmacy, prisma, resetWorld, useTestDatabase } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const META = { ip: '203.0.113.7', userAgent: 'vitest' };

const ROOMY: PharmacyLimits = { branches: 5, users: 5, storageMb: 100, aiMonthlyBudgetMinor: 0 };
const NONE: PharmacyLimits = { branches: 0, users: 0, storageMb: 0, aiMonthlyBudgetMinor: 0 };

const run = <I, O>(actor: Actor, def: ActionDef<I, O>, input: unknown) => runAction(prisma(), actor, def, input, META);
const actorOf = async (userId: string) => (await loadActor(prisma(), userId)) as Actor;
const failure = <T>(result: ActionResult<T>) => {
  if (result.ok) throw new Error('expected a refusal');
  return result.error;
};

/** The plan the fixture's subscriptions are on (`standard`), with the limits given. */
async function plan(limits: unknown): Promise<void> {
  await prisma().appPlan.upsert({
    where: { applicationId_code: { applicationId: 'pharmacy', code: 'standard' } },
    create: { applicationId: 'pharmacy', code: 'standard', name: { en: 'Standard', ar: 'قياسية', ckb: 'ستاندارد' }, limits: limits as object },
    update: { limits: limits as object },
  });
}

const branchCount = (restaurantId: string) => prisma().branch.count({ where: { restaurantId } });

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
  admin = await actorOf((await person('root', { superAdmin: true })).userId);
});

describe('pharmacy limits', () => {
  it('limits of zero mean none left', () => {
    expect(checkLimit('branches', 0, NONE)).toEqual({ ok: false, code: 'LIMIT_REACHED', limit: 0 });
    expect(checkLimit('users', 0, NONE)).toEqual({ ok: false, code: 'LIMIT_REACHED', limit: 0 });
    expect(checkLimit('branches', 0, { ...NONE, branches: 1 })).toEqual({ ok: true });
  });

  it('a negative or fractional limit is refused', () => {
    expect(pharmacyLimitsSchema.safeParse(ROOMY).success).toBe(true);
    for (const bad of [-1, 1.5, Number.NaN, '3', null]) {
      expect(pharmacyLimitsSchema.safeParse({ ...ROOMY, branches: bad }).success, String(bad)).toBe(false);
      expect(pharmacyLimitsSchema.safeParse({ ...ROOMY, aiMonthlyBudgetMinor: bad }).success, String(bad)).toBe(false);
    }
    expect(pharmacyLimitsSchema.safeParse({ branches: 1, users: 1, storageMb: 1 }).success).toBe(false);
  });

  it('adding the (limit+1)th branch is refused with LIMIT_REACHED and the limit', async () => {
    await plan({ ...ROOMY, branches: 2 });
    const { id } = await pharmacy('Limited', { branches: 1 });

    const second = await run(admin, restaurants.createBranch, { restaurantId: id, name: 'Second' });
    expect(second.ok).toBe(true);
    const third = failure(await run(admin, restaurants.createBranch, { restaurantId: id, name: 'Third' }));
    expect(third).toMatchObject({ code: 'CONFLICT', fields: { limitCode: 'LIMIT_REACHED', limitKind: 'branches', limit: '2' } });
    expect(await branchCount(id)).toBe(2);
  });

  it('staff limit counts only active staff', async () => {
    await plan({ ...ROOMY, users: 2 });
    const { id, branchId } = await pharmacy('Staffed');
    for (const label of ['pharmacist-a', 'pharmacist-b']) await person(label, { staff: [id, 'PHARMACIST', [branchId]] });
    const gone = await person('pharmacist-gone', { staff: [id, 'PHARMACIST', [branchId]] });
    await prisma().phStaff.updateMany({ where: { userId: gone.userId }, data: { deactivatedAt: NOW } });

    expect(await countActiveStaff(prisma(), id)).toBe(2);
    expect(await checkCreation(prisma(), id, 'users', NOW)).toEqual({ ok: false, code: 'LIMIT_REACHED', limit: 2 });
    await plan({ ...ROOMY, users: 3 });
    expect(await checkCreation(prisma(), id, 'users', NOW)).toEqual({ ok: true });
  });

  it('a pharmacy with no live subscription has no limits and creates nothing', async () => {
    await plan(ROOMY);
    const none = await pharmacy('Unsubscribed', { subscription: 'none' });
    const lapsed = await pharmacy('Lapsed', { subscription: 'EXPIRED', periodEndsInDays: -40 });

    expect(await limitsOf(prisma(), none.id, NOW)).toBeNull();
    expect(await limitsOf(prisma(), lapsed.id, NOW)).toBeNull();
    const refused = failure(await run(admin, restaurants.createBranch, { restaurantId: none.id, name: 'Nope' }));
    expect(refused).toMatchObject({ code: 'CONFLICT', fields: { limitCode: 'NO_PLAN' } });
    expect(await branchCount(none.id)).toBe(1);
    expect(await checkCreation(prisma(), lapsed.id, 'users', NOW)).toMatchObject({ ok: false, code: 'NO_PLAN' });
  });

  it('lowering a limit below current use does not delete anything and blocks further creation', async () => {
    await plan({ ...ROOMY, branches: 3 });
    const { id } = await pharmacy('Shrinking', { branches: 3 });

    await plan({ ...ROOMY, branches: 1 });

    expect(await branchCount(id)).toBe(3);
    const refused = failure(await run(admin, restaurants.createBranch, { restaurantId: id, name: 'Fourth' }));
    expect(refused).toMatchObject({ code: 'CONFLICT', fields: { limitCode: 'LIMIT_REACHED', limit: '1' } });
    expect(await branchCount(id)).toBe(3);
  });

  it('a plan with unreadable limits allows nothing, and a menu business is not limited at all', async () => {
    await plan({});
    const broken = await pharmacy('Broken plan');
    expect(await limitsOf(prisma(), broken.id, NOW)).toBeNull();

    const food = await pharmacy('Cafe', { sector: 'FOOD', subscription: 'none' });
    expect((await run(admin, restaurants.createBranch, { restaurantId: food.id, name: 'Second' })).ok).toBe(true);
  });
});
