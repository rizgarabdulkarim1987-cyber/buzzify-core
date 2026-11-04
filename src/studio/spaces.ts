import type { BusinessSector } from '@/server/domain/restaurant-profile';
import { DEFAULT_RETAIL_ACTIVITY, type RetailActivity } from '@/server/domain/retail/activity';

/**
 * The Studio's closed spaces for a Super Admin: one per project, each with its own navigation, pages and data. A space is
 * known from the address alone (no cookie), so a deep link, the back button and the current-item mark all agree. Menu and
 * Cashier is the default: every Studio path that no other space claims is its own.
 *
 * Buzzify Retail is three products, each a space of its own with nothing shared on screen: Supermarket, Electronics and
 * Clothing. Their businesses are all of the RETAIL sector; which product a shop is, is its `RetailLink.activity`.
 */

export const RETAIL_SPACE_IDS = ['supermarket', 'electronics', 'clothing'] as const;
export type RetailSpaceId = (typeof RETAIL_SPACE_IDS)[number];

export type SpaceId = 'food' | 'pharmacy' | RetailSpaceId | 'platform';

/** A space that works on businesses: every one but the platform. */
export type BusinessSpaceId = Exclude<SpaceId, 'platform'>;

export interface Space {
  id: SpaceId;
  /** The message that names the space on the hub and in its sidebar. */
  nameKey: string;
  icon: SpaceId;
  /** Where the hub's icon leads. */
  home: string;
  /** The business sectors the space reads and writes; none for the platform. */
  sectors: readonly BusinessSector[];
  /** A Retail product's space: the product its shops are. */
  activity?: RetailActivity;
  /** The address prefix that is this space's; null for the default space. */
  prefix: string | null;
  /** Drawn as a large icon in the middle of the hub; otherwise as a small entry in its corner. */
  big: boolean;
}

const retail = (id: RetailSpaceId, activity: RetailActivity): Space => ({
  id,
  nameKey: `hub.${id}`,
  icon: id,
  home: `/studio/${id}`,
  sectors: ['RETAIL'],
  activity,
  prefix: `/studio/${id}`,
  big: true,
});

export const SPACES: readonly Space[] = [
  { id: 'food', nameKey: 'hub.food', icon: 'food', home: '/studio/overview', sectors: ['FOOD'], prefix: null, big: true },
  { id: 'pharmacy', nameKey: 'hub.pharmacy', icon: 'pharmacy', home: '/studio/pharmacy', sectors: ['PHARMACY'], prefix: '/studio/pharmacy', big: true },
  retail('supermarket', 'SUPERMARKET'),
  retail('electronics', 'ELECTRONICS'),
  retail('clothing', 'CLOTHING'),
  { id: 'platform', nameKey: 'hub.platform', icon: 'platform', home: '/studio/team', sectors: [], prefix: '/studio/team', big: false },
];

export const isRetailSpace = (space: string | null | undefined): space is RetailSpaceId =>
  typeof space === 'string' && (RETAIL_SPACE_IDS as readonly string[]).includes(space);

const within = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

