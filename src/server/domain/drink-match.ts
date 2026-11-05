import { daypartNow, inDaypart, orderability, productMap } from './catalog';
import type { Catalog, CatalogProduct } from './types';

/** How many drinks a dish shows under "goes well with". */
export const DRINK_MATCH_MAX = 3;

const DRINK_SLOT = 'DRINK';

export interface DrinkMatch {
  productId: string;
  /** Set when the owner paired this drink to the dish by hand. */
  paired: boolean;
}

/**
 * The drinks that go with a dish (plan feature `guest.drinkMatch`). The drinks the owner paired to the dish, or to its
 * category, come first (strongest rule first); the rest are the most popular drinks on sale, so the row works with no
 * setup. Only food gets a row: a drink, a dessert or an unknown dish gets none. Pure: nothing is stored.
 */
export function drinkMatchFor(catalog: Catalog, productId: string, now: Date, max = DRINK_MATCH_MAX): DrinkMatch[] {
  const products = productMap(catalog);
  const dish = products.get(productId);
  if (!dish || dish.slot === DRINK_SLOT || dish.slot === 'DESSERT') return [];

  const current = daypartNow(catalog, now);
  const onSale = (product: CatalogProduct | undefined): product is CatalogProduct =>
    product !== undefined &&
    product.slot === DRINK_SLOT &&
    !product.isHidden &&
    orderability(product, current) === 'OK' &&
    inDaypart(product.dayparts, current);

  const picked = new Map<string, DrinkMatch>();
  const rules = catalog.pairingRules
    .filter((rule) => (rule.sourceType === 'PRODUCT' ? rule.sourceProductId === dish.id : rule.sourceCategoryId === dish.categoryId))
    .filter((rule) => inDaypart(rule.dayparts, current))
    .sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
  for (const rule of rules) {
    if (picked.size >= max) break;
    if (onSale(products.get(rule.targetProductId))) picked.set(rule.targetProductId, { productId: rule.targetProductId, paired: true });
  }

  const popular = catalog.products
    .filter(onSale)
    .sort((a, b) => b.popularity - a.popularity || a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  for (const drink of popular) {
    if (picked.size >= max) break;
    if (!picked.has(drink.id)) picked.set(drink.id, { productId: drink.id, paired: false });
  }
  return [...picked.values()];
}
