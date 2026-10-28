import { keyFor, normalizeDigits, outcomeUnknown, type KeyedAttempt } from './sell-logic';

/**
 * Pure helpers of the shifts, sales and returns screens (no DOM, no clock). Every figure that is a rule (expected cash,
 * refund) comes from the server; what is here only lays it out: the variance the cashier would close with (counted minus
 * the server's expected cash), the quantities typed, the request, and the filters.
 */

export type RefundMethod = 'CASH' | 'CARD_MANUAL' | 'TRANSFER_MANUAL';
export const REFUND_METHODS: readonly RefundMethod[] = ['CASH', 'CARD_MANUAL', 'TRANSFER_MANUAL'];

export interface ClosePlan {
  varianceMinor: bigint;
  kind: 'match' | 'over' | 'short';
  needsReason: boolean;
}

/** The preview of a close: counted - expected. A reason is needed for any difference, and always when closing another person's shift. Null when nothing valid was counted. */
export function closePlan(expectedMinor: bigint, countedMinor: bigint | null, closingForOther: boolean): ClosePlan | null {
  if (countedMinor === null) return null;
  const varianceMinor = countedMinor - expectedMinor;
  return {
    varianceMinor,
    kind: varianceMinor === 0n ? 'match' : varianceMinor > 0n ? 'over' : 'short',
    needsReason: varianceMinor !== 0n || closingForOther,
  };
}

/** Paid out above the expected cash is refused by the server; the dialog warns early. */
export function paidOutHint(amountMinor: bigint | null, expectedMinor: bigint): { over: boolean; availableMinor: bigint } {
  return { over: amountMinor !== null && amountMinor > expectedMinor, availableMinor: expectedMinor };
}

export interface CashRow {
  key: 'float' | 'sales' | 'change' | 'refunds' | 'paidIn' | 'paidOut';
  sign: '+' | '-';
  minor: bigint;
}

/** The lines of the cash identity, in the order they are added and taken away. */
export function shiftCashRows(totals: { openingFloatMinor: string; expectedMinor: string; cash: { tenderedMinor: string; changeMinor: string; refundsMinor: string; paidInMinor: string; paidOutMinor: string } }): CashRow[] {
  return [
    { key: 'float', sign: '+', minor: BigInt(totals.openingFloatMinor) },
    { key: 'sales', sign: '+', minor: BigInt(totals.cash.tenderedMinor) },
    { key: 'change', sign: '-', minor: BigInt(totals.cash.changeMinor) },
    { key: 'refunds', sign: '-', minor: BigInt(totals.cash.refundsMinor) },
    { key: 'paidIn', sign: '+', minor: BigInt(totals.cash.paidInMinor) },
    { key: 'paidOut', sign: '-', minor: BigInt(totals.cash.paidOutMinor) },
  ];
}

/** A quantity typed for a return (whole base units, Arabic digits accepted). Empty is 0. `over` still carries the number so the screen can say so. */
export function parseReturnQty(text: string, remaining: number): { qty: number; error: null | 'invalid' | 'over' } {
  const clean = normalizeDigits(text);
  if (clean === '') return { qty: 0, error: null };
  if (!/^\d{1,9}$/.test(clean)) return { qty: 0, error: 'invalid' };
  const qty = Number(clean);
  return { qty, error: qty > remaining ? 'over' : null };
}

export interface ReturnRow {
  saleLineId: string;
  remaining: number;
  text: string;
}

/** The lines to send: those with a quantity. Not ok when none, or any is invalid or above what remains. */
export function returnRequest(rows: readonly ReturnRow[]): { lines: { saleLineId: string; baseQty: number }[]; ok: boolean } {
  const lines: { saleLineId: string; baseQty: number }[] = [];
  let ok = true;
  for (const row of rows) {
    const { qty, error } = parseReturnQty(row.text, row.remaining);
    if (error) ok = false;
    if (qty > 0) lines.push({ saleLineId: row.saleLineId, baseQty: qty });
  }
  return { lines, ok: ok && lines.length > 0 };
}

