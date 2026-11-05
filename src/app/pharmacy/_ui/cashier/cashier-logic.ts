import { cartReducer, emptyCart, nextUnitId, parseDraft, parseQtyText, startUnit, type AddableItem, type CartAction, type CartLine, type CartState, type CartUnit, type Currency, type ScanItem } from '../sell-logic';
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

// The unit button -------------------------------------------------------------------------------------------------------

/**
 * The unit the NEXT scanned item starts in when no line is selected. A screen-level preference (not per receipt) that does not
 * name a unit id (ids belong to one item): `largest` and `smallest` pick the priced unit with the most or fewest base pieces.
 */
export type ScanUnitPref = 'default' | 'largest' | 'smallest';

export const nextScanUnitPref = (pref: ScanUnitPref): ScanUnitPref => (pref === 'default' ? 'largest' : pref === 'largest' ? 'smallest' : 'default');

/** The unit id to add an item in under the preference; undefined = the item's own start unit (a barcode that named a unit always wins). */
export function scanUnitId(item: Pick<AddableItem, 'units' | 'matchedUnitId'>, pref: ScanUnitPref): string | undefined {
  if (pref === 'default' || item.matchedUnitId) return undefined;
  const priced = item.units.filter((u) => u.priceMinor !== null);
  if (priced.length < 2) return undefined;
  const sorted = [...priced].sort((a, b) => a.baseQty - b.baseQty);
  return (pref === 'largest' ? sorted[sorted.length - 1] : sorted[0])!.id;
}

/** The cart action that adds a scanned or typed item, in the preferred unit. */
export const addActionFor = (item: AddableItem, pref: ScanUnitPref): CartAction => ({ type: 'add', item, unitId: scanUnitId(item, pref) });

/** What the unit key does: move the selected line to its next priced unit, say there is none, or (no line selected) turn the next-item preference. */
export type UnitEffect = { set: { key: string; unitId: string } } | { none: true } | { pref: true };

export function unitKeyEffect(line: CartLine | null, currency: Currency): UnitEffect {
  if (!line) return { pref: true };
  const unitId = nextUnitId(line, currency);
  return unitId ? { set: { key: line.key, unitId } } : { none: true };
}

// The keypad ------------------------------------------------------------------------------------------------------------

export const PAD_MAX_DIGITS = 6;

/** A key on the pad: a digit appends (leading zeros dropped, six digits at most), `C` clears. Quantities are whole numbers: there is no decimal point. */
export function padText(text: string, key: string): string {
  if (key === 'C') return '';
  if (!/^[0-9]$/.test(key)) return text;
  const next = (text + key).replace(/^0+/, '');
  return next.length > PAD_MAX_DIGITS ? text : next;
}

/** The quantity the pad's enter key applies (same reading as a quantity typed in a line); null = nothing usable. */
export const padQty = (text: string): number | null => parseQtyText(text);

// The total box ---------------------------------------------------------------------------------------------------------

/** The amount due in dollars, for display only (total / IQD per USD, two places); null when the sale is already in dollars or there is no rate. */
export function usdEquivalent(totalMinor: bigint, currency: Currency, usdRate: number | null | undefined): string | null {
  if (currency !== 'IQD' || !usdRate || !Number.isFinite(usdRate) || usdRate <= 0) return null;
  return (Number(totalMinor) / usdRate).toFixed(2);
}

// Selecting the line just added --------------------------------------------------------------------------------------------

/** The line an add touched: the new last line, or (same product and unit scanned again) the existing line whose quantity grew. */
export function addedKey(before: CartState, after: CartState): string | null {
  if (after.lines.length > before.lines.length) return after.lines[after.lines.length - 1]!.key;
  const was = new Map(before.lines.map((l) => [l.key, l.qty]));
  return after.lines.find((l) => was.get(l.key) !== l.qty)?.key ?? null;
}

// Suggestions while typing -----------------------------------------------------------------------------------------------

export const SUGGESTION_DELAY_MS = 150;
export const SUGGESTION_MAX = 8;

/** Suggestions are for names: at least two characters, and not a run of digits (a scanner burst or a typed barcode goes to the exact barcode path). */
export const wantsSuggestions = (query: string): boolean => {
  const q = query.trim();
  return q.length >= 2 && !/^[\d\u0660-\u0669\u06F0-\u06F9\s]+$/.test(q);
};

export type SuggestionReason = 'notSellable' | 'noPrice' | 'noStock';
export interface Suggestion {
  item: ScanItem;
  /** Why the row cannot be added; null = it can. */
  reason: SuggestionReason | null;
  /** The unit an add would start in (shown with its price). */
  unit: CartUnit | null;
  mark: 'rx' | 'restricted' | null;
}

export function suggestionsFrom(items: readonly ScanItem[], limit = SUGGESTION_MAX): Suggestion[] {
  return items.slice(0, limit).map((item) => ({
    item,
    reason: item.notSellable ? 'notSellable' : item.noPrice ? 'noPrice' : item.sellableQty <= 0 ? 'noStock' : null,
    unit: startUnit(item),
    mark: item.rxLevel === 'RESTRICTED' ? 'restricted' : item.rxLevel === 'RX' ? 'rx' : null,
  }));
}

/** The next addable row from `from` (-1 = none yet) in the direction, wrapping; -1 when no row can be added. */
export function moveSuggestion(rows: readonly Suggestion[], from: number, delta: 1 | -1): number {
  const n = rows.length;
  for (let step = 1; step <= n; step += 1) {
    const at = (((from < 0 ? (delta === 1 ? -1 : n) : from) + delta * step) % n + n) % n;
    if (rows[at]!.reason === null) return at;
  }
  return -1;
}
