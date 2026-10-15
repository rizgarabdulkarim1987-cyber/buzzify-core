import { describe, expect, it } from 'vitest';
import { DEFAULT_ENGINE_CONFIG } from '@/server/domain/config';
import { suggestPairings, type PairingInput } from '@/server/domain/pairing';
import type { CartInput, CartLineInput } from '@/server/domain/types';
import { at, IDS, makeCatalog, withProduct } from './fixtures';

const noon = at(12);
const line = (productId: string, quantity = 1): CartLineInput => ({ productId, variantId: null, optionIds: [], quantity });
const cartOf = (...ids: string[]): CartInput => ({ lines: ids.map((id) => line(id)), bundles: [] });

function run(overrides: Partial<PairingInput> = {}) {
  return suggestPairings({
    catalog: makeCatalog(),
    cart: cartOf(IDS.burger),
    dismissedIds: [],
    now: noon,
    locale: 'en',
    config: DEFAULT_ENGINE_CONFIG,
    ...overrides,
  });
}

describe('suggestPairings', () => {
  it('ranks the strongest relevant pairing first and explains it', () => {
    const offers = run();
    expect(offers.map((o) => o.productId)).toEqual([IDS.fries, IDS.sparkling]);
    expect(offers[0]?.reason).toBe('Crisp and salted, the classic partner');
    expect(offers[0]?.suggestionId).toBe(`pair:${IDS.fries}`);
  });

  it('returns nothing for an empty cart', () => {
    expect(run({ cart: { lines: [], bundles: [] } })).toEqual([]);
  });

  it('matches category rules against any product in the category', () => {
    const offers = run({ cart: cartOf(IDS.espresso), now: at(9) });
    expect(offers.map((o) => o.productId)).toEqual([IDS.croissant, IDS.cheesecake]);
  });

  it('skips targets outside their own dayparts', () => {
    const offers = run({ cart: cartOf(IDS.espresso), now: noon });
    expect(offers.map((o) => o.productId)).toEqual([IDS.cheesecake]);
  });

  it('does not suggest what is already in the cart, including inside a bundle', () => {
    expect(run({ cart: cartOf(IDS.burger, IDS.fries) }).map((o) => o.productId)).toEqual([IDS.sparkling]);
    const withBundle = run({ cart: { lines: [], bundles: [{ bundleId: 'b-burger-meal', quantity: 1 }] } });
    expect(withBundle.map((o) => o.productId)).not.toContain(IDS.fries);
    expect(withBundle.map((o) => o.productId)).not.toContain(IDS.sparkling);
  });

  it('suppresses a suggestion whose slot is already filled', () => {
    const offers = run({ cart: cartOf(IDS.burger, IDS.espresso) });
    expect(offers.map((o) => o.productId)).not.toContain(IDS.sparkling); // DRINK slot filled by espresso
    expect(offers.map((o) => o.productId)).toContain(IDS.fries);
  });

  it('offers at most one product per slot', () => {
    const base = makeCatalog();
    const catalog = {
      ...base,
      pairingRules: [
        ...base.pairingRules,
        {
          id: 'r-burger-coldbrew',
          sourceType: 'PRODUCT' as const,
          sourceProductId: IDS.burger,
          sourceCategoryId: null,
          targetProductId: IDS.coldBrew,
          weight: 60,
          dayparts: [],
          translations: { en: { reason: 'Cold brew' } },
        },
      ],
    };
    const drinkIds: string[] = [IDS.sparkling, IDS.coldBrew];
    const drinks = run({ catalog }).filter((o) => drinkIds.includes(o.productId));
    expect(drinks).toHaveLength(1);
    expect(drinks[0]?.productId).toBe(IDS.coldBrew);
  });

  it('skips dismissed suggestions', () => {
    const offers = run({ dismissedIds: [`pair:${IDS.fries}`] });
    expect(offers.map((o) => o.productId)).toEqual([IDS.sparkling]);
  });

  it('rewards a target supported by several cart items without letting it run away', () => {
    const single = run({ cart: cartOf(IDS.burger) }).find((o) => o.productId === IDS.fries);
    const double = run({ cart: cartOf(IDS.burger, IDS.steak) }).find((o) => o.productId === IDS.fries);
    expect(double?.score).toBeGreaterThan(single?.score ?? 0);
    expect((double?.score ?? 0) - (single?.score ?? 0)).toBeLessThan(0.3);
  });

  it('excludes unavailable targets and penalises low stock', () => {
    const gone = withProduct(makeCatalog(), IDS.fries, { isAvailable: false });
    expect(run({ catalog: gone }).map((o) => o.productId)).toEqual([IDS.sparkling]);

    const normal = run().find((o) => o.productId === IDS.fries);
    const low = withProduct(makeCatalog(), IDS.fries, { stockCount: 2, lowStockThreshold: 5 });
    const penalised = run({ catalog: low }).find((o) => o.productId === IDS.fries);
    expect(penalised?.score).toBeLessThan(normal?.score ?? 0);
  });

  it('never invents candidates from margin alone', () => {
    expect(run({ cart: cartOf(IDS.caviar) })).toEqual([]);
    for (const p of makeCatalog().products) {
      expect(run({ cart: cartOf(p.id) }).some((o) => o.productId === IDS.caviar)).toBe(false);
    }
  });

  it('respects the maximum number of offers', () => {
    expect(run({ maxOffers: 1 })).toHaveLength(1);
  });

  it('is deterministic', () => {
    expect(run()).toEqual(run());
  });
});
