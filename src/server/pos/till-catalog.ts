import type { PrismaClient } from '@/generated/prisma/client';
import { isLocale, type Locale } from '@/lib/locale';
import { loadDraftCatalog } from '@/server/data/catalog-loader';
import { scopedClient } from '@/server/data/tenant-db';
import type { TranslationMap } from '@/server/domain/types';
import { catalogMenuOf } from './catalog-menu';

/** A name in each language the menu has. A language without a name is left out. */
export type Names = Partial<Record<Locale, string>>;

export interface TillVariant {
  id: string;
  names: Names;
  priceDelta: number;
  isDefault: boolean;
}

export interface TillOption {
  id: string;
  names: Names;
  priceDelta: number;
  available: boolean;
}

export interface TillGroup {
  id: string;
  names: Names;
  minSelect: number;
  maxSelect: number;
  options: TillOption[];
}

export interface TillProduct {
  id: string;
  categoryId: string;
  sortOrder: number;
  names: Names;
  /** Whole Iraqi dinar. */
  price: number;
  /** In stock and not switched off at the till. */
  available: boolean;
  /** Pulled from the guests' menu; the till still sells it. */
  hiddenFromGuests: boolean;
  sectionId: string | null;
  variants: TillVariant[];
  groups: TillGroup[];
}

export interface TillCategory {
  id: string;
  sortOrder: number;
  names: Names;
  sectionId: string | null;
}

/** What the till sells: the restaurant's catalog menu as it is now, without costs, stock counters or marketing fields. */
export interface TillCatalog {
  menuId: string;
  currency: 'IQD';
  locales: Locale[];
  defaultLocale: Locale;
  categories: TillCategory[];
  products: TillProduct[];
}

function namesOf(map: TranslationMap, locales: readonly Locale[]): Names {
  const names: Names = {};
  for (const locale of locales) {
    const name = map[locale]?.name;
    if (typeof name === 'string' && name !== '') names[locale] = name;
  }
  return names;
}

/**
 * The restaurant's till catalog, read from the draft rows of its catalog menu, so an edit shows at once and no publish is
 * needed. Null when no catalog menu is chosen. One query per table: nothing is read per product.
 */
export async function loadTillCatalog(prisma: PrismaClient, restaurantId: string): Promise<TillCatalog | null> {
  const chosen = await catalogMenuOf(prisma, restaurantId);
  if (!chosen) return null;
  const menu = await prisma.menu.findFirst({
    where: { id: chosen.id, restaurantId },
    select: { id: true, locales: true, defaultLocale: true },
  });
  if (!menu) return null;
  // Only the menu's own rows and this restaurant's side tables are reachable from these clients.
  const catalog = await loadDraftCatalog(scopedClient(prisma, { menuId: menu.id, restaurantId }), menu.id);
  const side = scopedClient(prisma, { restaurantId });
  const [categorySettings, productSettings] = await Promise.all([
    side.posCategorySetting.findMany({ select: { categoryId: true, sectionId: true } }),
    side.posProductSetting.findMany({ select: { productId: true, sectionId: true, soldOutOverride: true } }),
  ]);
  const categorySection = new Map(categorySettings.map((row) => [row.categoryId, row.sectionId]));
  const productSetting = new Map(productSettings.map((row) => [row.productId, row]));

  const locales = menu.locales.filter(isLocale);
  const defaultLocale = isLocale(menu.defaultLocale) ? menu.defaultLocale : 'en';

  const categories = catalog.categories
    .map<TillCategory>((category) => ({
      id: category.id,
      sortOrder: category.sortOrder,
      names: namesOf(category.translations, locales),
      sectionId: categorySection.get(category.id) ?? null,
    }))
    .sort((x, y) => x.sortOrder - y.sortOrder || x.id.localeCompare(y.id));
  const categoryRank = new Map(categories.map((category, index) => [category.id, index]));

  const products = catalog.products
    .map<TillProduct>((product) => {
      const setting = productSetting.get(product.id);
      return {
        id: product.id,
        categoryId: product.categoryId,
        sortOrder: product.sortOrder,
        names: namesOf(product.translations, locales),
        price: product.basePrice,
        available: product.isAvailable && !(setting?.soldOutOverride ?? false),
        hiddenFromGuests: product.isHidden,
        sectionId: setting?.sectionId ?? categorySection.get(product.categoryId) ?? null,
        variants: product.variants.map((variant) => ({
          id: variant.id,
          names: namesOf(variant.translations, locales),
          priceDelta: variant.priceDelta,
          isDefault: variant.isDefault,
        })),
        groups: product.groups.map((group) => ({
          id: group.id,
          names: namesOf(group.translations, locales),
          minSelect: group.minSelect,
          maxSelect: group.maxSelect,
          options: group.options.map((option) => ({
            id: option.id,
            names: namesOf(option.translations, locales),
            priceDelta: option.priceDelta,
            available: option.isAvailable,
          })),
        })),
      };
    })
    .sort(
      (x, y) =>
        (categoryRank.get(x.categoryId) ?? 0) - (categoryRank.get(y.categoryId) ?? 0) || x.sortOrder - y.sortOrder || x.id.localeCompare(y.id),
    );

  return { menuId: menu.id, currency: 'IQD', locales, defaultLocale, categories, products };
}
