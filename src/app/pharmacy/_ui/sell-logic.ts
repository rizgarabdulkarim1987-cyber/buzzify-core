import { invoiceRounding, lineDiscount, lineGross, MAX_AMOUNT_MINOR } from '@/server/domain/pharmacy/sale';

/**
 * The sale screen's client logic, pure (no DOM, no React, no clock): money text in and out, the cart and its reducer,
 * the ESTIMATE of the totals the cart shows before paying, the request the server gets, the draft kept on the device,
 * and the keyboard shortcuts. Money is BigInt minor units everywhere; a `Number` never holds an amount. The server stays
 * the judge: it prices, discounts, rounds and allocates again when the sale is made, and its totals are what the
 * receipt shows. The estimate uses the server's own arithmetic functions (src/server/domain/pharmacy/sale.ts, pure) so
 * it can differ only when a price or a rule changed meanwhile.
 */

export type Currency = 'IQD' | 'USD';
export const CURRENCIES: readonly Currency[] = ['IQD', 'USD'];
export const minorDigits = (currency: Currency): number => (currency === 'USD' ? 2 : 0);

// Money -----------------------------------------------------------------------------------------------------------------

/** Arabic-Indic and Persian digits and separators become Latin ones; whitespace goes. */
export function normalizeDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, '.')
    .replace(/[٬\s]/g, '');
}

/** `1,250` for IQD, `12.50` for USD. Latin digits, grouped by thousands, exact for any size. */
export function formatMinor(minor: bigint, currency: Currency): string {
  const digits = minorDigits(currency);
  const negative = minor < 0n;
  const text = (negative ? -minor : minor).toString().padStart(digits + 1, '0');
  const whole = digits === 0 ? text : text.slice(0, -digits);
  const fraction = digits === 0 ? '' : `.${text.slice(-digits)}`;
  return `${negative ? '-' : ''}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction}`;
}

/** Text of an amount without grouping (for a field): `1250`, `12.50`. */
export function plainMinor(minor: bigint, currency: Currency): string {
  return formatMinor(minor, currency).replace(/,/g, '');
}

/**
 * What a person typed as an amount, in the currency's units ("1,250", "12.5", "١٢٫٥"), as minor units; null when it is
 * not an amount (letters, a minus sign, too many decimals, above the allowed maximum).
 */
export function parseMoney(text: string, currency: Currency): bigint | null {
  const clean = normalizeDigits(text).replace(/,/g, '');
  const digits = minorDigits(currency);
  const match = /^(\d+)(?:\.(\d*))?$/.exec(clean);
  if (!match) return null;
  const fraction = match[2] ?? '';
  if (fraction.length > digits) return null;
  const minor = BigInt(match[1]! + fraction.padEnd(digits, '0'));
  return minor > MAX_AMOUNT_MINOR ? null : minor;
}

/** A percent typed by a person ("5", "2.5"): 0 to 100 with at most two decimals, as basis points; else null. */
export function parsePercent(text: string): number | null {
  const clean = normalizeDigits(text);
  const match = /^(\d{1,3})(?:\.(\d{0,2}))?$/.exec(clean);
  if (!match) return null;
  const bp = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return bp <= 10_000 ? bp : null;
}

// The cart -------------------------------------------------------------------------------------------------------------

export type RxLevel = 'OTC' | 'RX' | 'RESTRICTED';
export interface CartUnit {
  id: string;
  label: string;
  baseQty: number;
  /** Minor units as text; null = no price in the sale currency. */
  priceMinor: string | null;
}
export interface BatchChoice {
  batchId: string;
  lot: string;
  expiryDate: string;
  available: number;
}
export type DiscountDraft = { kind: 'amount' | 'percent'; value: string };

export interface CartLine {
  key: string;
  productId: string;
  name: string;
  /** Strength, form and pack, for the cashier to tell products apart. */
  detail: string;
  rxLevel: RxLevel;
  units: CartUnit[];
  unitId: string;
  qty: number;
  /** Sellable stock of the product in base units when it was found, to warn before the sale refuses. */
  sellableQty: number;
  batches: BatchChoice[];
  discount: DiscountDraft | null;
  /** A batch chosen instead of FEFO (needs `batch.override`), with its lot for display and the reason. */
  batchId: string | null;
  batchLot: string;
  batchReason: string;
}

