import { describe, expect, it } from 'vitest';
import { lineKey } from '@/lib/cart';
import { createCartStore, type KeyValueStorage } from '@/ui/cart/cart-store';

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

const burger = { productId: 'burger', variantId: null, optionIds: ['cheese'], quantity: 1 };

describe('cart store', () => {
  it('adds, merges, updates and removes lines', () => {
    const store = createCartStore('k', memoryStorage());
    store.getState().add(burger);
    store.getState().add(burger);
    expect(store.getState().cart.lines[0]?.quantity).toBe(2);
    store.getState().setQuantity(lineKey(burger), 5);
    expect(store.getState().cart.lines[0]?.quantity).toBe(5);
    store.getState().remove(lineKey(burger));
    expect(store.getState().cart.lines).toEqual([]);
  });

  it('persists the cart but not dismissed suggestions', async () => {
    const storage = memoryStorage();
    const first = createCartStore('k', storage);
    first.getState().add(burger);
    first.getState().dismiss('pair:p1');
    const saved = JSON.parse(storage.data.k as string);
    expect(saved.state.cart.lines).toHaveLength(1);
    expect(saved.state.dismissed).toBeUndefined();

    const second = createCartStore('k', storage);
    expect(second.getState().cart.lines).toEqual([]); // skipHydration until rehydrate()
    await second.persist.rehydrate();
    expect(second.getState().cart.lines).toHaveLength(1);
    expect(second.getState().dismissed).toEqual([]);
  });

  it('recovers from corrupted storage', async () => {
    const storage = memoryStorage({ k: '{"state":{"cart":{"lines":[{"productId":7}],"bundles":"x"}},"version":1}' });
    const store = createCartStore('k', storage);
    await store.persist.rehydrate();
    expect(store.getState().cart).toEqual({ lines: [], bundles: [] });
    const broken = createCartStore('k2', memoryStorage({ k2: '{not json' }));
    await broken.persist.rehydrate();
    expect(broken.getState().cart).toEqual({ lines: [], bundles: [] });
  });

  it('replaces and clears the cart', () => {
    const store = createCartStore('k', memoryStorage());
    store.getState().replace({ lines: [], bundles: [{ bundleId: 'b', quantity: 1 }] });
    expect(store.getState().cart.bundles).toHaveLength(1);
    store.getState().clear();
    expect(store.getState().cart).toEqual({ lines: [], bundles: [] });
  });
});
