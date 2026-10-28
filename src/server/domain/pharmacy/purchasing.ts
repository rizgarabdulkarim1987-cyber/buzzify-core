/**
 * The arithmetic and rules of pharmacy purchasing, worked out in one place and kept pure: no Prisma, no database, no clock
 * (dates come in as arguments). Money is BigInt in the document's currency minor unit; quantities are whole base units
 * (safe integers). Dates are UTC calendar days, as `Date` or `YYYY-MM-DD`.
 *
 * Rulings: DUE_7 means due today through 7 days ahead (8 calendar days); the screens and reports use the same edge.
 * A voided invoice's lines must be excluded by the caller before `quantityTriple` (void releases the invoiced quantity).
 */
import { createHash } from 'node:crypto';

export type PurchasingCode =
  | 'INVALID_QUANTITY'
  | 'INVALID_AMOUNT'
  | 'INVALID_DATE'
  | 'INVALID_DAYS'
  | 'OVER_RECEIPT'
  | 'INVOICED_EXCEEDS_RECEIVED'
  | 'NEGATIVE_TOTAL'
  | 'ADJUSTMENT_NEEDS_REASON'
  | 'EMPTY_NUMBER'
  | 'UNALLOCATED'
  | 'OVER_ALLOCATION'
  | 'UNKNOWN_INVOICE'
  | 'DUPLICATE_INVOICE'
  | 'OVER_SETTLED';

/** An input the purchasing arithmetic refuses (a validation error, not a business outcome). */
export class PurchasingError extends Error {
  constructor(
    readonly code: PurchasingCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'PurchasingError';
  }
}

function qty(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new PurchasingError('INVALID_QUANTITY', 'A quantity is a whole number, zero or more');
  }
  return value;
}

function money(value: bigint): bigint {
  if (value < 0n) throw new PurchasingError('INVALID_AMOUNT', 'An amount cannot be negative');
  return value;
}

// ---------------------------------------------------------------------------------------------------------------------
// Purchase order status
// ---------------------------------------------------------------------------------------------------------------------

export type PoStatus = 'DRAFT' | 'ORDERED' | 'PARTIAL' | 'RECEIVED' | 'CLOSED' | 'CANCELLED';

export interface PoLineCounters {
  qtyOrdered: number;
  bonusOrdered: number;
  receivedQty: number;
  receivedBonus: number;
}

/** The status an ordered order has after a receipt: nothing received is ORDERED, all of it (bonus too) RECEIVED. */
export function poStatusAfterReceipt(lines: readonly PoLineCounters[]): 'ORDERED' | 'PARTIAL' | 'RECEIVED' {
  let anyReceived = false;
  let allReceived = true;
  for (const l of lines) {
    if (l.receivedQty + l.receivedBonus > 0) anyReceived = true;
    if (l.receivedQty < l.qtyOrdered || l.receivedBonus < l.bonusOrdered) allReceived = false;
  }
  if (!anyReceived) return 'ORDERED';
  return allReceived ? 'RECEIVED' : 'PARTIAL';
}

const EDGES: Record<PoStatus, readonly PoStatus[]> = {
  DRAFT: ['ORDERED', 'CANCELLED'],
  ORDERED: ['PARTIAL', 'RECEIVED', 'CANCELLED', 'CLOSED'],
  PARTIAL: ['PARTIAL', 'RECEIVED', 'CLOSED'], // PARTIAL -> PARTIAL: a second partial receipt
  RECEIVED: ['CLOSED'],
  CLOSED: [],
  CANCELLED: [],
};

/** Whether an order may move from one status to another. A cancel from ORDERED needs nothing received, so the caller says. */
export function canTransition(from: PoStatus, to: PoStatus, anyReceived: boolean): boolean {
  if (!EDGES[from].includes(to)) return false;
  if (from === 'ORDERED' && to === 'CANCELLED' && anyReceived) return false;
  return true;
}

/** A receipt line against an order line: refuses more than ordered (quantity and bonus separately); returns the counters. */
export function checkReceipt(
  orderLine: PoLineCounters,
  receiveQty: number,
  receiveBonus: number,
): { receivedQty: number; receivedBonus: number } {
  qty(receiveQty);
  qty(receiveBonus);
  const receivedQty = orderLine.receivedQty + receiveQty;
  const receivedBonus = orderLine.receivedBonus + receiveBonus;
  if (receivedQty > orderLine.qtyOrdered || receivedBonus > orderLine.bonusOrdered) {
    throw new PurchasingError('OVER_RECEIPT', 'More than was ordered');
  }
  return { receivedQty, receivedBonus };
}

export interface QuantityTriple {
  ordered: number;
  received: number;
  invoiced: number;
  toReceive: number;
  toInvoice: number;
}

