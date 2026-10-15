import { describe, expect, it } from 'vitest';
import { applyBundle, compareBundle, detectBundleOpportunities } from '@/server/domain/bundles';
import { quoteCart } from '@/server/domain/pricing';
import type { CartInput, CartLineInput } from '@/server/domain/types';
import { at, IDS, makeCatalog, withProduct } from './fixtures';

const catalog = makeCatalog();
const noon = at(12);
const line = (productId: string, quantity = 1, optionIds: string[] = []): CartLineInput => ({
  productId,
  variantId: null,
  optionIds,
  quantity,
});

describe('compareBundle', () => {
  it('reports the real saving against the live sum of items', () => {
    const bundle = catalog.bundles.find((b) => b.id === 'b-burger-meal')!;
    expect(compareBundle(catalog, bundle)).toEqual({
      bundleId: 'b-burger-meal',
      individualTotal: 1750,
      bundlePrice: 1500,
      savings: 250,
      isDeal: true,
    });
  });

  it('does not call a bundle a deal when it saves nothing', () => {
    const bundle = catalog.bundles.find((b) => b.id === 'b-not-a-deal')!;
    expect(compareBundle(catalog, bundle)).toMatchObject({ savings: 0, isDeal: false });
  });

  it('follows current prices, not stored ones', () => {
    const pricier = withProduct(catalog, IDS.fries, { basePrice: 800 });
    const bundle = pricier.bundles.find((b) => b.id === 'b-burger-meal')!;
    expect(compareBundle(pricier, bundle)?.savings).toBe(500);
  });

  it('returns null when an item no longer exists', () => {
    const broken = { ...catalog, products: catalog.products.filter((p) => p.id !== IDS.fries) };
    expect(compareBundle(broken, broken.bundles.find((b) => b.id === 'b-burger-meal')!)).toBeNull();
  });
});

describe('detectBundleOpportunities', () => {
  it('finds a complete set and totals the saving', () => {
    const cart: CartInput = { lines: [line(IDS.burger), line(IDS.fries), line(IDS.sparkling)], bundles: [] };
    const found = detectBundleOpportunities(catalog, cart, noon);
    expect(found).toEqual([
      {
        suggestionId: 'bundle:b-burger-meal',
        bundleId: 'b-burger-meal',
        times: 1,
        individualTotal: 1750,
        bundlePrice: 1500,
        savings: 250,
      },
    ]);
  });

  it('multiplies by how many full sets the cart contains', () => {
    const cart: CartInput = { lines: [line(IDS.burger, 2), line(IDS.fries, 2), line(IDS.sparkling, 3)], bundles: [] };
    const found = detectBundleOpportunities(catalog, cart, noon)[0];
    expect(found?.times).toBe(2);
    expect(found?.savings).toBe(500);
  });

  it('needs every item and ignores lines with customisations', () => {
    expect(detectBundleOpportunities(catalog, { lines: [line(IDS.burger), line(IDS.fries)], bundles: [] }, noon)).toEqual([]);
    const customised: CartInput = {
      lines: [line(IDS.burger, 1, [IDS.optCheese]), line(IDS.fries), line(IDS.sparkling)],
      bundles: [],
    };
    expect(detectBundleOpportunities(catalog, customised, noon)).toEqual([]);
  });

  it('never suggests a bundle that is not a real deal', () => {
    const cart: CartInput = { lines: [line(IDS.burger), line(IDS.fries)], bundles: [] };
    expect(detectBundleOpportunities(catalog, cart, noon).map((o) => o.bundleId)).not.toContain('b-not-a-deal');
  });

  it('respects bundle dayparts', () => {
    const cart: CartInput = { lines: [line(IDS.croissant), line(IDS.espresso)], bundles: [] };
    expect(detectBundleOpportunities(catalog, cart, noon)).toEqual([]);
    expect(detectBundleOpportunities(catalog, cart, at(9)).map((o) => o.bundleId)).toEqual(['b-breakfast']);
  });
});

describe('applyBundle', () => {
  it('moves matching quantities from lines into the bundle', () => {
    const cart: CartInput = { lines: [line(IDS.burger, 2), line(IDS.fries), line(IDS.sparkling)], bundles: [] };
    const next = applyBundle(cart, catalog, 'b-burger-meal', 1);
    expect(next.lines).toEqual([line(IDS.burger, 1)]);
    expect(next.bundles).toEqual([{ bundleId: 'b-burger-meal', quantity: 1 }]);
  });

  it('merges into an existing bundle line', () => {
    const cart: CartInput = {
      lines: [line(IDS.burger), line(IDS.fries), line(IDS.sparkling)],
      bundles: [{ bundleId: 'b-burger-meal', quantity: 1 }],
    };
    expect(applyBundle(cart, catalog, 'b-burger-meal', 1).bundles).toEqual([{ bundleId: 'b-burger-meal', quantity: 2 }]);
  });

  it('leaves the cart unchanged when the set is incomplete', () => {
    const cart: CartInput = { lines: [line(IDS.burger)], bundles: [] };
    expect(applyBundle(cart, catalog, 'b-burger-meal', 1)).toEqual(cart);
  });

  it('lowers the quoted subtotal', () => {
    const cart: CartInput = { lines: [line(IDS.burger), line(IDS.fries), line(IDS.sparkling)], bundles: [] };
    const before = quoteCart(catalog, cart, noon).subtotal;
    const after = quoteCart(catalog, applyBundle(cart, catalog, 'b-burger-meal', 1), noon).subtotal;
    expect(before).toBe(1750);
    expect(after).toBe(1500);
  });
});
