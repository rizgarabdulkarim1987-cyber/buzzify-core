import type { Actor } from '@/server/studio/auth/actor';
import type { SpaceId } from '@/studio/spaces';

/** The icon a navigation item shows; the sidebar maps each name to its drawing. */
export type NavIcon = 'overview' | 'restaurants' | 'billing' | 'menus' | 'media' | 'motion' | 'people' | 'announcements' | 'activity' | 'settings' | 'store' | 'pharmacy';

export type NavKey = 'overview' | 'restaurants' | 'billing' | 'menus' | 'media' | 'motion' | 'people' | 'announcements' | 'platformIntro' | 'activity' | 'settings' | 'myRestaurant' | 'myMenu' | 'cashier' | 'cashierOverview' | 'pharmacies' | 'pharmacyOverview' | 'pharmacyBilling' | 'pharmacyPeople' | 'pharmacyAnnouncements' | 'pharmacyActivity' | 'pharmacySettings' | 'team' | 'teamSettings';

export interface NavItem {
  key: NavKey;
  href: string;
  /** The message that names the item. */
  labelKey: string;
  /** A name to show instead of the message: an owner of several restaurants sees each by its name. */
  label?: string;
  icon: NavIcon;
  /** Only this exact path marks the item as the current one (Overview, whose path starts every other). */
  exact?: boolean;
  /** Further paths that are this item's own pages: an owner's restaurant and its menus. */
  match?: string[];
  /** Paths under `match` that belong to a neighbouring item, so they do not mark this one. */
  exclude?: string[];
  /** A restaurant's name to append to the label when an owner of several restaurants has the same item for each. */
  scope?: string;
}

/** The Studio's areas in the order the sidebar lists them. */
export const NAV_ITEMS: readonly NavItem[] = [
  { key: 'overview', href: '/studio', labelKey: 'nav.overview', icon: 'overview', exact: true },
  { key: 'restaurants', href: '/studio/restaurants', labelKey: 'nav.restaurants', icon: 'restaurants' },
  // Every restaurant's subscriptions and last payment (docs/superpowers/plans/2026-10-22-business-core-in-menu.md).
  { key: 'billing', href: '/studio/billing', labelKey: 'nav.billing', icon: 'billing' },
  // The cashier across the platform: who has it, its staff and whether a catalog is set up. The till itself is /pos.
  { key: 'cashierOverview', href: '/studio/cashier', labelKey: 'nav.cashierOverview', icon: 'store' },
  // Every PHARMACY-sector business on the platform; they also stay in Restaurants, where a Super Admin bills them.
  { key: 'pharmacies', href: '/studio/pharmacies', labelKey: 'nav.pharmacies', icon: 'pharmacy' },
  { key: 'menus', href: '/studio/menus', labelKey: 'nav.menus', icon: 'menus' },
  // The libraries a person manages: Super Admins and designers (spec refinement 20); an owner's pictures are picked in the editor.
  { key: 'media', href: '/studio/media', labelKey: 'nav.media', icon: 'media' },
  // The motion library a designer reuses across menus (docs/superpowers/plans/2026-10-18-motion-studio.md).
  { key: 'motion', href: '/studio/motion', labelKey: 'nav.motion', icon: 'motion' },
  { key: 'people', href: '/studio/people', labelKey: 'nav.people', icon: 'people' },
  // What the Buzzify team tells every till and Studio user (docs/superpowers/specs/2026-10-26-staff-appearance-logo-announcements-design.md).
  { key: 'announcements', href: '/studio/announcements', labelKey: 'nav.announcements', icon: 'announcements' },
  // The default background and adverts of every menu's intro page, and their report.
  { key: 'platformIntro', href: '/studio/platform/intro', labelKey: 'nav.platformIntro', icon: 'media' },
  { key: 'activity', href: '/studio/activity', labelKey: 'nav.activity', icon: 'activity' },
  { key: 'settings', href: '/studio/settings', labelKey: 'nav.settings', icon: 'settings' },
];

const entry = (key: NavKey, href: string, labelKey: string, icon: NavIcon, extra: Partial<NavItem> = {}): NavItem => ({ key, href, labelKey, icon, ...extra });

/**
 * The navigation of one closed space of a Super Admin (docs/superpowers/specs/2026-10-31-super-admin-project-hub-design.md):
 * only that project's pages, so nothing of another project shows beside them. Menu and Cashier keeps the Studio's own
 * paths; the Pharmacy and the Platform have their own prefixes (`src/studio/spaces.ts`).
 */
export function spaceNav(space: SpaceId): NavItem[] {
  switch (space) {
    case 'food':
      return [
        entry('overview', '/studio/overview', 'nav.overview', 'overview', { exact: true }),
        ...NAV_ITEMS.filter((item) => item.key !== 'overview' && item.key !== 'pharmacies').map((item) => ({ ...item })),
      ];
    case 'pharmacy':
      return [
        entry('pharmacyOverview', '/studio/pharmacy/overview', 'nav.overview', 'overview', { exact: true }),
        entry('pharmacies', '/studio/pharmacy', 'nav.pharmacies', 'pharmacy', {
          // Its own pages are everything under the prefix that the neighbouring items do not claim: new, and one pharmacy's tabs.
          exclude: ['overview', 'billing', 'people', 'announcements', 'activity', 'settings'].map((page) => `/studio/pharmacy/${page}`),
        }),
        entry('pharmacyBilling', '/studio/pharmacy/billing', 'nav.billing', 'billing'),
        entry('pharmacyPeople', '/studio/pharmacy/people', 'nav.people', 'people'),
        entry('pharmacyAnnouncements', '/studio/pharmacy/announcements', 'nav.announcements', 'announcements'),
        entry('pharmacyActivity', '/studio/pharmacy/activity', 'nav.activity', 'activity'),
        entry('pharmacySettings', '/studio/pharmacy/settings', 'nav.settings', 'settings'),
      ];
    case 'platform':
      return [entry('team', '/studio/team', 'nav.team', 'people', { exact: true }), entry('teamSettings', '/studio/team/settings', 'nav.teamSettings', 'settings')];
  }
}

