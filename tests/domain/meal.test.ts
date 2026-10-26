import { describe, expect, it } from 'vitest';
import { DEFAULT_ENGINE_CONFIG } from '@/server/domain/config';
import { suggestMealCompletions } from '@/server/domain/meal';
import type { CartInput, Catalog } from '@/server/domain/types';
import { at, IDS, makeCatalog, withProduct } from './fixtures';

const noon = at(12);
const line = (productId: string) => ({ productId, variantId: null, optionIds: [], quantity: 1 });
const burgerOnly: CartInput = { lines: [line(IDS.burger)], bundles: [] };

/** The sample menu with its drinks (and any other categories named) completing a meal; sparkling water is the best drink. */
function completing(...categoryIds: string[]): Catalog {
  const catalog = makeCatalog();
  const marked = { ...catalog, categories: catalog.categories.map((c) => ({ ...c, completesMeal: ['cat-cold', ...categoryIds].includes(c.id) })) };
  return withProduct(marked, IDS.sparkling, { priority: 100, popularity: 95 });
}

const run = (catalog: Catalog, cart: CartInput, dismissed: string[] = [], exclude: string[] = []) =>
  suggestMealCompletions(catalog, cart, dismissed, noon, DEFAULT_ENGINE_CONFIG, exclude);

describe('suggestMealCompletions', () => {
  it('suggests the best drink when the cart has food and no drink', () => {
    expect(run(completing(), burgerOnly)).toEqual([{ suggestionId: `meal:${IDS.sparkling}`, productId: IDS.sparkling, categoryId: 'cat-cold' }]);
  });

  it('suggests nothing for an empty cart', () => {
    expect(run(completing(), { lines: [], bundles: [] })).toEqual([]);
  });

  it('suggests nothing from a category the cart already has, counting the dishes of a set', () => {
    expect(run(completing(), { lines: [line(IDS.burger), line(IDS.coldBrew)], bundles: [] })).toEqual([]);
    expect(run(completing(), { lines: [], bundles: [{ bundleId: 'b-burger-meal', quantity: 1 }] })).toEqual([]);
  });

  it('skips a dismissed suggestion, then a dish that cannot be ordered', () => {
    expect(run(completing(), burgerOnly, [`meal:${IDS.sparkling}`]).map((o) => o.productId)).toEqual([IDS.coldBrew]);
    const soldOut = withProduct(completing(), IDS.coldBrew, { isAvailable: false });
    expect(run(soldOut, burgerOnly, [`meal:${IDS.sparkling}`])).toEqual([]);
    const breakfastOnly = withProduct(withProduct(completing(), IDS.coldBrew, { dayparts: ['BREAKFAST'] }), IDS.sparkling, { dayparts: ['BREAKFAST'] });
    expect(run(breakfastOnly, burgerOnly)).toEqual([]);
  });

  it('gives at most two, one per category in menu order, and never a dish a pairing already offers', () => {
    const offers = run(completing('cat-coffee', 'cat-pastry'), burgerOnly);
    expect(offers.map((o) => o.categoryId)).toEqual(['cat-coffee', 'cat-pastry']);
    expect(run(completing(), burgerOnly, [], [IDS.sparkling]).map((o) => o.productId)).toEqual([IDS.coldBrew]);
  });

  it('suggests nothing when no category completes a meal', () => {
    expect(run(makeCatalog(), burgerOnly)).toEqual([]);
  });
});
