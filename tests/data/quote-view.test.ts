import { describe, expect, it } from 'vitest';
import { describeQuote } from '@/server/data/quote-view';
import { quoteCart } from '@/server/domain/pricing';
import { at, IDS, makeCatalog } from '../domain/fixtures';

describe('describeQuote', () => {
  it('adds localized names to quote lines and bundles', () => {
    const catalog = makeCatalog();
    const quote = quoteCart(
      catalog,
      {
        lines: [{ productId: IDS.burger, variantId: null, optionIds: [IDS.optCheese], quantity: 1 }],
        bundles: [{ bundleId: 'b-burger-meal', quantity: 1 }],
      },
      at(12),
    );
    const view = describeQuote(catalog, quote, 'en');
    expect(view.lines[0]).toMatchObject({ name: IDS.burger, optionNames: ['Premium cheese'], variantName: null });
    expect(view.bundles[0]).toMatchObject({ name: 'Burger meal' });
    expect(view.subtotal).toBe(quote.subtotal);
  });

  it('names a stale product as an empty string without throwing', () => {
    const catalog = makeCatalog();
    const quote = quoteCart(
      catalog,
      { lines: [{ productId: 'gone', variantId: null, optionIds: [], quantity: 1 }], bundles: [] },
      at(12),
    );
    expect(describeQuote(catalog, quote, 'en').lines[0]?.name).toBe('');
  });
});
