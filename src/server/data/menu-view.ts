import { normalizeSearch } from '@/lib/search';
import { LOCALES, type Locale } from '@/lib/locale';
import { parseMedia, type MediaItem } from '@/lib/media';
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
  categories: Array<{ id: string; slug: string; name: string }>;
  products: MenuProductView[];
  signatureProductId: string | null;
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

function searchKey(product: CatalogProduct): string {
  const parts: string[] = [product.slug];
  for (const locale of LOCALES) {
    parts.push(product.translations[locale]?.name ?? '', product.translations[locale]?.description ?? '');
    parts.push(...(product.ingredients[locale] ?? []));
  }
  return normalizeSearch(parts.join(' '));
}

export function buildMenuView(catalog: Catalog, tenant: TenantInfo, locale: Locale, now: Date): MenuView {
  const fallback = catalog.defaultLocale;
  const current = daypartNow(catalog, now);
  const categoryOrder = new Map(catalog.categories.map((category, index) => [category.id, index]));
  const sortOrder = new Map(catalog.products.map((product) => [product.id, product.sortOrder]));

  const products = catalog.products
    .filter((product) => orderability(product, current) !== 'OUT_OF_DAYPART')
    .map<MenuProductView>((product) => ({
      id: product.id,
      slug: product.slug,
      categoryId: product.categoryId,
      name: resolveText(product.translations, 'name', locale, fallback),
      description: resolveText(product.translations, 'description', locale, fallback),
      basePrice: product.basePrice,
      displayPrice: unitPrice(product, null, []).price,
      needsChoices: product.groups.some((group) => group.minSelect > 0 && group.options.length > 0),
      orderState: orderability(product, current),
      isSignature: product.isSignature,
      media: parseMedia(product.media),
      allergens: product.allergens,
      ingredients: product.ingredients[locale] ?? product.ingredients[fallback] ?? product.ingredients.en ?? [],
      searchKey: searchKey(product),
      groups: product.groups.map((group) => mapGroup(group, locale, fallback)),
      variants: product.variants.map((variant) => ({
        id: variant.id,
        name: resolveText(variant.translations, 'name', locale, fallback),
        priceDelta: variant.priceDelta,
        isDefault: variant.isDefault,
      })),
    }))
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
    })),
    products,
    signatureProductId: signature?.productId ?? null,
  };
}