/**
 * Areas only Super Admins have. The People page reads every account on the platform, which only they may; an owner
 * allowed to invite does that from their restaurant's People tab. Billing, Activity and Settings need `platform.settings`
 * or `audit.view`, which no client policy can grant.
 */
const SUPER_ADMIN_AREAS: ReadonlySet<NavKey> = new Set<NavKey>(['billing', 'cashierOverview', 'pharmacies', 'people', 'announcements', 'platformIntro', 'activity', 'settings']);

/** What the navigation needs to know about a restaurant an owner holds: its name and its menus. */
export interface OwnedRestaurant {
  id: string;
  name: string;
  menuIds: string[];
}

/** Whether the person works in the Studio only as the owner of one or more restaurants. */
export function isOwnerOnly(actor: Actor): boolean {
  return !actor.isSuperAdmin && actor.memberships.length > 0 && actor.memberships.every((m) => m.role === 'OWNER');
}

/**
 * The navigation a person sees: only what exists for them and what they may use. A Super Admin sees every area; a
 * designer (or staff not yet assigned to a client) sees the working areas, scoped to their restaurants by the pages;
 * an owner sees only their restaurant, or its menu when it has exactly one. `owned` tells the menus of an owner's
 * restaurants; without it an owner's item links to the restaurant.
 */
export function visibleNav(actor: Actor, owned: readonly OwnedRestaurant[] = []): NavItem[] {
  if (!isOwnerOnly(actor)) {
    return NAV_ITEMS.filter((item) => actor.isSuperAdmin || !SUPER_ADMIN_AREAS.has(item.key)).map((item) => ({ ...item }));
  }

  const ids = [...new Set(actor.memberships.map((m) => m.restaurantId))];
  const several = ids.length > 1;
  return ids.flatMap((id): NavItem[] => {
    const known = owned.find((restaurant) => restaurant.id === id);
    const menuIds = known?.menuIds ?? [];
    const restaurantPath = `/studio/restaurants/${id}`;
    const menusPath = `${restaurantPath}/menus`;
    const name = several && known ? known.name : undefined;
    // Two items so the owner reaches the restaurant's own pages without going back through the menu: the restaurant
    // (profile, branches, plan...) and the menu's settings. One menu opens at once; otherwise the Menus tab does.
    return [
      {
        key: 'myRestaurant',
        href: restaurantPath,
        labelKey: 'nav.myRestaurant',
        ...(name ? { label: name } : {}),
        icon: 'store',
        match: [restaurantPath],
        // The Menus tab belongs to the menu item below.
        exclude: [menusPath],
      },
      {
        key: 'myMenu',
        href: !several && menuIds.length === 1 ? `/studio/menus/${menuIds[0]}` : menusPath,
        labelKey: 'nav.myMenu',
        ...(name ? { scope: name } : {}),
        icon: 'menus',
        match: [menusPath, ...menuIds.map((menuId) => `/studio/menus/${menuId}`)],
      },
    ];
  });
}

/**
 * Where an owner of one restaurant goes when they open the Studio: the same place their navigation item points at (their
 * menu when it has exactly one, else the restaurant's Menus tab). Null for anyone else, and for an owner of several
 * restaurants, who has no single place: their Overview lists the restaurants.
 */
export function landingPath(actor: Actor, owned: readonly OwnedRestaurant[]): string | null {
  if (!isOwnerOnly(actor) || new Set(actor.memberships.map((m) => m.restaurantId)).size !== 1) return null;
  return visibleNav(actor, owned).find((item) => item.key === 'myMenu')?.href ?? null;
}

const within = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

/** Whether `pathname` is one of the item's pages, for marking the current item. */
export function isNavItemActive(item: Pick<NavItem, 'href' | 'exact' | 'match' | 'exclude'>, pathname: string): boolean {
  if (item.exact) return pathname === item.href;
  if (item.exclude?.some((path) => within(pathname, path))) return false;
  return [item.href, ...(item.match ?? [])].some((path) => within(pathname, path));
}

/** The one item that leads from the Studio to the till; the shell adds it only for a person with a till (`getPosAccess`). */
export function posNavItem(): NavItem {
  return { key: 'cashier', href: '/pos', labelKey: 'nav.cashier', icon: 'store' };
}

/** A Studio, till or pharmacy path of plain segments: what a `next` parameter may name. No query, no `..`, no other host. */
const STUDIO_PATH = /^\/(?:studio|pos|pharmacy)(?:\/[A-Za-z0-9_-]+)*$/;

/**
 * The page to return to after signing in, from an untrusted `next` parameter: a Studio path, or null for anything else,
 * so a link cannot send a person who signs in to another site.
 */
export function safeNextPath(value: string | string[] | null | undefined): string | null {
  return typeof value === 'string' && STUDIO_PATH.test(value) ? value : null;
}
