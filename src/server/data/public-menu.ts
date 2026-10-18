import type { PrismaClient } from '@/generated/prisma/client';
import type { Locale } from '@/lib/locale';
import { allows, parsePlans, type Entitlements, type Plans } from '@/server/domain/entitlements';
import { clampBrandView, guestFeatures } from '@/server/domain/plan-choices';
import { parseSnapshot, toCatalog, type MenuSnapshot } from '@/server/domain/snapshot';
import type { Catalog } from '@/server/domain/types';
import { cachedLiveOverlay, cachedPlans, cachedRevisionSnapshot, cachedSlugResolution } from './cache';
import { loadOverlay } from './live';
import { entitlementsOf, readPlansSetting } from './plans';
import { getPrisma } from './prisma';
import { menuDb } from './tenant-db';
import type { TenantInfo } from './tenant';

/**
 * What a public slug opens. `live`: the menu's live revision. `redirect`: a slug the menu used to have; `slug` is the
 * current one. `unavailable`: the menu or its restaurant is suspended or archived, so guests get a neutral page in the
 * menu's languages. `missing`: no such slug, a deleted menu, or a menu that has never been published.
 */
export type PublicMenuResult =
  | { kind: 'live'; tenant: TenantInfo }
  | { kind: 'redirect'; slug: string; tenant: TenantInfo }
  | { kind: 'unavailable'; name: string; defaultLocale: Locale; locales: Locale[] }
  | { kind: 'missing' };

/** Slug syntax (lowercase letters, digits and hyphens, up to 48), checked before anything reaches the database. */
const SLUG = /^[a-z0-9][a-z0-9-]{0,47}$/;

const MISSING: PublicMenuResult = { kind: 'missing' };

/** A revision's snapshot, read through the menu's scoped client so it can only be one of that menu's revisions. */
async function loadRevisionSnapshot(prisma: PrismaClient, menuId: string, revisionId: string): Promise<MenuSnapshot> {
  const revision = await menuDb(prisma, menuId).menuRevision.findUniqueOrThrow({
    where: { id: revisionId },
    select: { snapshot: true },
  });
  return parseSnapshot(revision.snapshot);
}

/**
 * A menu as guests get it, from one of its snapshots (the live revision's, or for the Studio's preview the draft's) and
 * its restaurant's entitlements: the brand kit with the plan's fallbacks applied and the guest features it may show. The
 * snapshot itself is not changed, so a plan never touches a revision or its hash.
 */
export function tenantInfo(
  menu: { id: string; slug: string; restaurantId: string },
  revisionId: string,
  snapshot: MenuSnapshot,
  entitlements: Entitlements,
): TenantInfo {
  const settings = snapshot.menu;
  return {
    id: menu.id,
    restaurantId: menu.restaurantId,
    revisionId,
    slug: menu.slug,
    name: settings.displayName,
    currency: settings.currency,
    defaultLocale: settings.defaultLocale,
    locales: settings.locales,
    timeZone: settings.timeZone,
    numeralSystem: settings.numeralSystem,
    engineConfig: settings.engineConfig,
    brand: clampBrandView(snapshot.brand, entitlements),
    seo: settings.seo,
    features: guestFeatures(entitlements),
    motions: allows(entitlements, 'design.menuMotions') ? (snapshot.motions ?? []) : [],
  };
}

/**
 * Resolves a slug without the cache. The slug, the menu's status and its restaurant's status are read live; the name,
 * settings and brand come from the live revision.
 */
async function findPublicMenu(prisma: PrismaClient, slug: string): Promise<PublicMenuResult> {
  if (!SLUG.test(slug)) return MISSING;
  const entry = await prisma.menuSlug.findUnique({
    where: { slug },
    select: {
      menu: {
        select: {
          id: true,
          slug: true,
          status: true,
          restaurantId: true,
          liveRevisionId: true,
          restaurant: { select: { status: true, plan: true, planExtras: true } },
        },
      },
    },
  });
  const menu = entry?.menu;
  // A tombstone (the menu was deleted), or a menu that has never been published.
  if (!menu?.liveRevisionId) return MISSING;

  const snapshot = await loadRevisionSnapshot(prisma, menu.id, menu.liveRevisionId);
  // Only a published menu of an active restaurant is served. A draft never has a live revision, since publishing
  // makes it PUBLISHED, so this leaves suspended and archived menus and restaurants.
  if (menu.status !== 'PUBLISHED' || menu.restaurant.status !== 'ACTIVE') {
    const { displayName, defaultLocale, locales } = snapshot.menu;
    return { kind: 'unavailable', name: displayName, defaultLocale, locales };
  }

  // The plan is read live, like the statuses: a change of plan reaches guests without a publish.
  const plans = await livePlans(prisma);
  const tenant = tenantInfo(menu, menu.liveRevisionId, snapshot, entitlementsOf(menu.restaurant, plans));
  return menu.slug === slug ? { kind: 'live', tenant } : { kind: 'redirect', slug: menu.slug, tenant };
}

/**
 * The plans for the guest pages, from the data cache (at most 5 minutes old; `expirePlans` expires them). The cache
 * keeps the stored setting, which is JSON, and the plans are parsed from it on every read.
 */
export async function livePlans(prisma: PrismaClient): Promise<Plans> {
  return parsePlans(await cachedPlans(() => readPlansSetting(prisma)));
}

/** What a public slug opens, from the data cache (at most 5 minutes old; `expireMenu` expires it). */
export function resolvePublicMenu(slug: string): Promise<PublicMenuResult> {
  if (!SLUG.test(slug)) return Promise.resolve(MISSING);
  return cachedSlugResolution(slug, () => findPublicMenu(getPrisma(), slug));
}

/**
 * The menu a slug serves, or null when it serves none. A former slug still gives the menu, so carts and links made
 * before a rename keep pricing; pages redirect instead (`resolvePublicMenu`).
 */
export async function getTenant(slug: string): Promise<TenantInfo | null> {
  const result = await resolvePublicMenu(slug);
  return result.kind === 'live' || result.kind === 'redirect' ? result.tenant : null;
}

/**
 * The catalog guests are served and priced against: the tenant's live revision with today's availability laid over
 * it. Hidden products never come through (`toCatalog` removes them with the bundles and rules that name them).
 */
export async function getCatalog(tenant: TenantInfo): Promise<Catalog> {
  const { id: menuId, revisionId } = tenant;
  const [snapshot, overlay] = await Promise.all([
    cachedRevisionSnapshot(menuId, revisionId, () => loadRevisionSnapshot(getPrisma(), menuId, revisionId)),
    cachedLiveOverlay(menuId, () => loadOverlay(menuDb(getPrisma(), menuId), menuId)),
  ]);
  const catalog = toCatalog(menuId, snapshot, overlay);
  // Without smart selling there are no offers, pairings or bundles: suggestions are empty, and a bundle already in a
  // cart is priced as one that is no longer offered.
  return tenant.features.smartSelling ? catalog : { ...catalog, upsellRules: [], pairingRules: [], bundles: [] };
}
