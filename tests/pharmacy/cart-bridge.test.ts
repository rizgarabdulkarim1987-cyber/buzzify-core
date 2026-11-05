import { describe, expect, it, vi } from 'vitest';
import { addToCart, onAddToCart } from '@/app/pharmacy/_ui/cart-bridge';

describe('cart bridge', () => {
  it('hands an added item to a registered handler', () => {
    const handler = vi.fn();
    const off = onAddToCart(handler);
    addToCart({ unitId: 'u1', qty: 2 });
    expect(handler).toHaveBeenCalledExactlyOnceWith({ unitId: 'u1', qty: 2 });
    off();
  });

  it('stops after unsubscribe', () => {
    const handler = vi.fn();
    const off = onAddToCart(handler);
    off();
    addToCart({ unitId: 'u1', qty: 2 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('reaches every handler', () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = onAddToCart(a);
    const offB = onAddToCart(b);
    addToCart({ unitId: 'u2', qty: 1 });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    offA();
    offB();
  });

  it('a handler that throws does not stop the others', () => {
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    const offBad = onAddToCart(bad);
    const offGood = onAddToCart(good);
    expect(() => addToCart({ unitId: 'u3', qty: 1 })).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
    offBad();
    offGood();
  });
});
