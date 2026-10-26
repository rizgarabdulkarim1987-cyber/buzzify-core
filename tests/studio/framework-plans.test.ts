import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { FeatureKey } from '@/server/domain/entitlements';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { defineAction, runAction } from '@/server/studio/framework/action';
import { requireFeature } from '@/server/studio/framework/plan';
import { defineQuery, runQuery } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import { createMenuFixture, resetTestData, testPrisma } from '../helpers/db';

const prisma = testPrisma();
const META = { ip: '203.0.113.7', userAgent: 'vitest' };

const failureOf = (result: ActionResult<unknown>) => {
  if (result.ok) throw new Error(`expected a failure, got ${JSON.stringify(result.data)}`);
  return result.error;
};

const atRestaurant = (input: { restaurantId: string }) => ({ kind: 'restaurant' as const, restaurantId: input.restaurantId });

/** An action that needs a font pair beyond the basic two, the way the brand save will. */
const gated = defineAction({
  name: 'test.gated',
  permission: 'brand.edit',
  feature: 'design.fontPairs',
  input: z.object({ restaurantId: z.string() }),
  target: atRestaurant,
  run: async (ctx) => ({ plan: ctx.plan?.entitlements.plan ?? null }),
});

/** An action whose need depends on its input, checked in the handler. */
const chooses = defineAction({
  name: 'test.chooses',
  permission: 'brand.edit',
  input: z.object({ restaurantId: z.string(), feature: z.string() }),
  target: atRestaurant,
  run: async (ctx, input) => {
    requireFeature(ctx.plan, input.feature as FeatureKey);
    return { ok: true };
  },
});

const gatedQuery = defineQuery({
  name: 'test.gatedQuery',
  permission: 'view',
  feature: 'immersive.explore',
  input: z.object({ restaurantId: z.string() }),
  target: atRestaurant,
  run: async (ctx) => ({ features: [...(ctx.plan?.entitlements.features ?? [])].length }),
});

describe('plans in the Studio framework', () => {
  let a: Awaited<ReturnType<typeof createMenuFixture>>;
  let designer: Actor;
  let owner: Actor;

  const setPlan = (plan: 'BASIC' | 'PRO' | 'PREMIUM', planExtras: object = {}) =>
    prisma.restaurant.update({ where: { id: a.restaurant.id }, data: { plan, planExtras } });

  beforeEach(async () => {
    await resetTestData(prisma);
    a = await createMenuFixture(prisma, 'plans-fw', { publish: false });
    for (const [id, role] of [['designer-p', 'DESIGNER'], ['owner-p', 'OWNER']] as const) {
      await prisma.user.create({ data: { id, name: id, email: `${id}@example.com` } });
      await prisma.membership.create({ data: { userId: id, restaurantId: a.restaurant.id, role } });
    }
    designer = (await loadActor(prisma, 'designer-p'))!;
    owner = (await loadActor(prisma, 'owner-p'))!;
  });

  afterAll(async () => {
    await resetTestData(prisma);
    await prisma.$disconnect();
  });

  it('refuses a feature the restaurant lacks, naming the lowest plan with it', async () => {
    await setPlan('BASIC');
    expect(failureOf(await runAction(prisma, designer, gated, { restaurantId: a.restaurant.id }, META))).toMatchObject({
      code: 'UPGRADE_REQUIRED',
      upgrade: { feature: 'design.fontPairs', plan: 'PRO' },
    });
  });

  it('runs it on a plan that has it, with the plan in the context', async () => {
    await setPlan('PRO');
    expect(await runAction(prisma, designer, gated, { restaurantId: a.restaurant.id }, META)).toEqual({ ok: true, data: { plan: 'PRO' } });
  });

  it('checks the permission first', async () => {
    await setPlan('BASIC');
    expect(failureOf(await runAction(prisma, owner, gated, { restaurantId: a.restaurant.id }, META)).code).toBe('FORBIDDEN');
  });

  it('honours an extra over the plan', async () => {
    await setPlan('BASIC', { features: { 'design.fontPairs': true } });
    expect((await runAction(prisma, designer, gated, { restaurantId: a.restaurant.id }, META)).ok).toBe(true);
    await setPlan('PREMIUM', { features: { 'design.fontPairs': false } });
    expect(failureOf(await runAction(prisma, designer, gated, { restaurantId: a.restaurant.id }, META)).code).toBe('UPGRADE_REQUIRED');
  });

  it('reads the plans the platform owner set', async () => {
    await setPlan('BASIC');
    await prisma.platformSetting.create({ data: { key: 'plans', value: { BASIC: { features: { 'design.fontPairs': true } } } } });
    expect((await runAction(prisma, designer, gated, { restaurantId: a.restaurant.id }, META)).ok).toBe(true);
  });

  it('lets a handler refuse a feature its input asks for, through one helper', async () => {
    await setPlan('PRO');
    expect(failureOf(await runAction(prisma, designer, chooses, { restaurantId: a.restaurant.id, feature: 'immersive.stage' }, META))).toMatchObject({
      code: 'UPGRADE_REQUIRED',
      message: 'This is not part of this restaurant’s plan',
      upgrade: { feature: 'immersive.stage', plan: 'PREMIUM' },
    });
    expect((await runAction(prisma, designer, chooses, { restaurantId: a.restaurant.id, feature: 'qr.branded' }, META)).ok).toBe(true);
  });

  it('gives queries the plan and refuses their feature the same way', async () => {
    await setPlan('PRO');
    expect(failureOf(await runQuery(prisma, owner, gatedQuery, { restaurantId: a.restaurant.id })).code).toBe('UPGRADE_REQUIRED');
    await setPlan('PREMIUM');
    const result = await runQuery(prisma, owner, gatedQuery, { restaurantId: a.restaurant.id });
    expect(result.ok && result.data.features).toBeGreaterThan(8);
  });

  it('refuses an unknown feature when the definition is made', () => {
    expect(() =>
      defineAction({ name: 'test.unknown', permission: 'brand.edit', feature: 'made.up' as FeatureKey, input: z.object({}), target: () => ({ kind: 'platform' }), run: async () => null }),
    ).toThrow(/unknown feature/);
  });
});