export interface CartState {
  lines: CartLine[];
  invoiceDiscount: DiscountDraft | null;
  /** One reason for every discount in the cart (the server asks for one above the limit). */
  discountReason: string;
  seq: number;
}

export const emptyCart = (): CartState => ({ lines: [], invoiceDiscount: null, discountReason: '', seq: 0 });
export const MAX_LINES = 200;
export const MAX_QTY = 1_000_000;

/** A product as the search returns it; only what the cart keeps. */
export interface AddableItem {
  productId: string;
  tradeName: string;
  strength: string;
  form: string;
  packLabel: string;
  rxLevel: RxLevel;
  matchedUnitId: string | null;
  /** Sellable stock in base units (what the sale can allocate). */
  sellableQty: number;
  units: { id: string; label: string; baseQty: number; priceMinor: string | null }[];
  batches: BatchChoice[];
}

export const itemDetail = (item: Pick<AddableItem, 'strength' | 'form' | 'packLabel'>): string =>
  [item.strength, item.form, item.packLabel].filter((part) => part.trim() !== '').join(' · ');

export type CartAction =
  | { type: 'add'; item: AddableItem; unitId?: string }
  | { type: 'qty'; key: string; qty: number }
  | { type: 'step'; key: string; delta: number }
  | { type: 'unit'; key: string; unitId: string }
  | { type: 'discount'; key: string; discount: DiscountDraft | null }
  | { type: 'batch'; key: string; batchId: string | null; lot: string; reason: string }
  | { type: 'invoiceDiscount'; discount: DiscountDraft | null }
  | { type: 'discountReason'; reason: string }
  | { type: 'remove'; key: string }
  | { type: 'clear' }
  | { type: 'load'; cart: CartState };

const clampQty = (qty: number): number => (Number.isFinite(qty) ? Math.min(MAX_QTY, Math.max(1, Math.trunc(qty))) : 1);

/** The unit a new line starts in: the one a barcode named, else the cheapest-to-count (the smallest sellable unit). */
export function startUnit(item: AddableItem, unitId?: string): CartUnit | null {
  const pick = (id: string | null | undefined) => (id ? item.units.find((u) => u.id === id) : undefined);
  const smallest = [...item.units].sort((a, b) => a.baseQty - b.baseQty)[0];
  return pick(unitId) ?? pick(item.matchedUnitId) ?? smallest ?? null;
}

export function cartReducer(state: CartState, action: CartAction): CartState {
  const map = (key: string, change: (line: CartLine) => CartLine): CartState => ({ ...state, lines: state.lines.map((l) => (l.key === key ? change(l) : l)) });
  switch (action.type) {
    case 'add': {
      const unit = startUnit(action.item, action.unitId);
      if (!unit) return state;
      const same = state.lines.find((l) => l.productId === action.item.productId && l.unitId === unit.id && l.batchId === null && l.discount === null);
      if (same) return map(same.key, (l) => ({ ...l, qty: clampQty(l.qty + 1) }));
      if (state.lines.length >= MAX_LINES) return state;
      const line: CartLine = {
        key: `l${state.seq + 1}`,
        productId: action.item.productId,
        name: action.item.tradeName,
        detail: itemDetail(action.item),
        rxLevel: action.item.rxLevel,
        units: action.item.units.map((u) => ({ id: u.id, label: u.label, baseQty: u.baseQty, priceMinor: u.priceMinor })),
        unitId: unit.id,
        qty: 1,
        sellableQty: action.item.sellableQty,
        batches: action.item.batches,
        discount: null,
        batchId: null,
        batchLot: '',
        batchReason: '',
      };
      return { ...state, seq: state.seq + 1, lines: [...state.lines, line] };
    }
    case 'qty':
      return map(action.key, (l) => ({ ...l, qty: clampQty(action.qty) }));
    case 'step':
      return map(action.key, (l) => ({ ...l, qty: clampQty(l.qty + action.delta) }));
    case 'unit':
      return map(action.key, (l) => (l.units.some((u) => u.id === action.unitId) ? { ...l, unitId: action.unitId, batchId: null, batchLot: '', batchReason: '' } : l));
    case 'discount':
      return map(action.key, (l) => ({ ...l, discount: action.discount }));
    case 'batch':
      return map(action.key, (l) => ({ ...l, batchId: action.batchId, batchLot: action.batchId ? action.lot : '', batchReason: action.batchId ? action.reason : '' }));
    case 'invoiceDiscount':
      return { ...state, invoiceDiscount: action.discount };
    case 'discountReason':
      return { ...state, discountReason: action.reason };
    case 'remove':
      return { ...state, lines: state.lines.filter((l) => l.key !== action.key) };
    case 'clear':
      return emptyCart();
    case 'load':
      return action.cart;
  }
}

