import { effectiveEntitlements, parseExtras, parsePlans, type Entitlements, type Plans, type PlanTier } from '@/server/domain/entitlements';
import { delegates, type AnyDb, type ScopedDb } from './tenant-db';

/**
 * Reading what restaurants have bought (spec: plans and entitlements, section 5), for the guest pages and the Studio
 * alike: the plans the platform owner set (the `plans` platform setting, over the catalog's defaults), the owner's
 * WhatsApp number for upgrades, and one restaurant's entitlements. The settings table is global, so any client reads it,
 * a scoped transaction included.
 */

export const PLANS_SETTING = 'plans';
export const UPGRADE_WHATSAPP_SETTING = 'upgradeWhatsApp';

/** The plans as the platform owner set them, the catalog's defaults for anything they have not. */
export function readPlans(db: AnyDb): Promise<Plans>;
export function readPlans(db: ScopedDb): Promise<Plans>;
export async function readPlans(client: AnyDb | ScopedDb): Promise<Plans> {
  return parsePlans(await readPlansSetting(delegates(client)));
}

/**
 * The `plans` setting as stored (JSON, or null when the owner has not set it): what the data cache can keep, since
 * `Plans` holds Sets that JSON cannot. `parsePlans` turns it into the plans.
 */
export function readPlansSetting(db: AnyDb): Promise<unknown>;
export function readPlansSetting(db: ScopedDb): Promise<unknown>;
export async function readPlansSetting(client: AnyDb | ScopedDb): Promise<unknown> {
  const row = await delegates(client).platformSetting.findUnique({ where: { key: PLANS_SETTING }, select: { value: true } });
  return row?.value ?? null;
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
