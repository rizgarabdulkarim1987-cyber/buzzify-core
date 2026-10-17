import { describe, expect, it } from 'vitest';
import { menuPriceStep, planBulkPrices as plan, type BulkOperation } from '@/server/domain/bulk-prices';

const usd = { includeVariants: false, step: 5 };
const withSizes = { includeVariants: true, step: 5 };

/** The new base price of one product without sizes. */
const base = (price: number, op: BulkOperation, step: number) =>
  plan([{ id: 'p', basePrice: price, variants: [] }], op, { includeVariants: false, step }).rows[0]!.newPrice;

const coffee = [{ id: 'p', basePrice: 450, variants: [{ id: 'v', priceDelta: 100 }] }];

describe('planBulkPrices', () => {
  it('adds 7.5% and rounds to the step', () =>
    expect(plan([{ id: 'p', basePrice: 455, variants: [] }], { kind: 'percent', basisPoints: 750 }, usd).products).toEqual([{ id: 'p', basePrice: 490 }]));

  it('rounds IQD to 250', () => expect(base(6000, { kind: 'percent', basisPoints: 1000 }, 250)).toBe(6500));

  it('keeps 6,750 for +12.5% on 6,000 IQD', () => expect(base(6000, { kind: 'percent', basisPoints: 1250 }, 250)).toBe(6750));

  it('moves sizes with the base when they are not included', () => {
    const result = plan(coffee, { kind: 'add', amount: 50 }, usd);
    expect(result.products).toEqual([{ id: 'p', basePrice: 500 }]);
    expect(result.variants).toEqual([]);
    expect(result.rows).toEqual([
      { productId: 'p', variantId: null, oldPrice: 450, newPrice: 500 },
      { productId: 'p', variantId: 'v', oldPrice: 550, newPrice: 600 },
    ]);
  });

  it('raises sizes by their own price when included', () => {
    const result = plan(coffee, { kind: 'percent', basisPoints: 1000 }, withSizes);
    expect(result.products).toEqual([{ id: 'p', basePrice: 495 }]);
    expect(result.variants).toEqual([{ id: 'v', priceDelta: 110 }]);
    expect(result.rows[1]).toEqual({ productId: 'p', variantId: 'v', oldPrice: 550, newPrice: 605 });
  });

  it('sets every included price to the typed amount as it is', () => {
    const result = plan(coffee, { kind: 'set', amount: 499 }, withSizes);
    expect(result.products).toEqual([{ id: 'p', basePrice: 499 }]);
    expect(result.variants).toEqual([{ id: 'v', priceDelta: 0 }]);
  });

  it('flags a price that would fall to zero or below', () => {
    const result = plan(coffee, { kind: 'add', amount: -500 }, usd);
    expect(result.rows[0]).toEqual({ productId: 'p', variantId: null, oldPrice: 450, newPrice: -50, problem: 'NOT_POSITIVE' });
    expect(plan(coffee, { kind: 'set', amount: 0 }, usd).rows[0]!.problem).toBe('NOT_POSITIVE');
  });

  it('leaves a free product free under a percentage, without a problem', () => {
    const result = plan([{ id: 'p', basePrice: 0, variants: [] }], { kind: 'percent', basisPoints: 1000 }, usd);
    expect(result.rows).toEqual([{ productId: 'p', variantId: null, oldPrice: 0, newPrice: 0 }]);
    expect(result.products).toEqual([]);
  });

  it('lists only the rows that change', () => {
    const result = plan(
      [
        { id: 'a', basePrice: 500, variants: [] },
        { id: 'b', basePrice: 450, variants: [] },
      ],
      { kind: 'set', amount: 500 },
      usd,
    );
    expect(result.products).toEqual([{ id: 'b', basePrice: 500 }]);
    expect(result.rows).toHaveLength(2);
  });
});

describe('menuPriceStep', () => {
  it("uses the menu's own step, else the currency's", () => {
    expect(menuPriceStep({ priceStep: 100, currency: 'USD' })).toBe(100);
    expect(menuPriceStep({ priceStep: null, currency: 'USD' })).toBe(5);
    expect(menuPriceStep({ priceStep: null, currency: 'IQD' })).toBe(250);
  });
});
