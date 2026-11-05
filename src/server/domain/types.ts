import { LOCALES, type Locale } from '@/lib/locale';

import type { CatalogOccasion, CatalogShowcaseCard } from './showcase';

export { LOCALES };
export type { Locale, CatalogOccasion, CatalogShowcaseCard };

export const DAYPARTS = ['BREAKFAST', 'LUNCH', 'DINNER', 'LATE_NIGHT'] as const;
export type Daypart = (typeof DAYPARTS)[number];

export const MAX_QUANTITY = 20;
export const MAX_LINES = 50;

export type TranslationMap = Partial<Record<Locale, Record<string, string>>>;

/** What an option visibly does to a product's 3D model. */
export const VISUAL_KEYS = ['cheese', 'patty', 'bacon'] as const;
export type VisualKey = (typeof VISUAL_KEYS)[number];

export function toVisualKey(value: unknown): VisualKey | null {
  return (VISUAL_KEYS as readonly unknown[]).includes(value) ? (value as VisualKey) : null;
}

export interface CatalogOption {
  id: string;
  groupId: string;
  priceDelta: number;
  costDelta: number | null;
  isSuggested: boolean;
  suggestPriority: number;
  isAvailable: boolean;
  visualKey: VisualKey | null;
  translations: TranslationMap; // name, effect
}

export interface CatalogGroup {
  id: string;
  productId: string;
  minSelect: number;
  maxSelect: number;
  translations: TranslationMap; // name
  options: CatalogOption[];
}

export interface CatalogVariant {
  id: string;
  productId: string;
  priceDelta: number;
  costDelta: number | null;
  isDefault: boolean;
  translations: TranslationMap; // name
}

export interface CatalogProduct {
  id: string;
  categoryId: string;
  slug: string;
  basePrice: number;
  cost: number | null;
  popularity: number;
  priority: number;
  isSignature: boolean;
  isFeatured: boolean;
  isAvailable: boolean;
  /** Pulled from the menu without a publish. `isAvailable` is the separate "sold out" state. */
  isHidden: boolean;
  stockCount: number | null;
  /** The instant a limited drop ends, while the dish is inside its window (`selling.limitedDrops`); read live, never in a snapshot. */
  dropEndsAt?: string;
  lowStockThreshold: number | null;
  dayparts: Daypart[];
  hideOutsideDaypart: boolean;
  slot: string | null;
  translations: TranslationMap; // name, description
  groups: CatalogGroup[];
  variants: CatalogVariant[];
  media: unknown[]; // validated into MediaItem[] by the presentation layer
  allergens: string[];
  dietary: string[];
  calories: number | null;
  /** How many people the dish is for, from 2; null for one. */
  serves: number | null;
  /** NEW, POPULAR or RECOMMENDED. */
  badges: string[];
  ingredients: Partial<Record<Locale, string[]>>;
  sortOrder: number;
}

export interface CatalogCategory {
  id: string;
  slug: string;
  sortOrder: number;
  translations: TranslationMap; // name
  /** The cart suggests one of its dishes when the order has none ("complete your meal"). */
  completesMeal: boolean;
}

export interface UpsellRule {
  id: string;
  sourceProductId: string;
  targetProductId: string;
  priority: number;
  dayparts: Daypart[];
  translations: TranslationMap; // pitch, effect
}

export interface PairingRule {
  id: string;
  sourceType: 'PRODUCT' | 'CATEGORY';
  sourceProductId: string | null;
  sourceCategoryId: string | null;
  targetProductId: string;
  weight: number;
  dayparts: Daypart[];
  translations: TranslationMap; // reason
}

export interface BundleItem {
  productId: string;
  variantId: string | null;
  quantity: number;
}

export interface Bundle {
  id: string;
  slug: string;
  price: number;
  dayparts: Daypart[];
  translations: TranslationMap; // name, description
  items: BundleItem[];
  /** How many people the set feeds (a package for N people); null when not stated. */
  people: number | null;
}

export const PROMOTION_KINDS = ['SPECIAL', 'DISCOUNT'] as const;
export type PromotionKind = (typeof PROMOTION_KINDS)[number];

/**
 * A timed offer (docs/superpowers/specs/2026-10-18-sales-tools-design.md, 6.1): a highlight (SPECIAL) or a percentage
 * off (DISCOUNT) for the dishes and categories it names, while it is live.
 */
export interface CatalogPromotion {
  id: string;
  kind: PromotionKind;
  /** DISCOUNT only: 5 to 90. */
  percentOff: number | null;
  productIds: string[];
  categoryIds: string[];
  /** Local dates in the menu's time zone, `YYYY-MM-DD`, both inclusive; null is open-ended. */
  startsOn: string | null;
  endsOn: string | null;
  /** A daily window in minutes after local midnight, or both null for all day; it wraps past midnight when end <= start. */
  startMinute: number | null;
  endMinute: number | null;
  /** Bit 0 is Monday, as in the daypart schedule. */
  daysOfWeek: number;
  /** The menu's price step, frozen at publish: a discounted price rounds to it. */
  roundTo: number;
  translations: TranslationMap; // title, text
  sortOrder: number;
}

export interface DaypartWindow {
  daypart: Daypart;
  startMinute: number;
  endMinute: number;
  daysOfWeek: number;
}

export interface Catalog {
  menuId: string;
  currency: string;
  timeZone: string;
  defaultLocale: Locale;
  categories: CatalogCategory[];
  products: CatalogProduct[];
  upsellRules: UpsellRule[];
  pairingRules: PairingRule[];
  bundles: Bundle[];
  promotions: CatalogPromotion[];
  occasions: CatalogOccasion[];
  showcaseCards: CatalogShowcaseCard[];
  schedule: DaypartWindow[];
}

export interface CartLineInput {
  productId: string;
  variantId: string | null;
  optionIds: string[];
  quantity: number;
}

export interface CartBundleInput {
  bundleId: string;
  quantity: number;
}

export interface CartInput {
  lines: CartLineInput[];
  bundles: CartBundleInput[];
}
