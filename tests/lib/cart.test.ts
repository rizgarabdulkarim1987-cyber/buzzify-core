import { describe, expect, it } from 'vitest';
import {
  addLine,
  EMPTY_CART,
  isEmpty,
  itemCount,
  lineKey,
  removeLine,
  setBundleQuantity,
  setLineQuantity,
} from '@/lib/cart';

const burger = { productId: 'burger', variantId: null, optionIds: ['b', 'a'], quantity: 1 };

describe('cart helpers', () => {
  it('builds an order-independent line key', () => {
    expect(lineKey({ ...burger, optionIds: ['a', 'b'] })).toBe(lineKey(burger));
    expect(lineKey({ ...burger, optionIds: [] })).not.toBe(lineKey(burger));
  });

  it('merges identical lines by increasing quantity', () => {
    const once = addLine(EMPTY_CART, burger);
    const twice = addLine(once, { ...burger, optionIds: ['a', 'b'] });
    expect(twice.lines).toHaveLength(1);
    expect(twice.lines[0]?.quantity).toBe(2);
  });

  it('caps quantity at the maximum', () => {
    let cart = EMPTY_CART;
    for (let i = 0; i < 30; i += 1) cart = addLine(cart, burger);
    expect(cart.lines[0]?.quantity).toBe(20);
  });

  it('sets, removes and counts', () => {
    let cart = addLine(EMPTY_CART, burger);
    cart = addLine(cart, { productId: 'fries', variantId: null, optionIds: [], quantity: 2 });
    expect(itemCount(cart)).toBe(3);
    cart = setLineQuantity(cart, lineKey(burger), 5);
    expect(itemCount(cart)).toBe(7);
    cart = setLineQuantity(cart, lineKey(burger), 0);
    expect(cart.lines).toHaveLength(1);
    cart = removeLine(cart, lineKey({ productId: 'fries', variantId: null, optionIds: [] }));
    expect(isEmpty(cart)).toBe(true);
  });

  it('tracks bundles and removes them at zero', () => {
    let cart = setBundleQuantity(EMPTY_CART, 'b1', 2);
    expect(itemCount(cart)).toBe(2);
    cart = setBundleQuantity(cart, 'b1', 0);
    expect(cart.bundles).toEqual([]);
  });

  it('does not mutate its input', () => {
    const frozen = Object.freeze({ lines: Object.freeze([]) as never, bundles: Object.freeze([]) as never });
    expect(() => addLine(frozen, burger)).not.toThrow();
  });
});