/** The identity of a return request (for its idempotency key): same request, same key. */
export function returnSignature(saleId: string, lines: readonly { saleLineId: string; baseQty: number }[], reason: string, method: RefundMethod): string {
  return JSON.stringify([saleId, lines.map((l) => [l.saleLineId, l.baseQty]), reason.trim(), method]);
}

/** Methods a refund may use: the ones the sale was paid with (default first); a sale with no payments takes any. */
export function refundMethodChoices(paid: readonly RefundMethod[], preferred: RefundMethod): RefundMethod[] {
  const pool = paid.length > 0 ? [...paid] : [...REFUND_METHODS];
  return [preferred, ...pool.filter((m) => m !== preferred)].filter((m, i, all) => pool.includes(m) && all.indexOf(m) === i);
}

export const SALE_STATUS_FILTERS = ['COMPLETED', 'RETURNED_PARTIAL', 'RETURNED_FULL'] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Filters from the address: only valid ones survive. */
export function saleFilterParams(raw: { status?: string; from?: string; to?: string; number?: string }): { status?: (typeof SALE_STATUS_FILTERS)[number]; from?: string; to?: string; number?: string } {
  const out: { status?: (typeof SALE_STATUS_FILTERS)[number]; from?: string; to?: string; number?: string } = {};
  const status = SALE_STATUS_FILTERS.find((s) => s === raw.status);
  if (status) out.status = status;
  if (raw.from && DATE.test(raw.from)) out.from = raw.from;
  if (raw.to && DATE.test(raw.to)) out.to = raw.to;
  const number = raw.number?.trim().slice(0, 40);
  if (number) out.number = number;
  return out;
}

/** "2026-10-28 14:03 UTC": Latin digits, the same on the server and in every browser (receipts print UTC too). */
export function formatUtc(at: string | Date): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
}

/** The first 8 characters of an id: the app has no person names for these records, so the id stands in. */
export const shortId = (id: string): string => id.slice(0, 8);

/**
 * The attempt of one paid in / paid out: same type, amount and reason, same key (so a dialog closed after a dropped
 * connection and typed again repeats it and the server records the movement once); anything changed, a new key. The
 * caller keeps the result outside the dialog and drops it (null) on success or a definite refusal.
 */
export function cashAttempt(prev: KeyedAttempt | null, kind: 'in' | 'out', amountMinor: bigint, reason: string, make?: (prefix: string) => string): KeyedAttempt {
  return keyFor(prev, `${kind}:${amountMinor}:${reason.trim()}`, 'cash', make);
}

export type CloseOutcome = 'needs-approval' | 'closed-probably' | 'unknown' | 'refused';

/**
 * What a refused or lost close means. Closing has no idempotency key, so after an unknown outcome a later
 * ALREADY_CLOSED is most likely the earlier attempt having landed: say that, not an error.
 */
export function closeOutcome(error: { message: string; fields?: { phCode?: string } | undefined }, unknownBefore: boolean): CloseOutcome {
  const code = error.fields?.phCode;
  if (code === 'NEEDS_APPROVAL') return 'needs-approval';
  if (code === 'ALREADY_CLOSED' && unknownBefore) return 'closed-probably';
  if (outcomeUnknown(error)) return 'unknown';
  return 'refused';
}

/** The refund shown is the server's answer for exactly the quantities now chosen: false while a newer choice is still being asked. */
export function previewCurrent(settledWire: string | null, wire: string): boolean {
  return settledWire !== null && settledWire === wire;
}

/** A person on a record: the name the server gave (`ph.people.names`), else the short id. */
export function personLabel(names: Readonly<Record<string, string>>, id: string): string {
  const name = names[id]?.trim();
  return name ? name : shortId(id);
}
