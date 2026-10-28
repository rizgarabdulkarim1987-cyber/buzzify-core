import { parseMoney, type Currency } from '@/server/domain/pharmacy/money';
import type { PoSuggestion } from '@/server/pharmacy/purchase-orders';
import { minorToText, type UnitChoice } from './receipt-draft';
import { wholeOf } from './product-draft';

/**
 * The pure parts of the purchasing screens: what an order form holds, its totals, the request it makes and the key that
 * request is sent with, the merge of reorder suggestions, the pre-fill of a receipt from an order, and the cost variance.
 * No React, no server: money is BigInt minor units with its currency, never a Float.
 */

export interface PoDraftLine {
  /** Stable within the form, so a row keeps its fields when another is removed. */
  key: string;
  productId: string;
  productName: string;
  productMeta: string;
  units: UnitChoice[];
  unitId: string;
  qty: string;
  bonus: string;
  cost: string;
}

export interface PoDraft {
  /** The saved order's version this draft was made on (0 before the first save). */
  version: number;
  /** Idempotency key of the first save; kept with the draft so a retry after a lost answer replays. */
  clientKey: string;
  /** The signature `clientKey` was made for: the key is reused only while the request is the same. */
  keySig?: string;
  supplierId: string;
  supplierName: string;
  currency: Currency;
  expectedOn: string;
  note: string;
  lines: PoDraftLine[];
}

export function emptyPoDraft(clientKey: string, currency: Currency): PoDraft {
  return { version: 0, clientKey, supplierId: '', supplierName: '', currency, expectedOn: '', note: '', lines: [] };
}

/** The money of one line as typed, or null when the quantity or the cost is not (yet) a valid amount. */
function lineTotal(line: PoDraftLine, currency: Currency): bigint | null {
  const qty = wholeOf(line.qty);
  const money = parseMoney(line.cost, currency);
  if (qty === null || qty < 1 || !money) return null;
  return money.amount * BigInt(qty);
}

/** What the order costs, per currency. Bonus units are not charged. Lines still being typed are left out. */
export function poTotals(draft: PoDraft): { currency: Currency; totalMinor: bigint }[] {
  let total = 0n;
  for (const l of draft.lines) total += lineTotal(l, draft.currency) ?? 0n;
  return [{ currency: draft.currency, totalMinor: total }];
}

/** Quantity and bonus still to arrive on an order line, each against its own ordered figure. */
export function remainingOf(l: { qtyOrdered: number; bonusOrdered: number; receivedQty: number; receivedBonus: number }): { qty: number; bonus: number } {
  return { qty: Math.max(0, l.qtyOrdered - l.receivedQty), bonus: Math.max(0, l.bonusOrdered - l.receivedBonus) };
}

export type PoProblem = 'supplier' | 'qty' | 'bonus' | 'cost' | 'unit' | 'lines' | 'duplicate' | 'date';

