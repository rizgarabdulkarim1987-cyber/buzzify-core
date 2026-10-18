import type { PrismaClient } from '@/generated/prisma/client';
import { delegates, type AnyDb, type ScopedDb } from '@/server/data/tenant-db';
import {
  allows,
  effectiveEntitlements,
  FEATURE_KEYS,
  lowestPlanWith,
  parseExtras,
  parsePlans,
  PLAN_TIERS,
  type Entitlements,
  type FeatureArea,
  type FeatureKey,
  type Plans,
  type PlanTier,
} from '@/server/domain/entitlements';
import type { Actor } from '@/server/studio/auth/actor';
import type { PlanAccess } from '@/server/studio/framework/plan';

/**
 * Reading what restaurants have bought (spec: plans and entitlements, section 5): the plans the platform owner set (the
 * `plans` platform setting, over the catalog's defaults), the owner's WhatsApp number for upgrades, and one restaurant's
 * entitlements. The settings table is global, so any client reads it, a scoped transaction included.
 */

export const PLANS_SETTING = 'plans';
export const UPGRADE_WHATSAPP_SETTING = 'upgradeWhatsApp';

/** The plans as the platform owner set them, the catalog's defaults for anything they have not. */
export function readPlans(db: AnyDb): Promise<Plans>;
export function readPlans(db: ScopedDb): Promise<Plans>;
export async function readPlans(client: AnyDb | ScopedDb): Promise<Plans> {
  const row = await delegates(client).platformSetting.findUnique({ where: { key: PLANS_SETTING }, select: { value: true } });
  return parsePlans(row?.value);
}

/** The digits of the platform owner's WhatsApp number, or null until it is set. */
export function readUpgradeWhatsApp(db: AnyDb): Promise<string | null>;
export function readUpgradeWhatsApp(db: ScopedDb): Promise<string | null>;
export async function readUpgradeWhatsApp(client: AnyDb | ScopedDb): Promise<string | null> {
  const row = await delegates(client).platformSetting.findUnique({ where: { key: UPGRADE_WHATSAPP_SETTING }, select: { value: true } });
  return typeof row?.value === 'string' && /^\d{8,15}$/.test(row.value) ? row.value : null;
}

/** A restaurant's entitlements from its row and the plans. */
export function entitlementsOf(restaurant: { plan: PlanTier; planExtras: unknown }, plans: Plans): Entitlements {
  return effectiveEntitlements({ plan: restaurant.plan, plans, extras: parseExtras(restaurant.planExtras) });
}

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

/** A restaurant's entitlements, read from the database. */
export function entitlementsFor(db: AnyDb, restaurantId: string): Promise<Entitlements>;
export function entitlementsFor(db: ScopedDb, restaurantId: string): Promise<Entitlements>;
export async function entitlementsFor(client: AnyDb | ScopedDb, restaurantId: string): Promise<Entitlements> {
  const db = delegates(client);
  const [restaurant, plans] = await Promise.all([
    db.restaurant.findUniqueOrThrow({ where: { id: restaurantId }, select: { plan: true, planExtras: true } }),
    readPlans(db),
  ]);
  return entitlementsOf(restaurant, plans);
}
