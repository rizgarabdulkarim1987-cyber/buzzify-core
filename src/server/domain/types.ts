import { LOCALES, type Locale } from '@/lib/locale';

export { LOCALES };
export type { Locale };

export const DAYPARTS = ['BREAKFAST', 'LUNCH', 'DINNER', 'LATE_NIGHT'] as const;
export type Daypart = (typeof DAYPARTS)[number];

export const MAX_QUANTITY = 20;
export const MAX_LINES = 50;

export type TranslationMap = Partial<Record<Locale, Record<string, string>>>;

export interface CatalogOption {
  id: string;
  groupId: string;
  priceDelta: number;
  costDelta: number | null;
  isSuggested: boolean;
  suggestPriority: number;
  isAvailable: boolean;
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
  stockCount: number | null;
  lowStockThreshold: number | null;
  dayparts: Daypart[];
  hideOutsideDaypart: boolean;
  slot: string | null;
  translations: TranslationMap; // name, description
  groups: CatalogGroup[];
  variants: CatalogVariant[];
  media: unknown[]; // validated into MediaItem[] by the presentation layer
  allergens: string[];
  ingredients: Partial<Record<Locale, string[]>>;
  sortOrder: number;
}

export interface CatalogCategory {
  id: string;
  slug: string;
  sortOrder: number;
  translations: TranslationMap; // name
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
}

export interface DaypartWindow {
  daypart: Daypart;
  startMinute: number;
  endMinute: number;
  daysOfWeek: number;
}

export interface Catalog {
  restaurantId: string;
  currency: string;
  timeZone: string;
  defaultLocale: Locale;
  categories: CatalogCategory[];
  products: CatalogProduct[];
  upsellRules: UpsellRule[];
  pairingRules: PairingRule[];
  bundles: Bundle[];
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