export interface PoBuilt {
  input?: Record<string, unknown>;
  /** Field name (`supplierId`, `expectedOn`, `lines`, `lines.<i>.<field>`) to a problem code. */
  problems: Record<string, PoProblem>;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The action input for a draft and the problems that need no server. The place is put in by the Server Action. */
export function poInputOf(draft: PoDraft): PoBuilt {
  const problems: PoBuilt['problems'] = {};
  if (!draft.supplierId) problems.supplierId = 'supplier';
  if (draft.expectedOn.trim() !== '' && !DATE.test(draft.expectedOn)) problems.expectedOn = 'date';
  if (draft.lines.length === 0) problems.lines = 'lines';
  const seen = new Set<string>();
  const lines = draft.lines.map((l, i) => {
    const qty = wholeOf(l.qty);
    if (qty === null || qty < 1) problems[`lines.${i}.qty`] = 'qty';
    const bonus = l.bonus.trim() === '' ? 0 : wholeOf(l.bonus);
    if (bonus === null) problems[`lines.${i}.bonus`] = 'bonus';
    const money = parseMoney(l.cost, draft.currency);
    if (!money) problems[`lines.${i}.cost`] = 'cost';
    if (!l.unitId) problems[`lines.${i}.unitId`] = 'unit';
    const pair = `${l.productId}|${l.unitId}`;
    if (seen.has(pair)) problems[`lines.${i}.productId`] = 'duplicate';
    seen.add(pair);
    return { productId: l.productId, unitId: l.unitId, qtyOrdered: qty ?? 0, bonusOrdered: bonus ?? 0, unitCostMinor: money ? money.amount.toString() : '0' };
  });
  if (Object.keys(problems).length > 0) return { problems };
  return {
    problems,
    input: { supplierId: draft.supplierId, currency: draft.currency, expectedOn: draft.expectedOn.trim() === '' ? null : draft.expectedOn, note: draft.note, lines },
  };
}

/**
 * What tells two save requests apart: every field the server hashes, as typed, and nothing else (not the key, not the
 * version). The caller keeps one key while this is unchanged and takes a new one when it changes.
 */
export function poSignature(draft: PoDraft): string {
  return JSON.stringify([
    draft.supplierId,
    draft.currency,
    draft.expectedOn,
    draft.note,
    draft.lines.map((l) => [l.productId, l.unitId, l.qty, l.bonus, l.cost]),
  ]);
}

/**
 * Adds the reorder suggestions as lines, in each product's base unit with the suggested quantity. A product already on
 * the order is left as it is. `counter` numbers the new line keys (`n<counter+1>`, ...).
 */
export function mergeSuggestions(lines: PoDraftLine[], suggestions: PoSuggestion[], counter: number): { lines: PoDraftLine[]; added: number; skipped: number } {
  const have = new Set(lines.map((l) => l.productId));
  const next = [...lines];
  let added = 0;
  let skipped = 0;
  for (const s of suggestions) {
    if (have.has(s.productId)) {
      skipped += 1;
      continue;
    }
    have.add(s.productId);
    added += 1;
    next.push({
      key: `n${counter + added}`,
      productId: s.productId,
      productName: s.productName,
      productMeta: '',
      units: [{ id: s.baseUnitId, label: s.baseUnitLabel, baseQty: 1 }],
      unitId: s.baseUnitId,
      qty: String(s.suggestedQty),
      bonus: '0',
      cost: '',
    });
  }
  return { lines: next, added, skipped };
}

export interface OrderLineFigures {
  lineId: string;
  productId: string;
  unitId: string;
  qtyOrdered: number;
  bonusOrdered: number;
  receivedQty: number;
  receivedBonus: number;
  /** Present only for a role with `cost.view`. */
  unitCostMinor?: string | undefined;
}

/** A receipt line's start from an order line: what is still to arrive, bonus apart, and the agreed cost. Null when nothing is left. */
export function orderLineToReceiptLine(
  l: OrderLineFigures,
  currency: Currency,
): { purchaseOrderLineId: string; productId: string; unitId: string; qty: string; bonusQty: string; cost: string; currency: Currency } | null {
  const left = remainingOf(l);
  if (left.qty === 0 && left.bonus === 0) return null;
  return {
    purchaseOrderLineId: l.lineId,
    productId: l.productId,
    unitId: l.unitId,
    qty: String(left.qty),
    bonusQty: String(left.bonus),
    cost: l.unitCostMinor === undefined ? '' : minorToText(BigInt(l.unitCostMinor), currency),
    currency,
  };
}

export type Variance =
  | { kind: 'same' }
  | { kind: 'higher' | 'lower'; diffMinor: bigint; currency: Currency }
  | { kind: 'currency' };

/** The received cost against the order's, per unit. Different currencies are not compared. */
export function costVariance(args: { orderMinor: bigint; orderCurrency: Currency; receivedMinor: bigint; receivedCurrency: Currency }): Variance {
  if (args.orderCurrency !== args.receivedCurrency) return { kind: 'currency' };
  if (args.receivedMinor === args.orderMinor) return { kind: 'same' };
  const higher = args.receivedMinor > args.orderMinor;
  return { kind: higher ? 'higher' : 'lower', diffMinor: higher ? args.receivedMinor - args.orderMinor : args.orderMinor - args.receivedMinor, currency: args.receivedCurrency };
}

// Supplier form --------------------------------------------------------------------------------------------------------

export interface SupplierDraft {
  version: number;
  clientKey: string;
  /** The signature `clientKey` was made for: the key is reused only while the request is the same. */
  keySig?: string;
  name: string;
  phone: string;
  contactName: string;
  addressNote: string;
  defaultCurrency: Currency;
  /** Days, as typed. */
  termsDays: string;
  note: string;
}

export function emptySupplierDraft(clientKey: string, currency: Currency): SupplierDraft {
  return { version: 0, clientKey, name: '', phone: '', contactName: '', addressNote: '', defaultCurrency: currency, termsDays: '0', note: '' };
}

export type SupplierProblem = 'name' | 'terms';

export function supplierInputOf(draft: SupplierDraft): { input?: Record<string, unknown>; problems: Record<string, SupplierProblem> } {
  const problems: Record<string, SupplierProblem> = {};
  if (draft.name.trim() === '') problems.name = 'name';
  const terms = draft.termsDays.trim() === '' ? 0 : wholeOf(draft.termsDays);
  if (terms === null || terms > 365) problems.termsDays = 'terms';
  if (Object.keys(problems).length > 0) return { problems };
  return {
    problems,
    input: {
      name: draft.name,
      phone: draft.phone,
      contactName: draft.contactName,
      addressNote: draft.addressNote,
      defaultCurrency: draft.defaultCurrency,
      termsDays: terms ?? 0,
      note: draft.note,
    },
  };
}

/** Every field the server hashes, as typed; not the key and not the version. */
export function supplierSignature(draft: SupplierDraft): string {
  return JSON.stringify([draft.name, draft.phone, draft.contactName, draft.addressNote, draft.defaultCurrency, draft.termsDays, draft.note]);
}
