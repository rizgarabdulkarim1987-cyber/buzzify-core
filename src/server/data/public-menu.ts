import type { PrismaClient } from '@/generated/prisma/client';
import type { Locale } from '@/lib/locale';
import { productRuns, type LifecycleView } from '@/server/domain/billing/subscriptions';
import { allows, parsePlans, type Entitlements, type Plans } from '@/server/domain/entitlements';
import { clampBrandView, guestFeatures, servedCatalog } from '@/server/domain/plan-choices';
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
 * current one. `unavailable`: the menu or its restaurant is suspended or archived, or its Menu subscription has ended,
 * so guests get a neutral page in the menu's languages. `missing`: no such slug, a deleted menu, or a menu that has
 * never been published.
 */
export type PublicMenuResult =
  | { kind: 'live'; tenant: TenantInfo }
  | { kind: 'redirect'; slug: string; tenant: TenantInfo }
  | { kind: 'unavailable'; menuId: string; name: string; defaultLocale: Locale; locales: Locale[] }
  | { kind: 'missing' };

/** What decides whether guests are served, read live on every request (`resolvePublicMenu`). */
const GATE_SELECT = {
  status: true,
  restaurant: {
    select: {
      status: true,
      subscriptions: {
        where: { applicationId: 'menu' },
        select: { status: true, trialEndsAt: true, currentPeriodEnd: true, graceDays: true },
      },
    },
  },
} as const;

type GateView = { status: string; restaurant: { status: string; subscriptions: LifecycleView[] } };

/**
 * Only a published menu of an active restaurant whose Menu subscription still runs is served (grace still serves; no
 * subscription at all serves as before billing). A draft never has a live revision, since publishing makes it
 * PUBLISHED, so this leaves suspended and archived menus and restaurants, and ended subscriptions.
 */
function servesGuests(menu: GateView, now: Date): boolean {
  return menu.status === 'PUBLISHED' && menu.restaurant.status === 'ACTIVE' && productRuns(menu.restaurant.subscriptions, now);
}

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
  menu: { id: string; slug: string; restaurantId: string; feedbackEnabled?: boolean; introEnabled?: boolean; aboutEnabled?: boolean; wheelEnabled?: boolean; dishCountsEnabled?: boolean; about?: { titles: unknown } | null },
  revisionId: string,
  snapshot: MenuSnapshot,
  entitlements: Entitlements,
): TenantInfo {
  const settings = snapshot.menu;
  const features = guestFeatures(entitlements);
  return {
    id: menu.id,
    restaurantId: menu.restaurantId,
    feedbackEnabled: menu.feedbackEnabled ?? true,
    extras: {
      intro: (menu.introEnabled ?? false) && features.intro,
      about: (menu.aboutEnabled ?? false) && features.about,
      wheel: (menu.wheelEnabled ?? false) && features.wheel,
      dishCounts: (menu.dishCountsEnabled ?? false) && features.dishCounts,
      aboutTitle: aboutTitleOf(menu.about?.titles),
    },
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
    features,
    motions: allows(entitlements, 'design.menuMotions') ? (snapshot.motions ?? []) : [],
  };
}

/** The title the restaurant gave its About page, per language; '' where it left one empty. */
function aboutTitleOf(titles: unknown): Record<'en' | 'ar' | 'ckb', string> {
  const stored = typeof titles === 'object' && titles !== null && !Array.isArray(titles) ? (titles as Record<string, unknown>) : {};
  const pick = (locale: string) => (typeof stored[locale] === 'string' ? (stored[locale] as string).trim() : '');
  return { en: pick('en'), ar: pick('ar'), ckb: pick('ckb') };
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
          feedbackEnabled: true,
          introEnabled: true,
          aboutEnabled: true,
          wheelEnabled: true,
          dishCountsEnabled: true,
          about: { select: { titles: true } },
          liveRevisionId: true,
          restaurant: { select: { ...GATE_SELECT.restaurant.select, plan: true, planExtras: true } },
        },
      },
    },
  });
  const menu = entry?.menu;
  // A tombstone (the menu was deleted), or a menu that has never been published.
  if (!menu?.liveRevisionId) return MISSING;

  const snapshot = await loadRevisionSnapshot(prisma, menu.id, menu.liveRevisionId);
  if (!servesGuests(menu, new Date())) {
    const { displayName, defaultLocale, locales } = snapshot.menu;
    return { kind: 'unavailable', menuId: menu.id, name: displayName, defaultLocale, locales };
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

/**
 * What a public slug opens, from the data cache (at most 5 minutes old; `expireMenu` expires it), with whether guests
 * are served read live. Production runs several server processes, and `expireMenu` reaches only the one that ran the
 * Studio action: the others kept a suspended or cancelled menu open, or a restored one closed, for up to ten minutes.
 * So the cached answer is checked against the gate's rows on every request, and a closed answer that is open again is
 * read afresh.
 */
export async function resolvePublicMenu(slug: string): Promise<PublicMenuResult> {
  if (!SLUG.test(slug)) return MISSING;
  const prisma = getPrisma();
  const result = await cachedSlugResolution(slug, () => findPublicMenu(prisma, slug));
  if (result.kind === 'missing') return result;

  const menuId = result.kind === 'unavailable' ? result.menuId : result.tenant.id;
  const gate = await prisma.menu.findUnique({ where: { id: menuId }, select: GATE_SELECT });
  // Deleted since it was cached: its slug is a tombstone now.
  if (!gate) return MISSING;
  const open = servesGuests(gate, new Date());
  if (result.kind === 'unavailable') return open ? findPublicMenu(prisma, slug) : result;
  if (open) return result;
  const { name, defaultLocale, locales } = result.tenant;
  return { kind: 'unavailable', menuId, name, defaultLocale, locales };
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
  return servedCatalog(toCatalog(menuId, snapshot, overlay), tenant.features);
}
