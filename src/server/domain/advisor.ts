import { compareBundle } from './bundles';
import type { Catalog, CatalogProduct, Locale } from './types';

/**
 * What the Sales tab's advisor tells an owner to fix (docs/superpowers/specs/2026-10-18-sales-tools-design.md, goal 6),
 * read from the draft. Each piece of advice names the dishes, categories or sets it is about.
 */

export const ADVICE_CODES = [
  'NO_PHOTO',
  'NO_DESCRIPTION',
  'NO_COST',
  'LONG_CATEGORY',
  'VEGETARIAN_SECTION',
  'TWO_SIZES',
  'NO_RULES',
  'SET_NOT_A_DEAL',
  'NO_SIGNATURE',
] as const;
export type AdviceCode = (typeof ADVICE_CODES)[number];

export interface Advice {
  code: AdviceCode;
  productIds: string[];
  categoryIds: string[];
  bundleIds: string[];
}

/** More dishes than this in one category is too many to choose from. */
export const LONG_CATEGORY_MAX = 10;
/** A category of at least this many dishes, every one vegetarian or vegan, is a separate vegetarian section. */
const VEGETARIAN_SECTION_MIN = 3;
/** What counts as a real picture of the dish: anything but the drawn placeholder art. A library photo is an asset. */
const PICTURE_KINDS = new Set(['image', 'video', 'model3d', 'asset']);

function hasPicture(product: CatalogProduct): boolean {
  return product.media.some((entry) => PICTURE_KINDS.has(String((entry as { kind?: unknown } | null)?.kind)));
}

function described(product: CatalogProduct, locale: Locale): boolean {
  return (product.translations[locale]?.description ?? '').trim().length > 0;
}

const meatFree = (product: CatalogProduct) => product.dietary.includes('VEGETARIAN') || product.dietary.includes('VEGAN');

export function adviseMenu(catalog: Catalog, locales: readonly Locale[]): Advice[] {
  const { products, categories } = catalog;
  const inCategory = (categoryId: string) => products.filter((product) => product.categoryId === categoryId);
  const ids = <T extends { id: string }>(rows: T[]) => rows.map((row) => row.id);

  const found: Record<AdviceCode, Omit<Advice, 'code'> | null> = {
    NO_PHOTO: { productIds: ids(products.filter((p) => !hasPicture(p))), categoryIds: [], bundleIds: [] },
    NO_DESCRIPTION: { productIds: ids(products.filter((p) => locales.some((locale) => !described(p, locale)))), categoryIds: [], bundleIds: [] },
    NO_COST: { productIds: ids(products.filter((p) => p.cost === null)), categoryIds: [], bundleIds: [] },
    LONG_CATEGORY: { productIds: [], categoryIds: ids(categories.filter((c) => inCategory(c.id).length > LONG_CATEGORY_MAX)), bundleIds: [] },
    VEGETARIAN_SECTION: {
      productIds: [],
      categoryIds: ids(
        categories.filter((c) => {
          const dishes = inCategory(c.id);
          return dishes.length >= VEGETARIAN_SECTION_MIN && dishes.every(meatFree);
        }),
      ),
      bundleIds: [],
    },
    TWO_SIZES: { productIds: ids(products.filter((p) => p.variants.length === 2)), categoryIds: [], bundleIds: [] },
    NO_RULES: catalog.upsellRules.length + catalog.pairingRules.length === 0 ? { productIds: [], categoryIds: [], bundleIds: [] } : null,
    SET_NOT_A_DEAL: { productIds: [], categoryIds: [], bundleIds: ids(catalog.bundles.filter((b) => !compareBundle(catalog, b)?.isDeal)) },
    NO_SIGNATURE: products.some((p) => p.isSignature || p.isFeatured) ? null : { productIds: [], categoryIds: [], bundleIds: [] },
  };

  return ADVICE_CODES.flatMap((code) => {
    const entry = found[code];
    if (entry === null) return [];
    const flagsAll = code === 'NO_RULES' || code === 'NO_SIGNATURE';
    if (!flagsAll && entry.productIds.length + entry.categoryIds.length + entry.bundleIds.length === 0) return [];
    return [{ code, ...entry }];
  });
}
