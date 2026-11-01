import type { BusinessSector } from '@/server/domain/restaurant-profile';

/**
 * The Studio's closed spaces for a Super Admin: one per project, each with its own navigation, pages and data. A space is
 * known from the address alone (no cookie), so a deep link, the back button and the current-item mark all agree. Menu and
 * Cashier is the default: every Studio path that no other space claims is its own.
 */

export type SpaceId = 'food' | 'pharmacy' | 'retail' | 'platform';

/** A space that works on businesses: every one but the platform. */
export type BusinessSpaceId = Exclude<SpaceId, 'platform'>;

export interface Space {
  id: SpaceId;
  /** The message that names the space on the hub and in its sidebar. */
  nameKey: string;
  icon: 'food' | 'pharmacy' | 'retail' | 'platform';
  /** Where the hub's icon leads. */
  home: string;
  /** The business sectors the space reads and writes; none for the platform. */
  sectors: readonly BusinessSector[];
  /** The address prefix that is this space's; null for the default space. */
  prefix: string | null;
  /** Drawn as a large icon in the middle of the hub; otherwise as a small entry in its corner. */
  big: boolean;
}

export const SPACES: readonly Space[] = [
  { id: 'food', nameKey: 'hub.food', icon: 'food', home: '/studio/overview', sectors: ['FOOD'], prefix: null, big: true },
  { id: 'pharmacy', nameKey: 'hub.pharmacy', icon: 'pharmacy', home: '/studio/pharmacy', sectors: ['PHARMACY'], prefix: '/studio/pharmacy', big: true },
  // Buzzify Retail's shops. /studio/retail/open/[id], /studio/retail/continue and /studio/retail/choose under the same prefix
  // are the owners' sign-in handoff to Retails, not pages of the space: their static segments win over a shop's id.
  { id: 'retail', nameKey: 'hub.retail', icon: 'retail', home: '/studio/retail', sectors: ['RETAIL'], prefix: '/studio/retail', big: true },
  { id: 'platform', nameKey: 'hub.platform', icon: 'platform', home: '/studio/team', sectors: [], prefix: '/studio/team', big: false },
];

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

/** The address base of each sector's businesses: its space's prefix, or Menu and Cashier's restaurants. */
const BUSINESS_BASE: Record<BusinessSector, string> = { FOOD: '/studio/restaurants', PHARMACY: '/studio/pharmacy', RETAIL: '/studio/retail' };

/** A business's page (and optionally one of its tabs) in the space of its sector. */
export function businessPath(sector: BusinessSector, id: string, tab?: string): string {
  const base = `${BUSINESS_BASE[sector]}/${id}`;
  return tab ? `${base}/${tab}` : base;
}

/** The address base of a business space's businesses, which is also where its list lives. */
export function businessBase(space: BusinessSpaceId): string {
  return BUSINESS_BASE[sectorOfSpace(space) ?? 'FOOD'];
}

/** The one sector a business space works on; null for the platform. */
export function sectorOfSpace(space: SpaceId): BusinessSector | null {
  return SPACES.find((entry) => entry.id === space)?.sectors[0] ?? null;
}

/**
 * Where the old Menu and Cashier address of a business of another space now lives: the same tab under that space's
 * prefix. Null when the path is not that business's own (another id, another prefix), and for a food business.
 */
export function movedBusinessAddressOf(pathname: string, id: string, sector: BusinessSector): string | null {
  const old = `/studio/restaurants/${id}`;
  if (sector === 'FOOD' || !within(pathname, old)) return null;
  const rest = pathname.slice(old.length).replace(/\/+$/, '');
  return `${BUSINESS_BASE[sector]}/${id}${rest}`;
}

/** Where the old Menu and Cashier address of a pharmacy now lives: the same tab under /studio/pharmacy. */
export function pharmacyAddressOf(pathname: string, id: string): string | null {
  return movedBusinessAddressOf(pathname, id, 'PHARMACY');
}
