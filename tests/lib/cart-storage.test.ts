import { describe, expect, it } from 'vitest';
import { sanitizeCart } from '@/lib/cart-storage';

describe('sanitizeCart', () => {
  it('returns an empty cart for garbage', () => {
    for (const raw of [null, undefined, 'x', 42, [], { lines: 'no' }, { lines: null, bundles: 7 }]) {
      expect(sanitizeCart(raw)).toEqual({ lines: [], bundles: [] });
    }
  });

  it('keeps well-formed lines and bundles', () => {
    const raw = {
      lines: [{ productId: 'p1', variantId: null, optionIds: ['o1', 'o2'], quantity: 2 }],
      bundles: [{ bundleId: 'b1', quantity: 1 }],
    };
    expect(sanitizeCart(raw)).toEqual(raw);
  });

  it('drops malformed entries and clamps quantities', () => {
    const cart = sanitizeCart({
      lines: [
        { productId: 'ok', variantId: 'v', optionIds: [], quantity: 99 },
        { productId: 7, variantId: null, optionIds: [], quantity: 1 },
        { productId: 'x', variantId: null, optionIds: 'no', quantity: 1 },
        { productId: 'y', variantId: null, optionIds: [], quantity: 0 },
        { productId: 'z', variantId: null, optionIds: [], quantity: 1.5 },
      ],
      bundles: [{ bundleId: 'b', quantity: -3 }, { bundleId: 4, quantity: 1 }],
    });
    expect(cart.lines).toEqual([{ productId: 'ok', variantId: 'v', optionIds: [], quantity: 20 }]);
    expect(cart.bundles).toEqual([]);
  });

  it('limits the number of lines and option ids', () => {
    const lines = Array.from({ length: 80 }, (_, i) => ({
      productId: `p${i}`,
      variantId: null,
      optionIds: Array.from({ length: 40 }, (_, j) => `o${j}`),
      quantity: 1,
    }));
    const cart = sanitizeCart({ lines, bundles: [] });
    expect(cart.lines).toHaveLength(50);
    expect(cart.lines[0]?.optionIds).toHaveLength(20);
  });
});
