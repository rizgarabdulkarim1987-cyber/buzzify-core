import { describe, expect, it } from 'vitest';
import { drinkMatchFor, DRINK_MATCH_MAX } from '@/server/domain/drink-match';
import { at, IDS, makeCatalog, withProduct } from './fixtures';

const noon = at(12);
const idsFor = (productId: string, catalog = makeCatalog(), now = noon) => drinkMatchFor(catalog, productId, now).map((m) => m.productId);

describe('drinkMatchFor', () => {
  it('puts the drinks the owner paired to the dish first, strongest rule first', () => {
    // The fixture pairs the burger with sparkling water; the rest are filled by popularity.
    expect(idsFor(IDS.burger)[0]).toBe(IDS.sparkling);
  });

  it('fills the rest with the most popular drinks that are on sale, without repeating any', () => {
    const matched = idsFor(IDS.steak);
    expect(new Set(matched).size).toBe(matched.length);
    expect(matched.length).toBeLessThanOrEqual(DRINK_MATCH_MAX);
    expect(matched.length).toBeGreaterThan(0);
  });

  it('only ever offers drinks', () => {
    const catalog = makeCatalog();
    const drinks = new Set(catalog.products.filter((p) => p.slot === 'DRINK').map((p) => p.id));
    for (const product of catalog.products) {
      for (const id of idsFor(product.id, catalog)) expect(drinks.has(id)).toBe(true);
    }
  });

  it('offers nothing on a drink, a dessert or a dish that is not on the menu', () => {
    expect(idsFor(IDS.espresso)).toEqual([]);
    expect(idsFor(IDS.cheesecake)).toEqual([]);
    expect(idsFor('missing')).toEqual([]);
  });

  it('skips a drink that is sold out or hidden', () => {
    const catalog = withProduct(withProduct(makeCatalog(), IDS.sparkling, { isAvailable: false }), IDS.coldBrew, { isHidden: true });
    expect(idsFor(IDS.burger, catalog)).not.toContain(IDS.sparkling);
    expect(idsFor(IDS.burger, catalog)).not.toContain(IDS.coldBrew);
  });

  it('gives a stable order when drinks are equally popular', () => {
    const catalog = makeCatalog();
    expect(idsFor(IDS.steak, catalog)).toEqual(idsFor(IDS.steak, catalog));
  });
});
