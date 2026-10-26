import { describe, expect, it } from 'vitest';
import { DEFAULT_ENGINE_CONFIG, type EngineConfig } from '@/server/domain/config';
import { suggestUpsells } from '@/server/domain/upsell';
import { at, IDS, makeCatalog, product, withProduct } from './fixtures';

const noon = at(12);

function run(overrides: Partial<Parameters<typeof suggestUpsells>[0]> = {}) {
  return suggestUpsells({
    catalog: makeCatalog(),
    productId: IDS.burger,
    variantId: null,
    optionIds: [],
    now: noon,
    locale: 'en',
    config: DEFAULT_ENGINE_CONFIG,
    ...overrides,
  });
}

describe('suggestUpsells: offers', () => {
  it('prices a bigger size during a discount as the difference of the two sale prices', () => {
    const promotions = [
      {
        id: 'cold-20',
        kind: 'DISCOUNT' as const,
        percentOff: 20,
        productIds: [IDS.coldBrew],
        categoryIds: [],
        startsOn: null,
        endsOn: null,
        startMinute: null,
        endMinute: null,
        daysOfWeek: 127,
        roundTo: 5,
        translations: {},
        sortOrder: 0,
      },
    ];
    const offers = suggestUpsells({
      catalog: makeCatalog({ promotions }),
      productId: IDS.coldBrew,
      variantId: IDS.varRegular,
      optionIds: [],
      now: at(12),
      locale: 'en',
      config: DEFAULT_ENGINE_CONFIG,
    });
    // 500 and 650 regular; 400 and 520 at 20% off.
    expect(offers.find((o) => o.kind === 'VARIANT')).toMatchObject({ refId: IDS.varLarge, priceDelta: 120, resultingTotal: 520 });
  });
});

describe('suggestUpsells', () => {
  it('offers the burger upgrades ranked by score with exact price effects', () => {
    const offers = run();
    expect(offers.map((o) => o.refId)).toEqual([IDS.optDouble, IDS.optCheese, IDS.wagyu]);
    expect(offers[0]).toMatchObject({ kind: 'OPTION', priceDelta: 300, resultingTotal: 1200, title: 'Double patty' });
    expect(offers[0]?.effect).toBe('A second 140 g beef patty');
    expect(offers[2]).toMatchObject({ kind: 'SWAP', priceDelta: 400, resultingTotal: 1300 });
    expect(offers[2]?.title).toBe('Wagyu burger');
  });

  it('gives every offer a stable id and explanatory reasons', () => {
    const offers = run();
    expect(offers[0]?.suggestionId).toBe(`up:${IDS.burger}:OPTION:${IDS.optDouble}`);
    expect(offers.every((o) => o.reasons.length > 0)).toBe(true);
    expect(run()).toEqual(offers);
  });

  it('does not re-offer what is already selected', () => {
    const offers = run({ optionIds: [IDS.optCheese] });
    expect(offers.map((o) => o.refId)).toEqual([IDS.optDouble, IDS.wagyu]);
    expect(offers[0]?.resultingTotal).toBe(1300);
  });

  it('stops offering options once the group is full and drops a swap with no price increase', () => {
    expect(run({ optionIds: [IDS.optCheese, IDS.optDouble] })).toEqual([]);
  });

  it('never offers options that are not flagged as suggested or are unavailable', () => {
    expect(run().some((o) => o.refId === IDS.optBacon)).toBe(false);
    const patched = {
      ...makeCatalog(),
      products: makeCatalog().products.map((p) =>
        p.id === IDS.burger
          ? {
              ...p,
              groups: p.groups.map((g) => ({
                ...g,
                options: g.options.map((o) => (o.id === IDS.optCheese ? { ...o, isAvailable: false } : o)),
              })),
            }
          : p,
      ),
    };
    expect(run({ catalog: patched }).some((o) => o.refId === IDS.optCheese)).toBe(false);
  });

  it('applies the delta cap relative to the current price', () => {
    const config: EngineConfig = { ...DEFAULT_ENGINE_CONFIG, upsellDeltaCapRatio: 0.2 };
    expect(run({ config }).map((o) => o.refId)).toEqual([IDS.optCheese]);
  });

  it('offers at most one product swap, choosing the stronger rule', () => {
    const base = makeCatalog();
    const catalog = {
      ...base,
      products: [...base.products, product({ id: 'p-wagyu2', basePrice: 1200, cost: 500, popularity: 50, slot: 'MAIN' })],
      upsellRules: [
        ...base.upsellRules,
        {
          id: 'u-wagyu2',
          sourceProductId: IDS.burger,
          targetProductId: 'p-wagyu2',
          priority: 60,
          dayparts: [],
          translations: { en: { pitch: 'Other burger' } },
        },
      ],
    };
    const swaps = run({ catalog }).filter((o) => o.kind === 'SWAP');
    expect(swaps).toHaveLength(1);
    expect(swaps[0]?.refId).toBe(IDS.wagyu);
  });

  it('respects the maximum number of offers', () => {
    const config: EngineConfig = { ...DEFAULT_ENGINE_CONFIG, upsellMaxOffers: 1 };
    expect(run({ config })).toHaveLength(1);
  });

  it('skips a swap whose target is unavailable or outside its dayparts', () => {
    const off = withProduct(makeCatalog(), IDS.wagyu, { isAvailable: false });
    expect(run({ catalog: off }).some((o) => o.kind === 'SWAP')).toBe(false);
    const dinnerOnly = withProduct(makeCatalog(), IDS.wagyu, { dayparts: ['DINNER'] });
    expect(run({ catalog: dinnerOnly }).some((o) => o.kind === 'SWAP')).toBe(false);
    expect(run({ catalog: dinnerOnly, now: at(19) }).some((o) => o.kind === 'SWAP')).toBe(true);
  });

  it('offers a larger variant with its delta, and nothing once it is chosen', () => {
    const offers = run({ productId: IDS.coldBrew });
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ kind: 'VARIANT', refId: IDS.varLarge, priceDelta: 150, resultingTotal: 650 });
    expect(run({ productId: IDS.coldBrew, variantId: IDS.varLarge })).toEqual([]);
  });

  it('returns nothing for an unknown or unavailable product', () => {
    expect(run({ productId: 'nope' })).toEqual([]);
    expect(run({ catalog: withProduct(makeCatalog(), IDS.burger, { isAvailable: false }) })).toEqual([]);
  });

  it('falls back to English text when the locale has no translation', () => {
    expect(run({ locale: 'ar' })[0]?.title).toBe('Double patty');
  });

  it('never recommends a high-margin product that has no relationship to the selection', () => {
    const catalog = makeCatalog();
    for (const p of catalog.products) {
      const offers = run({ catalog, productId: p.id });
      expect(offers.some((o) => o.refId === IDS.caviar)).toBe(false);
    }
  });
});
