import { describe, expect, it } from 'vitest';
import { quoteCart } from '@/server/domain/pricing';
import type { CartInput, CartLineInput } from '@/server/domain/types';
import { at, IDS, makeCatalog, product, withProduct } from './fixtures';

const catalog = makeCatalog();
const noon = at(12);
const morning = at(9);

function line(overrides: Partial<CartLineInput> & Pick<CartLineInput, 'productId'>): CartLineInput {
  return { variantId: null, optionIds: [], quantity: 1, ...overrides };
}
function cart(...lines: CartLineInput[]): CartInput {
  return { lines, bundles: [] };
}
const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

describe('quoteCart: pricing', () => {
  it('prices a plain line from the catalog, ignoring any client price', () => {
    const quote = quoteCart(catalog, cart(line({ productId: IDS.burger, quantity: 2 })), noon);
    expect(quote.lines[0]?.unitPrice).toBe(900);
    expect(quote.lines[0]?.lineTotal).toBe(1800);
    expect(quote.subtotal).toBe(1800);
    expect(quote.currency).toBe('USD');
    expect(quote.hasBlockingIssues).toBe(false);
    expect(quote.charges).toEqual([]);
  });

  it('adds option deltas to the unit price', () => {
    const quote = quoteCart(
      catalog,
      cart(line({ productId: IDS.burger, optionIds: [IDS.optCheese, IDS.optDouble] })),
      noon,
    );
    expect(quote.lines[0]?.unitPrice).toBe(1300);
  });

  it('uses the default variant when none is given and adds a chosen variant delta', () => {
    const base = quoteCart(catalog, cart(line({ productId: IDS.coldBrew })), noon);
    expect(base.lines[0]?.unitPrice).toBe(500);
    const large = quoteCart(catalog, cart(line({ productId: IDS.coldBrew, variantId: IDS.varLarge })), noon);
    expect(large.lines[0]?.unitPrice).toBe(650);
  });

  it('de-duplicates repeated option ids', () => {
    const quote = quoteCart(
      catalog,
      cart(line({ productId: IDS.burger, optionIds: [IDS.optCheese, IDS.optCheese] })),
      noon,
    );
    expect(quote.lines[0]?.unitPrice).toBe(1000);
    expect(quote.lines[0]?.issues).toEqual([]);
  });

  it('sums several lines', () => {
    const quote = quoteCart(
      catalog,
      cart(line({ productId: IDS.burger }), line({ productId: IDS.fries, quantity: 2 })),
      noon,
    );
    expect(quote.subtotal).toBe(900 + 1100);
  });
});