export const unitOf = (line: CartLine): CartUnit => line.units.find((u) => u.id === line.unitId) ?? line.units[0]!;

// The estimate --------------------------------------------------------------------------------------------------------

export interface Estimate {
  /** Per line: gross and what is left after the line's own discount; null price = the line cannot be priced. */
  lines: { key: string; grossMinor: bigint; discountMinor: bigint; totalMinor: bigint; unpriced: boolean; invalid: boolean }[];
  grossMinor: bigint;
  lineDiscountMinor: bigint;
  invoiceDiscountMinor: bigint;
  /** Before rounding. */
  subtotalMinor: bigint;
  roundingMinor: bigint;
  /** What the cart will most likely cost: after the invoice discount and the rounding step. */
  totalMinor: bigint;
  unpricedCount: number;
  /** A discount or amount that cannot be read, or an overflow: the cart cannot be sent until fixed. */
  invalidCount: number;
}

function discountOf(gross: bigint, draft: DiscountDraft | null, currency: Currency): { minor: bigint; invalid: boolean } {
  if (!draft || draft.value.trim() === '') return { minor: 0n, invalid: false };
  try {
    if (draft.kind === 'amount') {
      const value = parseMoney(draft.value, currency);
      if (value === null) return { minor: 0n, invalid: true };
      return { minor: lineDiscount(gross, { kind: 'amount', value }), invalid: value > gross };
    }
    const bp = parsePercent(draft.value);
    if (bp === null) return { minor: 0n, invalid: true };
    return { minor: lineDiscount(gross, { kind: 'percent', value: bp }), invalid: false };
  } catch {
    return { minor: 0n, invalid: true };
  }
}

/** Totals for display, from the prices the search showed. Clearly an estimate: the sale prices and rounds again. */
export function estimateCart(cart: CartState, currency: Currency, roundingStepMinor: number): Estimate {
  let gross = 0n;
  let lineDiscounts = 0n;
  let unpricedCount = 0;
  let invalidCount = 0;
  const lines = cart.lines.map((line) => {
    const unit = unitOf(line);
    if (unit.priceMinor === null) {
      unpricedCount += 1;
      return { key: line.key, grossMinor: 0n, discountMinor: 0n, totalMinor: 0n, unpriced: true, invalid: false };
    }
    let grossMinor = 0n;
    let invalid = false;
    try {
      grossMinor = lineGross(BigInt(line.qty), BigInt(unit.priceMinor));
    } catch {
      invalid = true;
    }
    const d = discountOf(grossMinor, line.discount, currency);
    if (invalid || d.invalid) invalidCount += 1;
    gross += grossMinor;
    lineDiscounts += d.minor;
    return { key: line.key, grossMinor, discountMinor: d.minor, totalMinor: grossMinor - d.minor, unpriced: false, invalid: invalid || d.invalid };
  });
  const afterLines = gross - lineDiscounts;
  const inv = discountOf(afterLines, cart.invoiceDiscount, currency);
  if (inv.invalid) invalidCount += 1;
  const subtotalMinor = afterLines - inv.minor;
  let roundingMinor = 0n;
  let totalMinor = subtotalMinor;
  if (currency === 'IQD' && roundingStepMinor > 0 && subtotalMinor >= 0n) {
    try {
      const r = invoiceRounding(subtotalMinor, roundingStepMinor, currency);
      roundingMinor = r.roundingMinor;
      totalMinor = r.roundedMinor;
      // The server never turns a positive total into 0: it rounds up to one step.
      if (subtotalMinor > 0n && totalMinor === 0n) {
        totalMinor = BigInt(roundingStepMinor);
        roundingMinor = totalMinor - subtotalMinor;
      }
    } catch {
      /* an unknown step: show the unrounded total */
    }
  }
  return { lines, grossMinor: gross, lineDiscountMinor: lineDiscounts, invoiceDiscountMinor: inv.minor, subtotalMinor, roundingMinor, totalMinor, unpricedCount, invalidCount };
}