/** Ordered, received and invoiced for one order line. Only CONFIRMED receipt lines count as received. */
export function quantityTriple(
  line: { id: string; qtyOrdered: number; bonusOrdered: number },
  receiptLines: readonly { orderLineId: string; qty: number; bonusQty: number; status: string }[],
  invoiceLines: readonly { orderLineId: string; qtyInvoiced: number }[],
): QuantityTriple {
  qty(line.qtyOrdered);
  qty(line.bonusOrdered);
  for (const r of receiptLines) {
    qty(r.qty);
    qty(r.bonusQty);
  }
  for (const i of invoiceLines) qty(i.qtyInvoiced);
  const ordered = line.qtyOrdered + line.bonusOrdered;
  let received = 0;
  for (const r of receiptLines) {
    if (r.orderLineId === line.id && r.status === 'CONFIRMED') received += r.qty + r.bonusQty;
  }
  let invoiced = 0;
  for (const i of invoiceLines) if (i.orderLineId === line.id) invoiced += i.qtyInvoiced;
  if (invoiced > received) throw new PurchasingError('INVOICED_EXCEEDS_RECEIVED', 'Invoiced more than was received');
  return { ordered, received, invoiced, toReceive: Math.max(0, ordered - received), toInvoice: received - invoiced };
}

// ---------------------------------------------------------------------------------------------------------------------
// Invoice totals
// ---------------------------------------------------------------------------------------------------------------------

/** Quantity times unit cost, exact. */
export function lineTotal(quantity: number, unitCostMinor: bigint): bigint {
  qty(quantity);
  return BigInt(quantity) * money(unitCostMinor);
}

/** The sum of the line totals plus a signed adjustment; never negative. */
export function invoiceTotal(lineTotals: readonly bigint[], adjustmentMinor: bigint): bigint {
  let sum = adjustmentMinor;
  for (const t of lineTotals) sum += money(t);
  if (sum < 0n) throw new PurchasingError('NEGATIVE_TOTAL', 'The invoice total cannot be negative');
  return sum;
}

/** Validates the adjustment part of an invoice input: a non-zero adjustment needs a reason. */
export function invoiceInput(input: { adjustmentMinor: bigint; adjustmentReason?: string | null }): {
  adjustmentMinor: bigint;
  adjustmentReason: string | null;
} {
  const reason = input.adjustmentReason?.trim() || null;
  if (input.adjustmentMinor !== 0n && !reason) {
    throw new PurchasingError('ADJUSTMENT_NEEDS_REASON', 'An adjustment needs a reason');
  }
  return { adjustmentMinor: input.adjustmentMinor, adjustmentReason: reason };
}

/** What of a receipt line may still be invoiced: quantity plus bonus minus what is already invoiced. */
export function invoiceableQty(receiptLine: { qty: number; bonusQty: number; invoicedQty: number }): number {
  const left = qty(receiptLine.qty) + qty(receiptLine.bonusQty) - qty(receiptLine.invoicedQty);
  if (left < 0) throw new PurchasingError('INVOICED_EXCEEDS_RECEIVED', 'Invoiced more than was received');
  return left;
}

// ---------------------------------------------------------------------------------------------------------------------
// Invoice keys
// ---------------------------------------------------------------------------------------------------------------------

const DIGIT_BASES = [0x0660, 0x06f0] as const; // Arabic-Indic, Persian
// Zero-width and bidi control characters, written as escapes (U+061C Arabic letter mark, U+2066-2069 isolates).
/** Exported so the supplier names are compared with the same set. */
export const INVISIBLE = /[\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

/** The supplier's invoice number in a comparable form: trimmed, spaces collapsed, upper case, Latin digits, no invisibles. */
export function normalizeInvoiceNumber(raw: string): string {
  let s = raw.replace(INVISIBLE, '');
  s = s.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (ch) => {
    const c = ch.charCodeAt(0);
    const base = c >= DIGIT_BASES[1] ? DIGIT_BASES[1] : DIGIT_BASES[0];
    return String(c - base);
  });
  s = s.replace(/\s+/g, ' ').trim().toUpperCase();
  if (!s) throw new PurchasingError('EMPTY_NUMBER', 'The invoice number is empty');
  return s;
}

/** sha256 over supplier, normalised number, date, currency and total: the same invoice entered twice gives the same value. */
export function invoiceFingerprint(input: {
  supplierId: string;
  number: string;
  date: Date | string;
  currency: string;
  totalMinor: bigint;
}): string {
  const text = [
    input.supplierId,
    normalizeInvoiceNumber(input.number),
    toDay(input.date),
    input.currency,
    input.totalMinor.toString(),
  ].join('|');
  return createHash('sha256').update(text).digest('hex');
}

