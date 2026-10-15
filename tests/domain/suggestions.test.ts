import { describe, expect, it } from 'vitest';
import { DEFAULT_ENGINE_CONFIG } from '@/server/domain/config';
import { buildSuggestions } from '@/server/domain/suggestions';
import type { CartInput } from '@/server/domain/types';
import { at, IDS, makeCatalog, withProduct } from './fixtures';

const empty: CartInput = { lines: [], bundles: [] };
const noon = at(12);

describe('buildSuggestions', () => {
  it('menu context returns the daypart and a signature pick only', () => {
    const catalog = withProduct(makeCatalog(), IDS.croissant, { isSignature: true });
    const result = buildSuggestions(
      catalog,
      { context: 'menu', locale: 'en', cart: empty, dismissedIds: [] },
      at(9),
      DEFAULT_ENGINE_CONFIG,
    );
    expect(result.daypart).toBe('BREAKFAST');
    expect(result.signature).toMatchObject({ productId: IDS.croissant, suggestionId: `sig:${IDS.croissant}` });
    expect(result.upgrades).toEqual([]);
    expect(result.pairings).toEqual([]);
    expect(result.bundles).toEqual([]);
  });

  it('product context returns upgrades and pairings for that product even with an empty cart', () => {
    const result = buildSuggestions(
      makeCatalog(),
      {
        context: 'product',
        locale: 'en',
        product: { productId: IDS.burger, variantId: null, optionIds: [] },
        cart: empty,
        dismissedIds: [],
      },
      noon,
      DEFAULT_ENGINE_CONFIG,
    );
    expect(result.upgrades.map((o) => o.refId)).toEqual([IDS.optDouble, IDS.optCheese, IDS.wagyu]);
    expect(result.pairings.map((o) => o.productId)).toEqual([IDS.fries, IDS.sparkling]);
    expect(result.signature).toBeNull();
  });

  it('cart context limits pairings and includes bundle opportunities', () => {
    const cart: CartInput = {
      lines: [
        { productId: IDS.burger, variantId: null, optionIds: [], quantity: 1 },
        { productId: IDS.steak, variantId: null, optionIds: [IDS.optRare], quantity: 1 },
        { productId: IDS.fries, variantId: null, optionIds: [], quantity: 1 },
        { productId: IDS.sparkling, variantId: null, optionIds: [], quantity: 1 },
      ],
      bundles: [],
    };
    const result = buildSuggestions(
      makeCatalog(),
      { context: 'cart', locale: 'en', cart, dismissedIds: [] },
      noon,
      DEFAULT_ENGINE_CONFIG,
    );
    expect(result.pairings.length).toBeLessThanOrEqual(DEFAULT_ENGINE_CONFIG.cartPairingMaxOffers);
    expect(result.bundles.map((b) => b.bundleId)).toEqual(['b-burger-meal']);
    expect(result.upgrades).toEqual([]);
  });

  it('honours dismissed pairings', () => {
    const result = buildSuggestions(
      makeCatalog(),
      {
        context: 'product',
        locale: 'en',
        product: { productId: IDS.burger, variantId: null, optionIds: [] },
        cart: empty,
        dismissedIds: [`pair:${IDS.fries}`],
      },
      noon,
      DEFAULT_ENGINE_CONFIG,
    );
    expect(result.pairings.map((o) => o.productId)).toEqual([IDS.sparkling]);
  });

  it('returns empty upgrades for an unknown product without throwing', () => {
    const result = buildSuggestions(
      makeCatalog(),
      {
        context: 'product',
        locale: 'en',
        product: { productId: 'nope', variantId: null, optionIds: [] },
        cart: empty,
        dismissedIds: [],
      },
      noon,
      DEFAULT_ENGINE_CONFIG,
    );
    expect(result.upgrades).toEqual([]);
    expect(result.pairings).toEqual([]);
  });
});
