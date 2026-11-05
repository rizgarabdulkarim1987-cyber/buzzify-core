import { cartReducer, emptyCart, parseDraft, type CartAction } from '../sell-logic';
import { parseReceipts, receiptsReducer, type ReceiptsAction, type ReceiptsState } from '../sell-receipts';
import type { CashierKeyContext } from '../sell-keys';

/**
 * The cashier screen's state glue, pure apart from reading a DOM target: the receipts reducer plus "change the active
 * receipt's cart" and "load what the device kept", the one-time move of the old single-cart draft, and the key context read
 * from the live field at the moment of the key.
 */

/** The header chips (`ph.pulse`, `src/server/pharmacy/queries/pulse.ts`). Money as minor-unit text in the shift's currency. */
export interface CashierPulse {
  shiftNetMinor: string;
  receiptsDone: number;
  drawerCashMinor: string;
  nearExpiry: { count: number; firstProductName: string | null; firstProductId: string | null };
  lowStock: { count: number; firstProductName: string | null; firstProductId: string | null };
  /** IQD per 1 USD, display only. */
  usdRate: number;
}

export type CashierAction = ReceiptsAction | { type: 'line'; action: CartAction } | { type: 'load'; state: ReceiptsState };

/** A cart change goes to the active receipt; on a paid (done) receipt it starts a fresh one instead of reusing the paid lines. */
export function cashierReducer(state: ReceiptsState, action: CashierAction): ReceiptsState {
  if (action.type === 'load') return action.state;
  if (action.type !== 'line') return receiptsReducer(state, action);
  const current = state.receipts[state.active];
  if (!current) return state;
  const base = current.done ? emptyCart() : current.cart;
  const next = cartReducer(base, action.action);
  return next === base ? state : receiptsReducer(state, { type: 'cart', cart: next });
}

/**
 * The old (v2) single-cart draft, when it may move into the receipts: a valid cart with NO sale in flight. A draft whose
 * attempt is set is left where it is: its keys belong to a sale that may have been recorded, which the old screen settles.
 */
export function migratableDraft(raw: string | null): string | null {
  const draft = parseDraft(raw);
  return draft && draft.attempt === null ? raw : null;
}

/** What the device kept: the stored receipts, else the old draft as receipt 1 (`migrated`: the caller deletes the old key). */
export function restoreReceipts(raw: string | null, legacyRaw: string | null): { state: ReceiptsState; migrated: boolean } {
  const own = parseReceipts(raw, null);
  const legacy = migratableDraft(legacyRaw);
  const only = own.receipts.length === 1 ? own.receipts[0]! : null;
  const blank = only !== null && only.cart.lines.length === 0 && only.fromHoldId === null && only.prescriptionId === null && only.customerId === null;
  if (blank && legacy) return { state: parseReceipts(null, legacy), migrated: true };
  return { state: own, migrated: false };
}

/** Whether keys typed here go into text (inputs that take text, text areas, selects, editable content). */
export function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) return !['button', 'checkbox', 'radio', 'submit', 'reset', 'file', 'range', 'color', 'image'].includes(target.type);
  return target.isContentEditable === true;
}

/**
 * The context `cashierKeyOf` needs, read at keydown: `searchEmpty` from the field's live value (React state can lag a fast
 * scanner by a render), and being in the search field always counts as being in a text field.
 */
export function keyContextOf(target: EventTarget | null, search: HTMLInputElement | null): CashierKeyContext {
  const inSearch = search !== null && target === search;
  return {
    inSearch,
    inTextField: inSearch || isTextField(target),
    searchEmpty: search === null || search.value === '',
    modalOpen: typeof document !== 'undefined' && document.querySelector('dialog[open]') !== null,
  };
}

/** What a line key (`lineUp`, `lineDown`, `qtyUp`, `qtyDown`, `remove`) does to the lines and the selection; null = it does nothing here. */
export type LineKeyEffect = { select: string } | { step: { key: string; delta: 1 | -1 } } | { remove: string; next: string | null };

export function lineKeyEffect(kind: 'lineUp' | 'lineDown' | 'qtyUp' | 'qtyDown' | 'remove', keys: readonly string[], selected: string | null): LineKeyEffect | null {
  if (keys.length === 0) return null;
  const at = selected === null ? -1 : keys.indexOf(selected);
  if (kind === 'lineDown') return { select: keys[Math.min(keys.length - 1, at + 1)]! };
  if (kind === 'lineUp') return { select: keys[at < 0 ? keys.length - 1 : Math.max(0, at - 1)]! };
  if (at < 0) return null;
  if (kind === 'qtyUp') return { step: { key: keys[at]!, delta: 1 } };
  if (kind === 'qtyDown') return { step: { key: keys[at]!, delta: -1 } };
  // After a removal the next line takes the place (or, at the end, the one before it).
  return { remove: keys[at]!, next: keys[at + 1] ?? keys[at - 1] ?? null };
}
