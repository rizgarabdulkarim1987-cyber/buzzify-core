/**
 * A hand-off to the sale screen from outside it (the AI Doctor, later others): "put this unit in the cart". A module-level
 * set of listeners; `SellWorkspace` subscribes while it is mounted. Nothing is queued: with the sale screen closed, an item
 * added here is lost, and the caller navigates with `?add=` instead (see `parseSellAdd`).
 */

export interface CartBridgeItem {
  /** A PhProductUnit id. */
  unitId: string;
  qty: number;
}

type Handler = (item: CartBridgeItem) => void;

const listeners = new Set<Handler>();

export function addToCart(item: CartBridgeItem): void {
  // A copy, so a handler cannot change what the others receive; one that throws does not stop the rest.
  for (const handler of [...listeners]) {
    try {
      handler({ ...item });
    } catch {
      /* a broken listener must not break the caller or the other listeners */
    }
  }
}

/** Registers a handler; returns the function that removes it. */
export function onAddToCart(handler: Handler): () => void {
  listeners.add(handler);
  return () => {
    listeners.delete(handler);
  };
}
