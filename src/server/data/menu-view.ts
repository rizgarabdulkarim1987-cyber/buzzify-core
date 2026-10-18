import { normalizeSearch } from '@/lib/search';
import { LOCALES, type Locale } from '@/lib/locale';
import { parseMedia, type MediaItem } from '@/lib/media';
import { isBadge, isDietaryTag, type Badge, type DietaryTag } from '@/lib/product-tags';
import type { RailDish } from '@/lib/rail';
import { stageOf } from '@/lib/stage';
import {
  daypartNow,
  orderability,
  pickSignature,
  resolveText,
  unitPrice,
  type Catalog,
  type CatalogGroup,
  type CatalogProduct,
  type Daypart,
  type Orderability,
  type VisualKey,
} from '@/server/domain';
import type { MotionParams } from '@/motion/types';
import { guestParams, type SnapshotMotion } from '@/server/domain/menu-motions';
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
  /** Set only when the restaurant featured it; template heroes show featured products first. */
  featured?: true;
  media: MediaItem[];
  // Each of these is left out when empty: every product of every menu page carries its view, and the menu page has to
  // arrive in the first round trip (docs/perf), so nothing is sent for what a product does not have.
  /** Quiet labels on the product's row. */
  badges?: Badge[];
  dietary?: DietaryTag[];
  /** Kilocalories of the default size, when the restaurant gave them. */
  calories?: number;
  allergens: string[];
  ingredients: string[];
  searchKey: string;
  groups: MenuGroupView[];
  variants: MenuVariantView[];
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
  /** The motions at the menu's places, for this guest's language; none where the plan leaves them out. */
  motions: MenuMotionsView;
}

/** A motion as a guest's page plays it: its params resolved for the guest's language; still when the menu's motion is off. */
export interface PlacedMotion {
  motionId: string;
  params: MotionParams;
  playing: boolean;
}

export interface MenuMotionsView {
  hero?: PlacedMotion;
  signature?: PlacedMotion;
  /** By category id. */
  categories: Record<string, PlacedMotion>;
}

/** The tenant's motions laid out by place, each resolved for the guest (`guestParams`). */
function menuMotions(motions: readonly SnapshotMotion[], tenant: TenantInfo, locale: Locale): MenuMotionsView {
  const view: MenuMotionsView = { categories: {} };
  const playing = tenant.brand.motionIntensity !== 'none';
  for (const motion of motions) {
    const placed = { motionId: motion.motionId, params: guestParams(motion, locale, tenant.defaultLocale, tenant.brand.logoText), playing };
    if (motion.place === 'category') {
      if (motion.categoryId) view.categories[motion.categoryId] = placed;
    } else view[motion.place] = placed;
  }
  return view;
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

export function buildMenuView(catalog: Catalog, tenant: TenantInfo, locale: Locale, now: Date): MenuView {
  const fallback = catalog.defaultLocale;
  const current = daypartNow(catalog, now);
  const categoryOrder = new Map(catalog.categories.map((category, index) => [category.id, index]));
  const sortOrder = new Map(catalog.products.map((product) => [product.id, product.sortOrder]));

  const products = catalog.products
    .filter((product) => orderability(product, current) !== 'OUT_OF_DAYPART')
    .map<MenuProductView>((product) => {
      const name = resolveText(product.translations, 'name', locale, fallback);
      const description = resolveText(product.translations, 'description', locale, fallback);
      const ingredients = product.ingredients[locale] ?? product.ingredients[fallback] ?? product.ingredients.en ?? [];
      return {
        id: product.id,
        slug: product.slug,
        categoryId: product.categoryId,
        name,
        description,
        basePrice: product.basePrice,
        displayPrice: unitPrice(product, null, []).price,
        needsChoices: product.groups.some((group) => group.minSelect > 0 && group.options.length > 0),
        orderState: orderability(product, current),
        isSignature: product.isSignature,
        ...(product.isFeatured ? { featured: true as const } : {}),
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
    motions: menuMotions(tenant.motions, tenant, locale),
  };
}