// Paying --------------------------------------------------------------------------------------------------------------

export type PayMethod = 'CASH' | 'CARD_MANUAL' | 'TRANSFER_MANUAL';
export interface PayDraft {
  method: PayMethod;
  /** What the person typed as tendered (cash) or paid (card, transfer); empty = the exact total. */
  tendered: string;
  reference: string;
}

/** What the payment would be, for the dialog: the amount, the change (cash only) and whether it covers the total. */
export function paymentPreview(draft: PayDraft, totalMinor: bigint, currency: Currency): { amountMinor: bigint | null; changeMinor: bigint; ok: boolean } {
  const typed = draft.tendered.trim() === '' ? totalMinor : parseMoney(draft.tendered, currency);
  if (typed === null) return { amountMinor: null, changeMinor: 0n, ok: false };
  if (draft.method === 'CASH') {
    return { amountMinor: typed, changeMinor: typed > totalMinor ? typed - totalMinor : 0n, ok: typed >= totalMinor };
  }
  return { amountMinor: typed, changeMinor: 0n, ok: typed === totalMinor };
}

/** Round-number cash amounts at or above the total, for one-touch tendering. */
export function cashShortcuts(totalMinor: bigint, currency: Currency): bigint[] {
  if (totalMinor <= 0n) return [];
  const unit = BigInt(currency === 'USD' ? 100 : 1);
  const steps = currency === 'USD' ? [5n, 10n, 20n, 50n, 100n] : [1000n, 5000n, 10_000n, 25_000n, 50_000n];
  const out = new Set<bigint>();
  for (const step of steps) {
    const size = step * unit;
    const up = ((totalMinor + size - 1n) / size) * size;
    if (up > totalMinor) out.add(up);
  }
  return [...out].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).slice(0, 4);
}

// The request ----------------------------------------------------------------------------------------------------------

type WireDiscount = { kind: 'amount'; value: string; reason?: string } | { kind: 'percent'; value: number; reason?: string };

/** A discount draft as the server takes it; null when empty or zero, `'invalid'` when it cannot be read. */
export function discountToWire(draft: DiscountDraft | null, reason: string, currency: Currency): WireDiscount | null | 'invalid' {
  if (!draft || draft.value.trim() === '') return null;
  const withReason = reason.trim() !== '' ? { reason: reason.trim() } : {};
  if (draft.kind === 'amount') {
    const value = parseMoney(draft.value, currency);
    if (value === null) return 'invalid';
    return value === 0n ? null : { kind: 'amount', value: value.toString(), ...withReason };
  }
  const bp = parsePercent(draft.value);
  if (bp === null) return 'invalid';
  return bp === 0 ? null : { kind: 'percent', value: bp / 100, ...withReason };
}

export interface CartRequest {
  clientKey: string;
  currency: Currency;
  lines: Record<string, unknown>[];
  invoiceDiscount?: WireDiscount;
}

/** The cart as the server takes it (hold, or sale with payments added); null when a discount cannot be read. */
export function buildCartRequest(cart: CartState, currency: Currency, clientKey: string): CartRequest | null {
  const lines: Record<string, unknown>[] = [];
  for (const l of cart.lines) {
    const d = discountToWire(l.discount, cart.discountReason, currency);
    if (d === 'invalid') return null;
    lines.push({
      productId: l.productId,
      unitId: l.unitId,
      qty: l.qty,
      ...(l.batchId ? { batchId: l.batchId, batchReason: l.batchReason.trim() } : {}),
      ...(d ? { discount: d } : {}),
    });
  }
  const inv = discountToWire(cart.invoiceDiscount, cart.discountReason, currency);
  if (inv === 'invalid') return null;
  return { clientKey, currency, lines, ...(inv ? { invoiceDiscount: inv } : {}) };
}