describe('quoteCart: issues', () => {
  it('flags an unknown product and excludes it from the subtotal', () => {
    const quote = quoteCart(
      catalog,
      cart(line({ productId: 'does-not-exist' }), line({ productId: IDS.fries })),
      noon,
    );
    expect(codes(quote.lines[0]?.issues ?? [])).toEqual(['UNKNOWN_PRODUCT']);
    expect(quote.subtotal).toBe(550);
    expect(quote.hasBlockingIssues).toBe(true);
  });

  it('flags a product disabled after it was added (stale cart line)', () => {
    const disabled = withProduct(catalog, IDS.fries, { isAvailable: false });
    const quote = quoteCart(disabled, cart(line({ productId: IDS.burger }), line({ productId: IDS.fries })), noon);
    expect(codes(quote.lines[1]?.issues ?? [])).toEqual(['UNAVAILABLE']);
    expect(quote.lines[1]?.lineTotal).toBe(0);
    expect(quote.subtotal).toBe(900);
    expect(quote.hasBlockingIssues).toBe(true);
  });

  it('flags a sold-out product', () => {
    const soldOut = withProduct(catalog, IDS.fries, { stockCount: 0 });
    const quote = quoteCart(soldOut, cart(line({ productId: IDS.fries })), noon);
    expect(codes(quote.lines[0]?.issues ?? [])).toEqual(['OUT_OF_STOCK']);
  });

  it('blocks a daypart-restricted product only when it is hidden outside its dayparts', () => {
    const soft = quoteCart(catalog, cart(line({ productId: IDS.croissant })), noon);
    expect(soft.lines[0]?.issues).toEqual([]);

    const hard = withProduct(catalog, IDS.croissant, { hideOutsideDaypart: true });
    expect(codes(quoteCart(hard, cart(line({ productId: IDS.croissant })), noon).lines[0]?.issues ?? [])).toEqual([
      'OUT_OF_DAYPART',
    ]);
    expect(quoteCart(hard, cart(line({ productId: IDS.croissant })), morning).lines[0]?.issues).toEqual([]);
  });

  it('enforces required and maximum option group sizes', () => {
    const missing = quoteCart(catalog, cart(line({ productId: IDS.steak })), noon);
    expect(codes(missing.lines[0]?.issues ?? [])).toEqual(['GROUP_MIN']);

    const ok = quoteCart(catalog, cart(line({ productId: IDS.steak, optionIds: [IDS.optRare] })), noon);
    expect(ok.lines[0]?.issues).toEqual([]);

    const tooMany = quoteCart(
      catalog,
      cart(line({ productId: IDS.steak, optionIds: [IDS.optRare, IDS.optWell] })),
      noon,
    );
    expect(codes(tooMany.lines[0]?.issues ?? [])).toEqual(['GROUP_MAX']);
  });

  it('rejects options and variants that belong to another product', () => {
    const quote = quoteCart(
      catalog,
      cart(line({ productId: IDS.fries, optionIds: [IDS.optCheese], variantId: IDS.varLarge })),
      noon,
    );
    expect(codes(quote.lines[0]?.issues ?? []).sort()).toEqual(['UNKNOWN_OPTION', 'UNKNOWN_VARIANT']);
  });

  it('flags an unavailable option', () => {
    const patched = {
      ...catalog,
      products: catalog.products.map((p) =>
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
    const quote = quoteCart(patched, cart(line({ productId: IDS.burger, optionIds: [IDS.optCheese] })), noon);
    expect(codes(quote.lines[0]?.issues ?? [])).toEqual(['OPTION_UNAVAILABLE']);
  });

  it('rejects bad quantities', () => {
    for (const quantity of [0, -1, 21, 1.5, Number.NaN]) {
      const quote = quoteCart(catalog, cart(line({ productId: IDS.fries, quantity })), noon);
      expect(codes(quote.lines[0]?.issues ?? [])).toContain('BAD_QUANTITY');
      expect(quote.lines[0]?.lineTotal).toBe(0);
      expect(quote.subtotal).toBe(0);
    }
  });
});

describe('quoteCart: price floor', () => {
  it('clamps a negative price delta so totals never go below zero', () => {
    const cheap = product({
      id: 'p-cheap',
      basePrice: 100,
      groups: [
        {
          id: 'g-discount',
          productId: 'p-cheap',
          minSelect: 0,
          maxSelect: 1,
          translations: { en: { name: 'Oops' } },
          options: [
            {
              id: 'o-discount',
              groupId: 'g-discount',
              priceDelta: -500,
              costDelta: null,
              isSuggested: false,
              suggestPriority: 0,
              isAvailable: true,
              visualKey: null,
              translations: { en: { name: 'Mistyped discount' } },
            },
          ],
        },
      ],
    });
    const quote = quoteCart(
      makeCatalog({ products: [cheap] }),
      cart(line({ productId: 'p-cheap', optionIds: ['o-discount'], quantity: 3 })),
      noon,
    );
    expect(quote.lines[0]?.unitPrice).toBe(0);
    expect(quote.subtotal).toBeGreaterThanOrEqual(0);
  });

  it('clamps a zero-priced product to a zero total, not an error', () => {
    const free = product({ id: 'p-free', basePrice: 0 });
    const quote = quoteCart(makeCatalog({ products: [free] }), cart(line({ productId: 'p-free' })), noon);
    expect(quote.subtotal).toBe(0);
    expect(quote.lines[0]?.issues).toEqual([]);
  });
});

describe('quoteCart: bundles', () => {
  it('prices a bundle at its bundle price and reports the real saving', () => {
    const quote = quoteCart(catalog, { lines: [], bundles: [{ bundleId: 'b-burger-meal', quantity: 2 }] }, noon);
    const bundle = quote.bundles[0];
    expect(bundle?.unitPrice).toBe(1500);
    expect(bundle?.individualTotal).toBe(900 + 550 + 300);
    expect(bundle?.savings).toBe(250);
    expect(bundle?.lineTotal).toBe(3000);
    expect(quote.subtotal).toBe(3000);
  });

  it('respects bundle dayparts', () => {
    const request = { lines: [], bundles: [{ bundleId: 'b-breakfast', quantity: 1 }] };
    expect(quoteCart(catalog, request, morning).bundles[0]?.issues).toEqual([]);
    expect(codes(quoteCart(catalog, request, noon).bundles[0]?.issues ?? [])).toEqual(['OUT_OF_DAYPART']);
  });

  it('flags a bundle whose item became unavailable', () => {
    const patched = withProduct(catalog, IDS.fries, { isAvailable: false });
    const quote = quoteCart(patched, { lines: [], bundles: [{ bundleId: 'b-burger-meal', quantity: 1 }] }, noon);
    expect(codes(quote.bundles[0]?.issues ?? [])).toEqual(['UNAVAILABLE']);
    expect(quote.subtotal).toBe(0);
  });

  it('flags an unknown bundle', () => {
    const quote = quoteCart(catalog, { lines: [], bundles: [{ bundleId: 'nope', quantity: 1 }] }, noon);
    expect(codes(quote.bundles[0]?.issues ?? [])).toEqual(['UNKNOWN_BUNDLE']);
  });
});