/** The space an address belongs to: the longest prefix that matches whole segments, else the default one. */
export function spaceOfPath(pathname: string, spaces: readonly Space[] = SPACES): SpaceId {
  const claimed = spaces
    .filter((space): space is Space & { prefix: string } => space.prefix !== null && within(pathname, space.prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
  return claimed?.id ?? spaces.find((space) => space.prefix === null)?.id ?? 'food';
}

/** The spaces the hub draws as large icons. */
export function bigSpaces(spaces: readonly Space[] = SPACES): Space[] {
  return spaces.filter((space) => space.big);
}

/** The address base of each space's businesses: its prefix, or Menu and Cashier's restaurants. */
const BUSINESS_BASE: Record<BusinessSpaceId, string> = {
  food: '/studio/restaurants',
  pharmacy: '/studio/pharmacy',
  supermarket: '/studio/supermarket',
  electronics: '/studio/electronics',
  clothing: '/studio/clothing',
};

const ACTIVITY_SPACE: Record<RetailActivity, RetailSpaceId> = { SUPERMARKET: 'supermarket', ELECTRONICS: 'electronics', CLOTHING: 'clothing' };

/** The Retail product's space. */
export const spaceOfActivity = (activity: RetailActivity): RetailSpaceId => ACTIVITY_SPACE[activity];

/**
 * The space of a business: its sector's, and for a RETAIL business its product's. A retail shop whose product is not
 * known (no link) is a supermarket, as every shop made before the three products is.
 */
export function spaceOfBusiness(sector: BusinessSector, activity?: RetailActivity | null): BusinessSpaceId {
  if (sector === 'RETAIL') return spaceOfActivity(activity ?? DEFAULT_RETAIL_ACTIVITY);
  return sector === 'PHARMACY' ? 'pharmacy' : 'food';
}

/** A business's page (and optionally one of its tabs) in the space it belongs to. */
export function businessPath(space: BusinessSpaceId, id: string, tab?: string): string {
  const base = `${BUSINESS_BASE[space]}/${id}`;
  return tab ? `${base}/${tab}` : base;
}

/** The address base of a business space's businesses, which is also where its list lives. */
export function businessBase(space: BusinessSpaceId): string {
  return BUSINESS_BASE[space];
}

/** The one sector a business space works on; null for the platform. */
export function sectorOfSpace(space: SpaceId): BusinessSector | null {
  return SPACES.find((entry) => entry.id === space)?.sectors[0] ?? null;
}

/** The Retail product a space works on; null for every other space. */
export function activityOfSpace(space: SpaceId): RetailActivity | null {
  return SPACES.find((entry) => entry.id === space)?.activity ?? null;
}

/**
 * Where the old Menu and Cashier address of a business of another space now lives: the same tab under that space's
 * prefix. Null when the path is not that business's own (another id, another prefix), and for a food business.
 */
export function movedBusinessAddressOf(pathname: string, id: string, space: BusinessSpaceId): string | null {
  const old = `/studio/restaurants/${id}`;
  if (space === 'food' || !within(pathname, old)) return null;
  const rest = pathname.slice(old.length).replace(/\/+$/, '');
  return `${BUSINESS_BASE[space]}/${id}${rest}`;
}

/** Where the old Menu and Cashier address of a pharmacy now lives: the same tab under /studio/pharmacy. */
export function pharmacyAddressOf(pathname: string, id: string): string | null {
  return movedBusinessAddressOf(pathname, id, 'pharmacy');
}

/** The old single Retail space's prefix. Its sign-in handoff routes (`RETAIL_HANDOFF` in nav.ts) still live under it. */
export const OLD_RETAIL_PREFIX = '/studio/retail';

/**
 * Where an address of the old single Retail space now lives: the same page in the Supermarket, every shop of that time
 * being one (a shop of another product is moved on to its own space by its page). Null for an address that is not the
 * old space's, and for the sign-in handoff's (`handoff`), which stay where they are.
 */
export function oldRetailAddressOf(pathname: string, handoff: readonly string[]): string | null {
  if (!within(pathname, OLD_RETAIL_PREFIX)) return null;
  const rest = pathname.slice(OLD_RETAIL_PREFIX.length).replace(/\/+$/, '');
  const first = rest.split('/')[1];
  if (first !== undefined && handoff.includes(first)) return null;
  return `${BUSINESS_BASE.supermarket}${rest}`;
}

/**
 * The same page in another Retail product's space: a shop opened under a product it is not (an old link) is moved to
 * its own. Null when the path is not under `from`.
 */
export function retailAddressIn(pathname: string, from: RetailSpaceId, to: RetailSpaceId): string | null {
  const prefix = BUSINESS_BASE[from];
  if (!within(pathname, prefix)) return null;
  return `${BUSINESS_BASE[to]}${pathname.slice(prefix.length).replace(/\/+$/, '')}`;
}
