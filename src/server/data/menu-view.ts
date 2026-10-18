import { normalizeSearch } from '@/lib/search';
import { LOCALES, type Locale } from '@/lib/locale';
import { parseMedia, type MediaItem } from '@/lib/media';
import { isBadge, isDietaryTag, type Badge, type DietaryTag } from '@/lib/product-tags';
import type { RailDish } from '@/lib/rail';
import { stageOf } from '@/lib/stage';
import {
  daypartNow,
  discountFor,
  liveOffers,
  localDate,
  orderability,
  pickSignature,
  priceOf,
  resolveText,
  salesSettings,
  specialFor,
  type Catalog,
  type CatalogGroup,
  type CatalogProduct,
  type CatalogPromotion,
  type Daypart,
  type Orderability,
  type PromotionKind,
  type VisualKey,
} from '@/server/domain';
import type { TenantInfo } from './tenant';

export interface MenuOptionView {
  id: string;
  name: string;
  effect: string | null;
  priceDelta: number;
  isAvailable: boolean;
  /** What choosing this option does to the 3D model, if anything. */
  visualKey: VisualKey | null;
}

export interface MenuGroupView {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: MenuOptionView[];
}

export interface MenuVariantView {
  id: string;
  name: string;
  priceDelta: number;
  isDefault: boolean;
}

export interface MenuProductView {
  id: string;
  slug: string;
  categoryId: string;
  name: string;
  description: string;
  basePrice: number;
  /** What one unit costs with the default size and no options: the same number the quote starts from. */
  displayPrice: number;
  needsChoices: boolean;
  orderState: Orderability;
  isSignature: boolean;
  media: MediaItem[];
  // Each of these is left out when empty: every product of every menu page carries its view, and the menu page has to
  // arrive in the first round trip (docs/perf), so nothing is sent for what a product does not have.
  /** Quiet labels on the product's row. */
  badges?: Badge[];
  dietary?: DietaryTag[];
  /** Kilocalories of the default size, when the restaurant gave them. */
  calories?: number;
  // The sales tools (docs/superpowers/specs/2026-10-18-sales-tools-design.md, 6.3), each left out when it does not apply.
  /** The regular price, only while a discount makes `displayPrice` lower. */
  regularPrice?: number;
  /** The live discount and the step its prices round to, for the live total of the product's choices. */
  percentOff?: number;
  roundTo?: number;
  /** The title of a live special that names the dish. */
  special?: string;
  /** Among the menu's most ordered dishes, from real guest data. */
  mostOrdered?: true;
  /** Portions left today, when at or below the dish's threshold. */
  fewLeft?: number;
  /** How many people the dish is for. */
  serves?: number;
  allergens: string[];
  ingredients: string[];
  searchKey: string;
  groups: MenuGroupView[];
  variants: MenuVariantView[];
}

/** A live offer as the menu's strip shows it, with when it ends (today's closing time, or a date within a week). */
export interface MenuOfferView {
  id: string;
  kind: PromotionKind;
  title: string;
  text: string;
  percentOff: number | null;
  endsAt: { time: string } | { date: string } | null;
}

export interface MenuView {
  restaurant: {
    slug: string;
    name: string;
    currency: string;
    numeralSystem: 'latn' | 'arab';
    locales: Locale[];
    defaultLocale: Locale;
  };
  daypart: Daypart | null;
  categories: Array<{ id: string; slug: string; name: string; dish: RailDish }>;
  products: MenuProductView[];
  signatureProductId: string | null;
  /** `plain` shows prices without the currency symbol. */
  priceStyle: 'symbol' | 'plain';
  offers: MenuOfferView[];
}

const DAY_MS = 86_400_000;
/** An offer ending on a date says so only when that date is this close. */
const ENDS_SOON_DAYS = 7;

