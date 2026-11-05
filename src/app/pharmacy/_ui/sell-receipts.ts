import { CURRENCIES, emptyCart, isAttempt, isDiscount, isLine, MAX_LINES, newClientKey, parseDraft, withCode, type CartState, type Currency, type SaleAttempt } from './sell-logic';

/**
 * The cashier's open receipts, pure (no DOM, no React): up to MAX_RECEIPTS carts side by side, one active. A receipt
 * with lines cannot be closed until it is done; a done receipt (paid) is replaced by a fresh one the next time the
 * cashier opens or uses it. A sale being sent belongs to its receipt (`attempt`: its keys and payment), so a lost answer is
 * retried with the same keys on the right receipt, also after a reload.
 */

export const MAX_RECEIPTS = 6;

export interface OpenReceipt {
  key: string;
  cart: CartState;
  customerId: string | null;
  fromHoldId: string | null;
  prescriptionId: string | null;
  done: boolean;
  /** The sale sent for this receipt whose outcome is not known yet (keys and payment as sent); null when none is in flight. */
  attempt: SaleAttempt | null;
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
  | { type: 'replace'; receipt: OpenReceipt }
  /** The sale attempt of the receipt with this key (null drops it); a paid or missing receipt is left alone. */
  | { type: 'attempt'; receiptKey: string; attempt: SaleAttempt | null }
  /** A refused sale changed the receipt: its prescription is gone, or its lines were fitted to fresh prices. */
  | { type: 'refused'; receiptKey: string; prescriptionId?: null; cart?: CartState }
  /** The receipt with this key was sold: done, with no attempt left. */
  | { type: 'sold'; receiptKey: string };

export const newReceipt = (): OpenReceipt => ({ key: newClientKey('rc'), cart: emptyCart(), customerId: null, fromHoldId: null, prescriptionId: null, done: false, attempt: null });

export const initialReceipts = (): ReceiptsState => ({ receipts: [newReceipt()], active: 0 });

/** A receipt may be closed with its tab's X only when nothing would be lost: no lines, or already paid. */
export const canClose = (r: OpenReceipt): boolean => r.cart.lines.length === 0 || r.done;

const inRange = (state: ReceiptsState, index: number): boolean => Number.isInteger(index) && index >= 0 && index < state.receipts.length;

const withActive = (state: ReceiptsState, receipt: OpenReceipt): ReceiptsState => ({ ...state, receipts: state.receipts.map((r, i) => (i === state.active ? receipt : r)) });

/** Changes the not-yet-paid receipt with this key (wherever it is, active or not); the same state when there is none. */
function patchOpen(state: ReceiptsState, key: string, patch: Partial<OpenReceipt>): ReceiptsState {
  const at = state.receipts.findIndex((r) => r.key === key && !r.done);
  if (at < 0) return state;
  return { ...state, receipts: state.receipts.map((r, i) => (i === at ? { ...r, ...patch } : r)) };
}

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
    case 'attempt':
      return patchOpen(state, action.receiptKey, { attempt: action.attempt });
    case 'refused':
      return patchOpen(state, action.receiptKey, { attempt: null, ...(action.prescriptionId === null ? { prescriptionId: null } : {}), ...(action.cart ? { cart: action.cart } : {}) });
    case 'sold':
      return patchOpen(state, action.receiptKey, { done: true, attempt: null });
  }
}

// On the device ---------------------------------------------------------------------------------------------------------

export const RECEIPTS_VERSION = 3;
/** One set of receipts per pharmacy, branch, person AND currency, like the single-cart draft before it. */
export const receiptsKey = (restaurantId: string, branchId: string, userId: string, currency: Currency): string =>
  `ph-sell-receipts:v${RECEIPTS_VERSION}:${restaurantId}:${branchId}:${userId}:${currency}`;

/** Paid receipts are not kept; the active pointer follows its receipt (or the nearest one left). */
export function serializeReceipts(state: ReceiptsState): string {
  const kept = state.receipts.filter((r) => !r.done).slice(0, MAX_RECEIPTS);
  const activeKey = state.receipts[state.active]?.key;
  const at = kept.findIndex((r) => r.key === activeKey);
  const active = at >= 0 ? at : Math.min(Math.max(0, state.active), Math.max(0, kept.length - 1));
  return JSON.stringify({ v: RECEIPTS_VERSION, active, receipts: kept });
}

const isCart = (c: unknown): c is CartState => {
  const x = c as CartState | null;
  return !!x && typeof x === 'object' && Array.isArray(x.lines) && x.lines.length <= MAX_LINES && x.lines.every(isLine) && isDiscount(x.invoiceDiscount) && typeof x.discountReason === 'string' && Number.isInteger(x.seq);
};

const orNull = (v: unknown): string | null => (typeof v === 'string' && v.length <= 64 ? v : null);

function toReceipt(r: unknown): OpenReceipt | null {
  const x = r as Partial<OpenReceipt> | null;
  if (!x || typeof x !== 'object' || typeof x.key !== 'string' || x.key.length === 0 || x.key.length > 80 || !isCart(x.cart)) return null;
  return { key: x.key, cart: withCode(x.cart), customerId: orNull(x.customerId), fromHoldId: orNull(x.fromHoldId), prescriptionId: orNull(x.prescriptionId), done: false, attempt: isAttempt(x.attempt) ? x.attempt : null };
}

/**
 * The stored receipts, or a single empty one. A receipt that is not a valid cart is dropped and the rest kept; more than
 * MAX_RECEIPTS are cut; a v2 single-cart draft (`legacyDraftRaw`) becomes receipt 1 when there are no v3 receipts, with its sale
 * in flight (`attempt`) kept, so a retry sends the keys the old screen sent. A damaged attempt reads as none. Never throws.
 */
export function parseReceipts(raw: string | null, legacyDraftRaw: string | null): ReceiptsState {
  try {
    if (raw) {
      const parsed = JSON.parse(raw) as { v?: unknown; active?: unknown; receipts?: unknown } | null;
      if (parsed && parsed.v === RECEIPTS_VERSION && Array.isArray(parsed.receipts)) {
        const slots = parsed.receipts.slice(0, MAX_RECEIPTS).map(toReceipt);
        const receipts = slots.filter((r): r is OpenReceipt => r !== null);
        if (receipts.length > 0) {
          const want = Number.isInteger(parsed.active) ? (parsed.active as number) : 0;
          const wanted = want >= 0 && want < slots.length ? slots[want] : null;
          const at = wanted ? receipts.indexOf(wanted) : -1;
          return { receipts, active: at >= 0 ? at : Math.min(Math.max(0, want), receipts.length - 1) };
        }
      }
    }
  } catch {
    /* fall through to the legacy draft */
  }
  try {
    const draft = parseDraft(legacyDraftRaw);
    if (draft && CURRENCIES.includes(draft.currency)) {
      return { receipts: [{ ...newReceipt(), cart: draft.cart, fromHoldId: draft.fromHoldId, prescriptionId: draft.prescriptionId ?? null, attempt: draft.attempt }], active: 0 };
    }
  } catch {
    /* fall through */
  }
  return initialReceipts();
}
