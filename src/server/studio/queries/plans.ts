import { z } from 'zod';
import {
  allows,
  FEATURE_KEYS,
  FEATURES,
  lowestPlanWith,
  parseExtras,
  PLAN_TIERS,
  planFollowers,
  plansToStore,
  type FeatureKey,
  type PlanTier,
} from '@/server/domain/entitlements';
import { defineQuery } from '@/server/studio/framework/query';
import { StudioError } from '@/server/studio/framework/result';
import { readPlans, readUpgradeWhatsApp } from '@/server/data/plans';
import { upgradeInfo, type PlanTabView } from '@/server/studio/services/plans';

/** The Plan tab and Settings → Plans (spec: plans and entitlements, sections 8.1 and 8.2). */

const idField = z.string().min(1).max(100);

export const restaurantPlan = defineQuery({
  name: 'plans.forRestaurant',
  permission: 'view',
  input: z.object({ restaurantId: idField }),
  target: (i) => ({ kind: 'restaurant', restaurantId: i.restaurantId }),
  run: async (ctx): Promise<PlanTabView> => {
    if (ctx.restaurantId === null || ctx.plan === null) throw new Error('plans.forRestaurant ran without a restaurant');
    const row = await ctx.db.restaurant.findUnique({ where: { id: ctx.restaurantId }, select: { plan: true, planExtras: true, planNote: true } });
    if (!row) throw new StudioError('NOT_FOUND');
    const { entitlements, plans } = ctx.plan;
    const extras = parseExtras(row.planExtras);
    const upgrade = await upgradeInfo(ctx.db, ctx);
    return {
      plan: row.plan,
      planNames: upgrade.planNames,
      planFeatures: Object.fromEntries(PLAN_TIERS.map((tier) => [tier, FEATURE_KEYS.filter((key) => plans.features[tier].has(key))])) as Record<
        PlanTier,
        FeatureKey[]
      >,
      features: FEATURES.filter((feature) => feature.status === 'live').map((feature) => ({
        key: feature.key,
        area: feature.area,
        allowed: allows(entitlements, feature.key),
        inPlan: plans.features[row.plan].has(feature.key),
        extra: extras[feature.key] ?? null,
        lowestPlan: lowestPlanWith(plans, feature.key),
      })),
      note: ctx.actor.isSuperAdmin ? row.planNote : null,
      canEdit: ctx.permissions.has('plans.manage'),
      upgrade,
    };
  },
});

export const getPlans = defineQuery({
  name: 'plans.get',
  permission: 'platform.settings',
  input: z.object({}),
  target: () => ({ kind: 'platform' }),
  run: async (ctx) => {
    const [plans, whatsapp, restaurants] = await Promise.all([
      readPlans(ctx.db),
      readUpgradeWhatsApp(ctx.db),
      ctx.db.restaurant.findMany({ select: { plan: true, planExtras: true } }),
    ]);
    return {
      plans: plansToStore(plans),
      whatsapp: whatsapp ?? '',
      features: FEATURES.map((feature) => ({ ...feature })),
      tiers: [...PLAN_TIERS],
      // How many restaurants a switch turned off would take a feature from, for the question before the save.
      followers: planFollowers(restaurants.map((row) => ({ plan: row.plan, extras: parseExtras(row.planExtras) }))),
      canEdit: ctx.permissions.has('plans.manage'),
    };
  },
});