const clock = (minute: number) => `${String(Math.floor(minute / 60) % 24).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

function endsAt(offer: CatalogPromotion, now: Date, timeZone: string): MenuOfferView['endsAt'] {
  if (offer.startMinute !== null && offer.endMinute !== null) return { time: clock(offer.endMinute) };
  if (offer.endsOn !== null) {
    const days = (Date.parse(`${offer.endsOn}T00:00:00Z`) - Date.parse(`${localDate(now, timeZone)}T00:00:00Z`)) / DAY_MS;
    if (days < ENDS_SOON_DAYS) return { date: offer.endsOn };
  }
  return null;
}

function mapGroup(group: CatalogGroup, locale: Locale, fallback: Locale): MenuGroupView {
  return {
    id: group.id,
    name: resolveText(group.translations, 'name', locale, fallback),
    minSelect: group.minSelect,
    maxSelect: group.maxSelect,
    options: group.options.map((option) => ({
      id: option.id,
      name: resolveText(option.translations, 'name', locale, fallback),
      effect: resolveText(option.translations, 'effect', locale, fallback) || null,
      priceDelta: option.priceDelta,
      isAvailable: option.isAvailable,
      visualKey: option.visualKey,
    })),
  };
}

/**
 * Search text for what the visitor sees: the name, description and ingredients in the page's language.
 * This is what ships with the menu page; the other languages come from `buildSearchIndex`.
 */
function pageSearchKey(slug: string, name: string, description: string, ingredients: string[]): string {
  return normalizeSearch([slug, name, description, ...ingredients].join(' '));
}

function allLocalesSearchKey(product: CatalogProduct): string {
  const parts: string[] = [product.slug];
  for (const locale of LOCALES) {
    parts.push(product.translations[locale]?.name ?? '', product.translations[locale]?.description ?? '');
    parts.push(...(product.ingredients[locale] ?? []));
  }
  return normalizeSearch(parts.join(' '));
}

/**
 * Search text in every language, for each product that is on the menu right now, keyed by product id. A
 * visitor can search in any language, but sending every language with every page cost about a fifth of the
 * menu document, so the page loads this on demand when the search box is used.
 */
export function buildSearchIndex(catalog: Catalog, now: Date): Record<string, string> {
  const current = daypartNow(catalog, now);
  const index: Record<string, string> = {};
  for (const product of catalog.products) {
    if (orderability(product, current) !== 'OUT_OF_DAYPART') index[product.id] = allLocalesSearchKey(product);
  }
  return index;
}

/** The badges, dietary tags and calories a product has, leaving out what it has none of. */
function productTags(product: CatalogProduct): Pick<MenuProductView, 'badges' | 'dietary' | 'calories'> {
  const badges = product.badges.filter(isBadge);
  const dietary = product.dietary.filter(isDietaryTag);
  return {
    ...(badges.length > 0 ? { badges } : {}),
    ...(dietary.length > 0 ? { dietary } : {}),
    ...(product.calories !== null ? { calories: product.calories } : {}),
  };
}

/** A library photo's alt text in the page's language, falling back to the one it was published with. */
function localizeMedia(media: MediaItem[], locale: Locale): MediaItem[] {
  return media.map((item) => (item.kind === 'image' && item.alts?.[locale] ? { ...item, alt: item.alts[locale] } : item));
}

/**
 * The dish a category's rail entry shows: the model of its first product with a 3D stage, in menu order and
 * whether or not that product is on the menu right now, so the rail does not change shape through the day.
 */
function dishOf(products: CatalogProduct[]): RailDish {
  const ordered = [...products].sort((a, b) => a.sortOrder - b.sortOrder || a.slug.localeCompare(b.slug));
  for (const product of ordered) {
    const stage = stageOf(parseMedia(product.media));
    if (stage) return stage.art;
  }
  return 'plate';
}

export function buildMenuView(
  catalog: Catalog,
  tenant: TenantInfo,
  locale: Locale,
  now: Date,
  extras: { mostOrdered?: readonly string[] } = {},
): MenuView {
  const fallback = catalog.defaultLocale;
  const current = daypartNow(catalog, now);
  const live = liveOffers(catalog, now);
  const sales = salesSettings(tenant.engineConfig);
  const socialProof = tenant.features.socialProof;
  const mostOrdered = new Set(socialProof && sales.showMostOrdered ? (extras.mostOrdered ?? []) : []);
  const fewLeft = (product: CatalogProduct): number | null =>
    socialProof &&
    sales.showLowStock &&
    product.stockCount !== null &&
    product.stockCount > 0 &&
    product.lowStockThreshold !== null &&
    product.stockCount <= product.lowStockThreshold
      ? product.stockCount
      : null;
  const categoryOrder = new Map(catalog.categories.map((category, index) => [category.id, index]));
  const sortOrder = new Map(catalog.products.map((product) => [product.id, product.sortOrder]));

  const products = catalog.products
    .filter((product) => orderability(product, current) !== 'OUT_OF_DAYPART')
    .map<MenuProductView>((product) => {
      const name = resolveText(product.translations, 'name', locale, fallback);
      const description = resolveText(product.translations, 'description', locale, fallback);
      const ingredients = product.ingredients[locale] ?? product.ingredients[fallback] ?? product.ingredients.en ?? [];
      const price = priceOf(product, null, [], live);
      const discount = discountFor(product, live);
      const special = specialFor(product, live);
      const left = fewLeft(product);
      return {
        id: product.id,
        slug: product.slug,
        categoryId: product.categoryId,
        name,
        description,
        basePrice: product.basePrice,
        displayPrice: price.price,
        ...(price.price < price.regular ? { regularPrice: price.regular } : {}),
        ...(discount ? { percentOff: discount.percent, roundTo: discount.roundTo } : {}),
        ...(special ? { special: resolveText(special.translations, 'title', locale, fallback) } : {}),
        ...(mostOrdered.has(product.id) ? { mostOrdered: true as const } : {}),
        ...(left !== null ? { fewLeft: left } : {}),
        ...(product.serves !== null ? { serves: product.serves } : {}),
        needsChoices: product.groups.some((group) => group.minSelect > 0 && group.options.length > 0),
        orderState: orderability(product, current),
        isSignature: product.isSignature,
        media: localizeMedia(parseMedia(product.media), locale),
        ...productTags(product),
        allergens: product.allergens,
        ingredients,
        searchKey: pageSearchKey(product.slug, name, description, ingredients),
        groups: product.groups.map((group) => mapGroup(group, locale, fallback)),
        variants: product.variants.map((variant) => ({
          id: variant.id,
          name: resolveText(variant.translations, 'name', locale, fallback),
          priceDelta: variant.priceDelta,
          isDefault: variant.isDefault,
        })),
      };
    })
    .sort(
      (a, b) =>
        (categoryOrder.get(a.categoryId) ?? 0) - (categoryOrder.get(b.categoryId) ?? 0) ||
        (sortOrder.get(a.id) ?? 0) - (sortOrder.get(b.id) ?? 0) ||
        a.slug.localeCompare(b.slug),
    );

  const signature = pickSignature(catalog, now, tenant.engineConfig);
  return {
    restaurant: {
      slug: tenant.slug,
      name: tenant.name,
      currency: tenant.currency,
      numeralSystem: tenant.numeralSystem,
      locales: tenant.locales,
      defaultLocale: tenant.defaultLocale,
    },
    daypart: current,
    categories: catalog.categories.map((category) => ({
      id: category.id,
      slug: category.slug,
      name: resolveText(category.translations, 'name', locale, fallback),
      dish: dishOf(catalog.products.filter((product) => product.categoryId === category.id)),
    })),
    products,
    signatureProductId: signature?.productId ?? null,
    priceStyle: sales.priceStyle,
    offers: live.map((offer) => ({
      id: offer.id,
      kind: offer.kind,
      title: resolveText(offer.translations, 'title', locale, fallback),
      text: resolveText(offer.translations, 'text', locale, fallback),
      percentOff: offer.kind === 'DISCOUNT' ? offer.percentOff : null,
      endsAt: endsAt(offer, now, catalog.timeZone),
    })),
  };
}
