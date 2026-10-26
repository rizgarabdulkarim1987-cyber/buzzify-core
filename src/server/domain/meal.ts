import { productMap } from './catalog';
import type { EngineConfig } from './config';
import { scoreProducts } from './promotion';
import type { CartInput, Catalog, CatalogProduct } from './types';

/** A dish that would complete the guest's meal: the best of a category the cart has nothing from. */
export interface MealOffer {
  suggestionId: string;
  productId: string;
  categoryId: string;
}

const MAX_MEAL_OFFERS = 2;

/**
 * "Complete your meal" (docs/superpowers/specs/2026-10-18-sales-tools-design.md, 6.2). For each category the owner marked
 * as completing a meal, in menu order, that the cart (a set's dishes included) has no dish from: the best-scoring dish
 * guests can order now. Never one the guest dismissed (`meal:<id>`) or one already offered elsewhere (`exclude`, the
 * pairings shown with it); at most two. An empty cart gets nothing: there is no meal to complete yet.
 */
export function suggestMealCompletions(
  catalog: Catalog,
  cart: CartInput,
  dismissedIds: readonly string[],
  now: Date,
  config: EngineConfig,
  exclude: readonly string[] = [],
): MealOffer[] {
  const products = productMap(catalog);
  const inCart = new Set(cart.lines.map((line) => line.productId));
  for (const entry of cart.bundles) {
    const bundle = catalog.bundles.find((candidate) => candidate.id === entry.bundleId);
    for (const item of bundle?.items ?? []) inCart.add(item.productId);
  }
  const cartProducts = [...inCart].map((id) => products.get(id)).filter((p): p is CatalogProduct => p !== undefined);
  if (cartProducts.length === 0) return [];

  const covered = new Set(cartProducts.map((product) => product.categoryId));
  const skipped = new Set([...dismissedIds.filter((id) => id.startsWith('meal:')).map((id) => id.slice('meal:'.length)), ...exclude]);
  const ranked = scoreProducts(catalog, now, config).filter((result) => result.eligible && !skipped.has(result.productId));

  const offers: MealOffer[] = [];
  for (const category of catalog.categories) {
    if (offers.length >= MAX_MEAL_OFFERS) break;
    if (!category.completesMeal || covered.has(category.id)) continue;
    const best = ranked.find((result) => products.get(result.productId)?.categoryId === category.id);
    if (best) offers.push({ suggestionId: `meal:${best.productId}`, productId: best.productId, categoryId: category.id });
  }
  return offers;
}
