import type { OccasionMood } from '@/lib/occasion-moods';
import { isOfferLive, localDate } from './offers';
import type { TranslationMap } from './types';

/**
 * The guest menu's showcase carousels (docs/superpowers/specs/2026-10-30-menu-occasions-showcase-design.md): which cards
 * are live at a moment. Dates are local `YYYY-MM-DD` dates in the menu's time zone, both inclusive.
 */

export const SHOWCASE_SLOTS = ['ABOVE_SEARCH', 'BELOW_SEARCH'] as const;
export type ShowcaseSlot = (typeof SHOWCASE_SLOTS)[number];

/** A package for N people is kind SET whose bundle has people. */
export const SHOWCASE_KINDS = ['OFFER', 'SET', 'BUFFET'] as const;
export type ShowcaseKind = (typeof SHOWCASE_KINDS)[number];

export const SHOWCASE_MAX_PER_SLOT = 8;

/** A dated occasion (Eid, Ramadan) that cards can hang on; its cards show only while it runs. */
export interface CatalogOccasion {
  id: string;
  startsOn: string;
  endsOn: string;
  isActive: boolean;
  /** Tints the menu while the occasion is live (plan feature `guest.occasionMoods`); left out for none. */
  mood?: OccasionMood;
  translations: TranslationMap; // name
}

export interface CatalogShowcaseCard {
  id: string;
  slot: ShowcaseSlot;
  kind: ShowcaseKind;
  sortOrder: number;
  occasionId: string | null;
  promotionId: string | null;
  bundleId: string | null;
  /** BUFFET: the price per person. */
  price: number | null;
  /** BUFFET: a daily window in minutes after local midnight, or both null for all day; it wraps past midnight when end <= start. */
  startMinute: number | null;
  endMinute: number | null;
  /** Bit 0 is Monday, as in the daypart schedule. */
  daysOfWeek: number;
  translations: TranslationMap; // title, text
}

/** Whether the occasion is switched on and `now` falls on one of its dates in `timeZone`. */
export function isOccasionLive(occasion: CatalogOccasion, now: Date, timeZone: string): boolean {
  if (!occasion.isActive) return false;
  const date = localDate(now, timeZone);
  return date >= occasion.startsOn && date <= occasion.endsOn;
}

/**
 * The cards to show at `now`, per slot: a card goes only while its occasion runs, its offer is live, its bundle is
 * shown, or (buffet) it is inside its own days and hours. In order, at most SHOWCASE_MAX_PER_SLOT per slot.
 */
export function liveShowcase(input: {
  cards: CatalogShowcaseCard[];
  occasions: CatalogOccasion[];
  liveOfferIds: ReadonlySet<string>;
  shownBundleIds: ReadonlySet<string>;
  now: Date;
  timeZone: string;
}): Record<ShowcaseSlot, CatalogShowcaseCard[]> {
  const { cards, occasions, liveOfferIds, shownBundleIds, now, timeZone } = input;
  const liveOccasions = new Set(occasions.filter((o) => isOccasionLive(o, now, timeZone)).map((o) => o.id));

  const isLive = (card: CatalogShowcaseCard): boolean => {
    if (card.occasionId !== null && !liveOccasions.has(card.occasionId)) return false;
    if (card.kind === 'OFFER') return card.promotionId !== null && liveOfferIds.has(card.promotionId);
    if (card.kind === 'SET') return card.bundleId !== null && shownBundleIds.has(card.bundleId);
    return isOfferLive({ ...card, startsOn: null, endsOn: null }, now, timeZone);
  };

  const ordered = cards
    .filter(isLive)
    .sort((a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const slots: Record<ShowcaseSlot, CatalogShowcaseCard[]> = { ABOVE_SEARCH: [], BELOW_SEARCH: [] };
  for (const card of ordered) if (slots[card.slot].length < SHOWCASE_MAX_PER_SLOT) slots[card.slot].push(card);
  return slots;
}