export function buildPayment(draft: PayDraft, amountMinor: bigint, paymentKey: string) {
  return { method: draft.method, amountMinor: amountMinor.toString(), reference: draft.reference.trim(), clientKey: paymentKey };
}

// Keys and ids ----------------------------------------------------------------------------------------------------------

/** A fresh idempotency key. Made once per attempt and reused on every retry of that attempt. */
export function newClientKey(prefix = 'ph'): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && 'randomUUID' in c) return `${prefix}-${c.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

// Keyboard ---------------------------------------------------------------------------------------------------------------

export type Shortcut = 'search' | 'pay' | 'hold' | 'escape' | 'addTop';

/**
 * What a key press means on the sale screen. F2 focuses the search, F4 opens payment, F8 holds the cart, Escape clears
 * the search or closes the dialog, Enter in the search box adds the top result. Keys with Ctrl, Alt or Meta are the
 * browser's; a key held down (repeat) never fires twice.
 */
export function shortcutOf(event: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean; repeat?: boolean }, inSearch: boolean): Shortcut | null {
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return null;
  switch (event.key) {
    case 'F2':
      return 'search';
    case 'F4':
      return 'pay';
    case 'F8':
      return 'hold';
    case 'Escape':
      return 'escape';
    case 'Enter':
      return inSearch && !event.shiftKey ? 'addTop' : null;
    default:
      return null;
  }
}

// The draft on the device -----------------------------------------------------------------------------------------------

export const DRAFT_VERSION = 1;
export const draftKey = (restaurantId: string, branchId: string, userId: string) => `ph-sell-draft:v${DRAFT_VERSION}:${restaurantId}:${branchId}:${userId}`;

export interface Draft {
  v: number;
  currency: Currency;
  cart: CartState;
}

export function serializeDraft(currency: Currency, cart: CartState): string {
  return JSON.stringify({ v: DRAFT_VERSION, currency, cart } satisfies Draft);
}

const isDiscount = (d: unknown): d is DiscountDraft | null =>
  d === null || (typeof d === 'object' && d !== null && ((d as DiscountDraft).kind === 'amount' || (d as DiscountDraft).kind === 'percent') && typeof (d as DiscountDraft).value === 'string');

const isUnit = (u: unknown): u is CartUnit => {
  const x = u as CartUnit;
  return !!x && typeof x.id === 'string' && typeof x.label === 'string' && Number.isInteger(x.baseQty) && (x.priceMinor === null || (typeof x.priceMinor === 'string' && /^\d+$/.test(x.priceMinor)));
};

const isLine = (l: unknown): l is CartLine => {
  const x = l as CartLine;
  return (
    !!x &&
    typeof x.key === 'string' &&
    typeof x.productId === 'string' &&
    typeof x.name === 'string' &&
    typeof x.detail === 'string' &&
    ['OTC', 'RX', 'RESTRICTED'].includes(x.rxLevel) &&
    Array.isArray(x.units) &&
    x.units.length > 0 &&
    x.units.every(isUnit) &&
    x.units.some((u) => u.id === x.unitId) &&
    Number.isInteger(x.qty) &&
    Number.isInteger(x.sellableQty) &&
    Array.isArray(x.batches) &&
    x.batches.every((b) => !!b && typeof b.batchId === 'string' && typeof b.lot === 'string' && typeof b.expiryDate === 'string' && Number.isInteger(b.available)) &&
    x.qty >= 1 &&
    x.qty <= MAX_QTY &&
    isDiscount(x.discount) &&
    (x.batchId === null || typeof x.batchId === 'string') &&
    typeof x.batchLot === 'string' &&
    typeof x.batchReason === 'string'
  );
};

/** A stored draft, or null when it is missing, from another version, or not a cart (never throws). */
export function parseDraft(text: string | null): Draft | null {
  if (!text) return null;
  try {
    const raw = JSON.parse(text) as Draft;
    if (raw?.v !== DRAFT_VERSION || !CURRENCIES.includes(raw.currency)) return null;
    const c = raw.cart;
    if (!c || !Array.isArray(c.lines) || c.lines.length === 0 || c.lines.length > MAX_LINES || !c.lines.every(isLine)) return null;
    if (!isDiscount(c.invoiceDiscount) || typeof c.discountReason !== 'string' || !Number.isInteger(c.seq)) return null;
    return raw;
  } catch {
    return null;
  }
}

/** A held cart from the server (`ph.sales.resume`) as a cart: the lines the screen looks up again for prices. */
export interface ResumedLine {
  productId: string;
  unitId: string;
  qty: number;
  batchId?: string;
  batchReason?: string;
  discount?: { kind: 'amount' | 'percent'; value: string | number; reason?: string };
}

/** Base units the cart takes of each product (several lines may share one product). */
export function baseQtyByProduct(cart: CartState): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of cart.lines) out.set(l.productId, (out.get(l.productId) ?? 0) + l.qty * unitOf(l).baseQty);
  return out;
}

/** Products whose cart quantity is above what was sellable when found: a warning, never a block (the sale decides). */
export function overSellable(cart: CartState): Set<string> {
  const need = baseQtyByProduct(cart);
  const over = new Set<string>();
  for (const l of cart.lines) if ((need.get(l.productId) ?? 0) > l.sellableQty) over.add(l.productId);
  return over;
}

/**
 * A held cart from `ph.sales.resume` as a cart. The hold keeps ids and quantities (and discounts as entered); names,
 * units, prices and batches come from `lookup` (a fresh search by product), because prices are decided again at sale
 * time. Lines whose product is not found are returned in `missing` by name and left out.
 */
export function cartFromResume(
  resumed: { currency: Currency; invoiceDiscount?: unknown; lines: Record<string, unknown>[] },
  lookup: ReadonlyMap<string, AddableItem>,
): { cart: CartState; missing: string[] } {
  let state = emptyCart();
  const missing: string[] = [];
  let reason = '';
  const draftOf = (raw: unknown): DiscountDraft | null => {
    const d = raw as { kind?: string; value?: unknown; reason?: unknown } | undefined;
    if (!d || (d.kind !== 'amount' && d.kind !== 'percent')) return null;
    if (typeof d.reason === 'string' && d.reason.trim() !== '') reason = d.reason;
    if (d.kind === 'percent') return { kind: 'percent', value: String(d.value) };
    try {
      return { kind: 'amount', value: plainMinor(BigInt(String(d.value)), resumed.currency) };
    } catch {
      return null;
    }
  };
  for (const raw of resumed.lines) {
    const item = lookup.get(String(raw.productId));
    if (!item) {
      missing.push(String(raw.tradeName ?? raw.productId));
      continue;
    }
    const before = state.seq;
    state = cartReducer(state, { type: 'add', item, unitId: String(raw.unitId) });
    // `add` merges into an equal line (no discount, no batch): then the hold's line is that one, else the new last line.
    const target = state.seq > before ? state.lines[state.lines.length - 1]! : state.lines.find((l) => l.productId === item.productId && l.unitId === String(raw.unitId) && l.batchId === null && l.discount === null)!;
    const qty = Number(raw.qty) + (state.seq > before ? 0 : target.qty - 1);
    state = cartReducer(state, { type: 'qty', key: target.key, qty: Number.isFinite(qty) ? qty : 1 });
    const d = draftOf(raw.discount);
    if (d) state = cartReducer(state, { type: 'discount', key: target.key, discount: d });
    if (typeof raw.batchId === 'string' && raw.batchId) {
      const b = item.batches.find((x) => x.batchId === raw.batchId);
      state = cartReducer(state, { type: 'batch', key: target.key, batchId: raw.batchId, lot: b?.lot ?? '', reason: String(raw.batchReason ?? '') });
    }
  }
  const inv = draftOf(resumed.invoiceDiscount);
  state = { ...state, invoiceDiscount: inv, discountReason: reason };
  return { cart: state, missing };
}
