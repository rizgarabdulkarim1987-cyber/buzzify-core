import { emptyCart, newClientKey, type CartState } from './sell-logic';

/**
 * The cashier's open receipts, pure (no DOM, no React): up to MAX_RECEIPTS carts side by side, one active. A receipt
 * with lines cannot be closed until it is done; a done receipt (paid) is replaced by a fresh one the next time the
 * cashier opens or uses it.
 */

export const MAX_RECEIPTS = 6;

export interface OpenReceipt {
  key: string;
  cart: CartState;
  customerId: string | null;
  fromHoldId: string | null;
  prescriptionId: string | null;
  done: boolean;
}

export interface ReceiptsState {
  receipts: OpenReceipt[];
  active: number;
}

export type ReceiptsAction =
  | { type: 'open' }
  | { type: 'switch'; index: number }
  | { type: 'close'; index: number }
  | { type: 'cart'; cart: CartState }
  | { type: 'customer'; customerId: string | null }
  | { type: 'done' }
  | { type: 'replace'; receipt: OpenReceipt };

export const newReceipt = (): OpenReceipt => ({ key: newClientKey('rc'), cart: emptyCart(), customerId: null, fromHoldId: null, prescriptionId: null, done: false });

export const initialReceipts = (): ReceiptsState => ({ receipts: [newReceipt()], active: 0 });

/** A receipt may be closed with its tab's X only when nothing would be lost: no lines, or already paid. */
export const canClose = (r: OpenReceipt): boolean => r.cart.lines.length === 0 || r.done;

const inRange = (state: ReceiptsState, index: number): boolean => Number.isInteger(index) && index >= 0 && index < state.receipts.length;

const withActive = (state: ReceiptsState, receipt: OpenReceipt): ReceiptsState => ({ ...state, receipts: state.receipts.map((r, i) => (i === state.active ? receipt : r)) });

export function receiptsReducer(state: ReceiptsState, action: ReceiptsAction): ReceiptsState {
  const current = state.receipts[state.active];
  switch (action.type) {
    case 'open': {
      if (current?.done) return withActive(state, newReceipt());
      if (state.receipts.length >= MAX_RECEIPTS) return state;
      return { receipts: [...state.receipts, newReceipt()], active: state.receipts.length };
    }
    case 'switch':
      return inRange(state, action.index) && action.index !== state.active ? { ...state, active: action.index } : state;
    case 'close': {
      if (!inRange(state, action.index) || !canClose(state.receipts[action.index])) return state;
      if (state.receipts.length === 1) return initialReceipts();
      const receipts = state.receipts.filter((_, i) => i !== action.index);
      let active = state.active;
      if (action.index < active) active -= 1;
      return { receipts, active: Math.min(active, receipts.length - 1) };
    }
    case 'cart':
      return withActive(state, current?.done ? { ...newReceipt(), cart: action.cart } : { ...current, cart: action.cart });
    case 'customer':
      return withActive(state, current?.done ? { ...newReceipt(), customerId: action.customerId } : { ...current, customerId: action.customerId });
    case 'done':
      return current && !current.done ? withActive(state, { ...current, done: true }) : state;
    case 'replace':
      return withActive(state, action.receipt);
  }
}
