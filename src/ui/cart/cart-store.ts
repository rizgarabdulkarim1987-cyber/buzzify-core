import { createJSONStorage, persist } from 'zustand/middleware';
import { createStore } from 'zustand/vanilla';
import { addLine, EMPTY_CART, removeLine, setBundleQuantity, setLineQuantity } from '@/lib/cart';
import { sanitizeCart } from '@/lib/cart-storage';
import type { CartInput, CartLineInput } from '@/server/domain/types';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface CartState {
  cart: CartInput;
  dismissed: string[];
  add(line: CartLineInput): void;
  setQuantity(key: string, quantity: number): void;
  remove(key: string): void;
  setBundleQuantity(bundleId: string, quantity: number): void;
  replace(cart: CartInput): void;
  dismiss(suggestionId: string): void;
  clear(): void;
}

/** localStorage when it works; an in-memory fallback for private windows and blocked storage. */
function safeLocalStorage(): KeyValueStorage {
  const memory = new Map<string, string>();
  return {
    getItem(key) {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return memory.get(key) ?? null;
      }
    },
    setItem(key, value) {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        memory.set(key, value);
      }
    },
    removeItem(key) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        memory.delete(key);
      }
    },
  };
}

export function createCartStore(storageKey: string, storage?: KeyValueStorage) {
  const backing = storage ?? safeLocalStorage();
  return createStore<CartState>()(
    persist(
      (set) => ({
        cart: EMPTY_CART,
        dismissed: [],
        add: (line) => set((state) => ({ cart: addLine(state.cart, line) })),
        setQuantity: (key, quantity) => set((state) => ({ cart: setLineQuantity(state.cart, key, quantity) })),
        remove: (key) => set((state) => ({ cart: removeLine(state.cart, key) })),
        setBundleQuantity: (bundleId, quantity) =>
          set((state) => ({ cart: setBundleQuantity(state.cart, bundleId, quantity) })),
        replace: (cart) => set({ cart: sanitizeCart(cart) }),
        dismiss: (id) => set((state) => ({ dismissed: state.dismissed.includes(id) ? state.dismissed : [...state.dismissed, id] })),
        clear: () => set({ cart: EMPTY_CART, dismissed: [] }),
      }),
      {
        name: storageKey,
        version: 1,
        storage: createJSONStorage(() => backing),
        partialize: (state) => ({ cart: state.cart }),
        skipHydration: true,
        merge: (persisted, current) => ({
          ...current,
          cart: sanitizeCart((persisted as { cart?: unknown } | undefined)?.cart),
        }),
      },
    ),
  );
}

export type CartStore = ReturnType<typeof createCartStore>;