/** A voided invoice frees its number and fingerprint by renaming both (R4-4a). */
export function voidedKeys(number: string, fingerprint: string, id: string): { number: string; fingerprint: string } {
  return { number: `${number}#void-${id}`, fingerprint: `${fingerprint}#void-${id}` };
}

/** The number as the supplier wrote it: a voided invoice's stored number carries a `#void-<id>` suffix that is not for people. */
export const shownNumber = (stored: string): string => stored.split('#void-')[0]!;

// ---------------------------------------------------------------------------------------------------------------------
// Due dates
// ---------------------------------------------------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/** A `Date` or `YYYY-MM-DD` as a UTC day number (days since 1970-01-01). */
function dayNumber(value: Date | string): number {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new PurchasingError('INVALID_DATE', 'Not a date');
    return Math.floor(value.getTime() / DAY_MS);
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) throw new PurchasingError('INVALID_DATE', 'Not a YYYY-MM-DD date');
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    throw new PurchasingError('INVALID_DATE', 'Not a real calendar day');
  }
  return t / DAY_MS;
}

function dayString(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

function toDay(value: Date | string): string {
  return dayString(dayNumber(value));
}

/** Whole calendar days from `b` to `a` (a - b). */
export function dayDiff(a: Date | string, b: Date | string): number {
  return dayNumber(a) - dayNumber(b);
}

/** The invoice date plus the supplier's terms, as a UTC calendar day. */
export function dueDate(invoiceDate: Date | string, termsDays: number): string {
  if (!Number.isSafeInteger(termsDays) || termsDays < 0 || termsDays > 365) throw new PurchasingError('INVALID_DAYS', 'Terms are whole days');
  return dayString(dayNumber(invoiceDate) + termsDays);
}

/** Days past due (0 when not yet due). */
export function daysOverdue(due: Date | string, today: Date | string): number {
  return Math.max(0, dayDiff(today, due));
}

export type DueBand = 'NOT_DUE' | 'DUE_7' | 'OVERDUE_1_30' | 'OVERDUE_31_60' | 'OVERDUE_60_PLUS';

/** DUE_7 is due within the next 7 days, today included. */
export function dueBand(due: Date | string, today: Date | string): DueBand {
  const ahead = dayDiff(due, today);
  if (ahead > 7) return 'NOT_DUE';
  if (ahead >= 0) return 'DUE_7';
  const late = -ahead;
  if (late <= 30) return 'OVERDUE_1_30';
  if (late <= 60) return 'OVERDUE_31_60';
  return 'OVERDUE_60_PLUS';
}

// ---------------------------------------------------------------------------------------------------------------------
// Allocation
// ---------------------------------------------------------------------------------------------------------------------

export interface Allocation {
  invoiceId: string;
  amountMinor: bigint;
}

/**
 * Splits a payment (or a credit note) across invoices. With an explicit list each part is validated; without one the oldest
 * due invoice is paid in full first (then by id). An amount that cannot be fully placed is UNALLOCATED: no advances.
 */
export function planAllocation(
  amountMinor: bigint,
  invoices: readonly { id: string; dueDate: Date | string; balanceMinor: bigint }[],
  explicit?: readonly Allocation[],
): Allocation[] {
  if (amountMinor <= 0n) throw new PurchasingError('INVALID_AMOUNT', 'The amount must be above zero');
  const balances = new Map<string, bigint>();
  for (const inv of invoices) {
    if (balances.has(inv.id)) throw new PurchasingError('DUPLICATE_INVOICE', 'An invoice appears twice');
    balances.set(inv.id, money(inv.balanceMinor));
  }

  if (explicit) {
    const summed = new Map<string, bigint>();
    for (const e of explicit) {
      if (e.amountMinor <= 0n) throw new PurchasingError('INVALID_AMOUNT', 'Each allocation must be above zero');
      summed.set(e.invoiceId, (summed.get(e.invoiceId) ?? 0n) + e.amountMinor);
    }
    let sum = 0n;
    const out: Allocation[] = [];
    for (const [invoiceId, part] of summed) {
      const balance = balances.get(invoiceId);
      if (balance === undefined) throw new PurchasingError('UNKNOWN_INVOICE', 'Not an open invoice of this supplier');
      if (part > balance) throw new PurchasingError('OVER_ALLOCATION', 'More than the invoice balance');
      sum += part;
      out.push({ invoiceId, amountMinor: part });
    }
    if (sum > amountMinor) throw new PurchasingError('OVER_ALLOCATION', 'Allocated more than the amount');
    if (sum < amountMinor) throw new PurchasingError('UNALLOCATED', 'Part of the amount is not allocated');
    return out;
  }

  const open = invoices
    .filter((i) => i.balanceMinor > 0n)
    .map((i) => ({ id: i.id, due: dayNumber(i.dueDate), balance: i.balanceMinor }))
    .sort((a, b) => a.due - b.due || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let left = amountMinor;
  const out: Allocation[] = [];
  for (const inv of open) {
    if (left === 0n) break;
    const part = left < inv.balance ? left : inv.balance;
    out.push({ invoiceId: inv.id, amountMinor: part });
    left -= part;
  }
  if (left > 0n) throw new PurchasingError('UNALLOCATED', 'Part of the amount is not allocated');
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Invoice status
// ---------------------------------------------------------------------------------------------------------------------

export type InvoiceStatus = 'OPEN' | 'PARTIAL' | 'PAID' | 'VOID';

export function invoiceStatus(input: {
  totalMinor: bigint;
  paidMinor: bigint;
  creditedMinor: bigint;
  voided: boolean;
}): InvoiceStatus {
  money(input.paidMinor);
  money(input.creditedMinor);
  if (input.voided) {
    if (input.paidMinor > 0n || input.creditedMinor > 0n) {
      throw new PurchasingError('OVER_SETTLED', 'A voided invoice cannot have payments or credits');
    }
    return 'VOID';
  }
  const settled = input.paidMinor + input.creditedMinor;
  if (settled > input.totalMinor) throw new PurchasingError('OVER_SETTLED', 'Paid and credited exceed the total');
  if (settled === input.totalMinor) return 'PAID';
  return settled > 0n ? 'PARTIAL' : 'OPEN';
}

// ---------------------------------------------------------------------------------------------------------------------
// Statement
// ---------------------------------------------------------------------------------------------------------------------

export type StatementKind = 'INVOICE' | 'PAYMENT' | 'PAYMENT_REVERSAL' | 'CREDIT_NOTE' | 'INVOICE_VOID';

export interface StatementInput {
  at: Date;
  kind: StatementKind;
  amountMinor: bigint;
  ref: string;
}

export interface StatementRow extends StatementInput {
  balanceMinor: bigint;
}

const ADDS: Record<StatementKind, boolean> = {
  INVOICE: true,
  PAYMENT_REVERSAL: true,
  PAYMENT: false,
  CREDIT_NOTE: false,
  INVOICE_VOID: false,
};

/** Rows in time order (ties keep input order) with a running balance, the closing balance and totals by kind. One currency. */
export function buildStatement(input: { openingMinor: bigint; rows: readonly StatementInput[] }): {
  openingMinor: bigint;
  rows: StatementRow[];
  closingMinor: bigint;
  totals: Record<StatementKind, bigint>;
} {
  const totals: Record<StatementKind, bigint> = {
    INVOICE: 0n,
    PAYMENT: 0n,
    PAYMENT_REVERSAL: 0n,
    CREDIT_NOTE: 0n,
    INVOICE_VOID: 0n,
  };
  const sorted = input.rows.map((r) => ({ ...r })).sort((a, b) => a.at.getTime() - b.at.getTime());
  let balance = input.openingMinor;
  const rows = sorted.map((r) => {
    money(r.amountMinor);
    balance += ADDS[r.kind] ? r.amountMinor : -r.amountMinor;
    totals[r.kind] += r.amountMinor;
    return { ...r, balanceMinor: balance };
  });
  return { openingMinor: input.openingMinor, rows, closingMinor: balance, totals };
}

/** closing = sum(open invoice balances) - unapplied credit - unreversed advance. `difference` is closing minus that. */
export function statementInvariant(
  closingMinor: bigint,
  openInvoices: readonly { balanceMinor: bigint }[],
  unappliedCreditMinor: bigint,
  unreversedAdvanceMinor = 0n,
): { ok: boolean; difference: bigint } {
  let expected = -unappliedCreditMinor - unreversedAdvanceMinor;
  for (const i of openInvoices) expected += i.balanceMinor;
  const difference = closingMinor - expected;
  return { ok: difference === 0n, difference };
}

// ---------------------------------------------------------------------------------------------------------------------
// Cost variance
// ---------------------------------------------------------------------------------------------------------------------

/** Signed unit-cost differences (later minus earlier); null when either side is missing. */
export function costVariance(input: { orderedUnitCost?: bigint; receivedUnitCost?: bigint; invoicedUnitCost?: bigint }): {
  orderVsReceived: bigint | null;
  receivedVsInvoiced: bigint | null;
  orderVsInvoiced: bigint | null;
} {
  const diff = (from?: bigint, to?: bigint) => (from === undefined || to === undefined ? null : to - from);
  return {
    orderVsReceived: diff(input.orderedUnitCost, input.receivedUnitCost),
    receivedVsInvoiced: diff(input.receivedUnitCost, input.invoicedUnitCost),
    orderVsInvoiced: diff(input.orderedUnitCost, input.invoicedUnitCost),
  };
}
