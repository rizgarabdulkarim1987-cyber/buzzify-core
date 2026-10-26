import { describe, expect, it } from 'vitest';
import { lowestPriceFromMenu, optionExtraFromMenu, unitPriceFromMenu, variantExtraFromMenu } from '@/lib/menu-price';
import { buildMenuView } from '@/server/data/menu-view';
import type { TenantInfo } from '@/server/data/tenant';
import { DEFAULT_ENGINE_CONFIG } from '@/server/domain/config';
import { priceOf, unitPrice } from '@/server/domain/catalog';
import { liveOffers } from '@/server/domain/offers';
import { at, IDS, makeCatalog, product } from '../domain/fixtures';

const tenant = {
  id: 'r',
  slug: 'r',
  name: 'R',
  currency: 'USD',
  defaultLocale: 'en',
  locales: ['en'],
  timeZone: 'Asia/Baghdad',
  numeralSystem: 'latn',
  engineConfig: DEFAULT_ENGINE_CONFIG,
  features: { explore: true, stage: true, smartSelling: true, offers: true, socialProof: true, rails: [] },
  brand: { logoText: 'R', theme: 'dark', motionIntensity: 'subtle', tokens: {} },
  motions: [],
} as unknown as TenantInfo;

describe('unitPriceFromMenu', () => {
  const discount = product({
    id: 'p-discount',
    basePrice: 100,
    groups: [
      {
        id: 'g',
        productId: 'p-discount',
        minSelect: 0,
        maxSelect: 1,
        translations: { en: { name: 'G' } },
        options: [
          {
            id: 'o-neg',
            groupId: 'g',
            priceDelta: -500,
            costDelta: null,
            isSuggested: false,
            suggestPriority: 0,
            visualKey: null,
            isAvailable: true,
            translations: { en: { name: 'Neg' } },
          },
        ],
      },
    ],
  });
  const base = makeCatalog();
  const catalog = { ...base, products: [...base.products, discount] };
  const view = buildMenuView(catalog, tenant, 'en', at(12));

  it('matches the server unit price for every product, variant and single option', () => {
    for (const source of catalog.products) {
      const shown = view.products.find((p) => p.id === source.id)!;
      const variantIds: Array<string | null> = [null, ...source.variants.map((v) => v.id)];
      const optionSets: string[][] = [[], ...source.groups.flatMap((g) => g.options.map((o) => [o.id]))];
      for (const variantId of variantIds) {
        for (const optionIds of optionSets) {
          expect(unitPriceFromMenu(shown, variantId, optionIds), `${source.id} ${variantId} ${optionIds}`).toBe(
            unitPrice(source, variantId, optionIds).price,
          );
        }
      }
    }
  });

  it('matches the server sale price for every product, variant and option during a discount', () => {
    const offers = makeCatalog({
      products: catalog.products,
      promotions: [
        {
          id: 'all-plates',
          kind: 'DISCOUNT',
          percentOff: 15,
          productIds: [IDS.coldBrew],
          categoryIds: ['cat-plates'],
          startsOn: null,
          endsOn: null,
          startMinute: null,
          endMinute: null,
          daysOfWeek: 127,
          roundTo: 25,
          translations: {},
          sortOrder: 0,
        },
      ],
    });
    const discounted = buildMenuView(offers, tenant, 'en', at(12));
    const live = liveOffers(offers, at(12));
    for (const source of offers.products) {
      const shown = discounted.products.find((p) => p.id === source.id)!;
      for (const variantId of [null, ...source.variants.map((v) => v.id)]) {
        for (const optionIds of [[], ...source.groups.flatMap((g) => g.options.map((o) => [o.id]))]) {
          expect(unitPriceFromMenu(shown, variantId, optionIds), `${source.id} ${variantId} ${optionIds}`).toBe(priceOf(source, variantId, optionIds, live).price);
        }
      }
    }
  });

  it('says what a size or an option adds now, the discount included', () => {
    const promotions = [
      {
        id: 'twenty',
        kind: 'DISCOUNT' as const,
        percentOff: 20,
        productIds: [IDS.burger, IDS.coldBrew],
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
    const regular = buildMenuView(makeCatalog(), tenant, 'en', at(12));
    const discounted = buildMenuView(makeCatalog({ promotions }), tenant, 'en', at(12));
    const burgerOf = (v: typeof regular) => v.products.find((p) => p.id === IDS.burger)!;
    const coldOf = (v: typeof regular) => v.products.find((p) => p.id === IDS.coldBrew)!;
    const addons = burgerOf(regular).groups[0]!.options.map((o) => o.id);

    expect(optionExtraFromMenu(burgerOf(regular), null, [], addons, IDS.optCheese)).toBe(100);
    expect(optionExtraFromMenu(burgerOf(discounted), null, [], addons, IDS.optCheese)).toBe(80);
    // Against the other choices made, without the option's own group.
    expect(optionExtraFromMenu(burgerOf(discounted), null, [IDS.optDouble], addons, IDS.optCheese)).toBe(80);
    expect(variantExtraFromMenu(coldOf(regular), IDS.varLarge, IDS.varRegular, [])).toBe(150);
    expect(variantExtraFromMenu(coldOf(discounted), IDS.varLarge, IDS.varRegular, [])).toBe(120);
  });

  it('matches for the burger with two options and clamps at zero', () => {
    const burger = view.products.find((p) => p.id === IDS.burger)!;
    expect(unitPriceFromMenu(burger, null, [IDS.optCheese, IDS.optDouble])).toBe(1300);
    const shown = view.products.find((p) => p.id === 'p-discount')!;
    expect(unitPriceFromMenu(shown, null, ['o-neg'])).toBe(0);
  });
});

describe('lowestPriceFromMenu', () => {
  const twenty = {
    id: 'twenty',
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
  };
  // Cold brew served large by default (500 + 150), so its regular size (500) is the cheaper one.
  const largeFirst = makeCatalog().products.map((p) =>
    p.id === IDS.coldBrew ? { ...p, variants: p.variants.map((v) => ({ ...v, isDefault: v.id === IDS.varLarge })) } : p,
  );
  const coldIn = (promotions: (typeof twenty)[]) =>
    buildMenuView(makeCatalog({ products: largeFirst, promotions }), tenant, 'en', at(12)).products.find((p) => p.id === IDS.coldBrew)!;

  it('is the cheapest size with no options, at its regular price when nothing is discounted', () => {
    const cold = coldIn([]);
    expect(cold.displayPrice).toBe(650);
    expect(lowestPriceFromMenu(cold)).toEqual({ price: 500, regular: 500 });
  });

  it('is the cheapest size now and before the discount while one is live', () => {
    const cold = coldIn([twenty]);
    expect(cold.displayPrice).toBe(520);
    expect(lowestPriceFromMenu(cold)).toEqual({ price: 400, regular: 500 });
  });

  it('is the dish’s own price when it comes in one size', () => {
    const burger = buildMenuView(makeCatalog(), tenant, 'en', at(12)).products.find((p) => p.id === IDS.burger)!;
    expect(lowestPriceFromMenu(burger)).toEqual({ price: burger.displayPrice, regular: burger.displayPrice });
  });
});
