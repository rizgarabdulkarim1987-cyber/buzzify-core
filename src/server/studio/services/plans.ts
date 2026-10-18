import type { PrismaClient } from '@/generated/prisma/client';
import { readUpgradeWhatsApp } from '@/server/data/plans';
import { allows, FEATURE_KEYS, lowestPlanWith, PLAN_TIERS, type FeatureArea, type FeatureKey, type PlanTier } from '@/server/domain/entitlements';
import type { Actor } from '@/server/studio/auth/actor';
import type { PlanAccess } from '@/server/studio/framework/plan';

/**
 * What the Studio's screens show about plans (spec: plans and entitlements, section 8): the upgrade hint's data and the
 * Plan tab. Reading the plans and a restaurant's entitlements is `src/server/data/plans.ts`, shared with the guest pages.
 */

/**
 * What a screen needs to show the upgrade hint (spec 8.3): the restaurant, the platform owner's WhatsApp number, whether
 * the reader is the platform owner (who gets "Change plan" instead), the plans' names in the reader's language, what the
 * restaurant has, and the lowest plan with each feature it lacks.
 */
export interface UpgradeInfo {
  restaurantId: string;
  restaurantName: string;
  whatsapp: string | null;
  isOwner: boolean;
  planNames: Record<PlanTier, string>;
  allowed: FeatureKey[];
  lowest: Partial<Record<FeatureKey, PlanTier>>;
  planTabHref: string;
}

/** One live feature on the Plan tab. */
export interface PlanTabFeature {
  key: FeatureKey;
  area: FeatureArea;
  /** Whether the restaurant has it now: its plan's, with its extra laid over. */
  allowed: boolean;
  /** Whether its plan includes it. */
  inPlan: boolean;
  /** The extra for this restaurant: on, off, or null for "as the plan". */
  extra: boolean | null;
  lowestPlan: PlanTier | null;
  /** Every plan that includes it, for showing what another plan would change before it is saved. */
  plans: PlanTier[];
}

/** What the Plan tab shows (`plans.forRestaurant`). */
export interface PlanTabView {
  plan: PlanTier;
  planNames: Record<PlanTier, string>;
  /** The live features, in catalog order. */
  features: PlanTabFeature[];
  /** The platform owner's note: for Super Admins only, null for everyone else. */
  note: string | null;
  canEdit: boolean;
  upgrade: UpgradeInfo;
}

/** The upgrade hint's data for a query on a restaurant or one of its menus. */
export async function upgradeInfo(db: PrismaClient, ctx: { actor: Actor; restaurantId: string | null; plan: PlanAccess | null }): Promise<UpgradeInfo> {
  if (ctx.restaurantId === null || ctx.plan === null) throw new Error('upgradeInfo needs a restaurant or menu target');
  const { entitlements, plans } = ctx.plan;
  const [restaurant, whatsapp] = await Promise.all([
    db.restaurant.findUniqueOrThrow({ where: { id: ctx.restaurantId }, select: { name: true } }),
    readUpgradeWhatsApp(db),
  ]);
  const lowest: Partial<Record<FeatureKey, PlanTier>> = {};
  for (const key of FEATURE_KEYS) {
    const plan = allows(entitlements, key) ? null : lowestPlanWith(plans, key);
    if (plan) lowest[key] = plan;
  }
  return {
    restaurantId: ctx.restaurantId,
    restaurantName: restaurant.name,
    whatsapp,
    isOwner: ctx.actor.isPlatformOwner,
    planNames: Object.fromEntries(PLAN_TIERS.map((tier) => [tier, plans.names[tier][ctx.actor.locale]])) as Record<PlanTier, string>,
    allowed: FEATURE_KEYS.filter((key) => allows(entitlements, key)),
    lowest,
    planTabHref: `/studio/restaurants/${ctx.restaurantId}/plan`,
  };
}
