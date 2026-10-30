import { AGEING_BUCKETS, type AgeingBucket } from '@/server/domain/pharmacy/credit';
import { addDays, baghdadWindow, ReportsError } from '@/server/domain/pharmacy/reports-domain';
import { formatMinor, parseMoney, type Currency, type PayDraft } from './sell-logic';

/**
 * Credit on the sale screen and the customer screens, pure. Every amount is read from the server's exact strings into BigInt
 * (never a float) and written per currency exponent; nothing is ever summed across currencies. The limit rule is the server's
 * (`creditCheck`: a charge landing exactly on the limit is allowed, a limit of 0 allows none); the server stays the authority.
 */

/** What the sale screen knows of a customer (the server's `CustomerView` without the personal fields). */
export interface CustomerLite {
  id: string;
  currency: Currency;
  creditLimitMinor: string;
  balanceMinor: string;
  availableMinor: string;
  active: boolean;
}

export interface CreditView {
  balance: bigint;
  limit: bigint;
  /** The room left under the limit now (0 when at or above it). */
  remaining: bigint;
  after: bigint;
  remainingAfter: bigint;
  over: boolean;
  overBy: bigint;
}

const zeroFloor = (n: bigint) => (n > 0n ? n : 0n);

/** Balance, limit and room for a charge of `chargeMinor`. */
export function creditView(customer: CustomerLite, chargeMinor: bigint): CreditView {
  const balance = BigInt(customer.balanceMinor);
  const limit = BigInt(customer.creditLimitMinor);
  const after = balance + chargeMinor;
  return {
    balance,
    limit,
    remaining: zeroFloor(limit - balance),
    after,
    remainingAfter: zeroFloor(limit - after),
    over: after > limit,
    overBy: zeroFloor(after - limit),
  };
}

/** Why a customer cannot be charged at all in this sale (null: they can). */
export function creditablePerson(customer: CustomerLite, saleCurrency: Currency): 'currency' | 'archived' | null {
  if (customer.currency !== saleCurrency) return 'currency';
  if (!customer.active) return 'archived';
  return null;
}

export type CreditProblem = 'customer' | 'currency' | 'archived' | 'amount' | 'overTotal' | 'overLimit' | 'rest';

export interface CreditPreview {
  creditMinor: bigint | null;
  /** What the other method pays: the total less the credit. */
  restMinor: bigint;
  /** What the person hands over by the other method (cash tendered, or the card or transfer amount); 0 when credit covers everything. */
  amountMinor: bigint;
  /** Change is from the cash handed over for the rest only; credit never enters it. */
  changeMinor: bigint;
  ok: boolean;
  problem: CreditProblem | null;
}

/**
 * The payment of a sale with part on a customer's account: the credit amount (typed), the rest by `draft.method`. Cash tendered must
 * cover the rest; card and transfer are exactly the rest. Credit is checked against the customer's room before anything is sent.
 */
export function creditPreview(draft: PayDraft, totalMinor: bigint, currency: Currency, customer: CustomerLite | null): CreditPreview {
  const fail = (problem: CreditProblem, extra: Partial<CreditPreview> = {}): CreditPreview => ({ creditMinor: null, restMinor: 0n, amountMinor: 0n, changeMinor: 0n, ok: false, problem, ...extra });
  if (!draft.credit || !customer) return fail('customer');
  const blocked = creditablePerson(customer, currency);
  if (blocked) return fail(blocked);
  const typed = draft.credit.amount.trim() === '' ? null : parseMoney(draft.credit.amount, currency);
  if (typed === null || typed <= 0n) return fail('amount');
  if (typed > totalMinor) return fail('overTotal', { creditMinor: typed });
  if (creditView(customer, typed).over) return fail('overLimit', { creditMinor: typed });
  const rest = totalMinor - typed;
  if (rest === 0n) return { creditMinor: typed, restMinor: 0n, amountMinor: 0n, changeMinor: 0n, ok: true, problem: null };
  const handed = draft.tendered.trim() === '' ? rest : parseMoney(draft.tendered, currency);
  if (handed === null) return { creditMinor: typed, restMinor: rest, amountMinor: 0n, changeMinor: 0n, ok: false, problem: 'rest' };
  if (draft.method === 'CASH') {
    return { creditMinor: typed, restMinor: rest, amountMinor: handed, changeMinor: handed > rest ? handed - rest : 0n, ok: handed >= rest, problem: handed >= rest ? null : 'rest' };
  }
  return { creditMinor: typed, restMinor: rest, amountMinor: handed, changeMinor: 0n, ok: handed === rest, problem: handed === rest ? null : 'rest' };
}

/**
 * The payments of the request: the other method first (when something is left to pay), then CREDIT, each with its own key. The
 * cash amount is what was handed over, so the server computes the change from the rest alone.
 */
export function creditPaymentsOf(draft: PayDraft, creditMinor: bigint, amountMinor: bigint, keys: { paymentKey: string; creditKey: string }) {
  return [
    ...(amountMinor > 0n ? [{ method: draft.method, amountMinor: amountMinor.toString(), reference: draft.reference.trim(), clientKey: keys.paymentKey }] : []),
    { method: 'CREDIT' as const, amountMinor: creditMinor.toString(), reference: '', clientKey: keys.creditKey },
  ];
}

// Statement and ageing -----------------------------------------------------------------------------------------------------

/** `+25,000` / `−10.50` / `0`: a signed amount from an exact string, in the currency's own digits. */
export function signedMinorText(minor: string, currency: Currency): string {
  const n = BigInt(minor);
  if (n === 0n) return '0';
  return `${n < 0n ? '−' : '+'}${formatMinor(n < 0n ? -n : n, currency)}`;
}

export interface StatementRowIn {
  id: string;
  kind: 'CHARGE' | 'PAYMENT' | 'REVERSAL' | 'REFUND';
  day: string;
  at: string;
  amountMinor: string;
  balanceMinor: string;
  saleId: string | null;
  saleNumber: string | null;
  paymentId: string | null;
  method: 'CASH' | 'CARD' | 'TRANSFER' | null;
  corrected: boolean;
}

export interface StatementRowOut {
  id: string;
  kind: StatementRowIn['kind'];
  day: string;
  /** What the customer owes more (a charge, a reversal): empty for a payment or a refund. */
  debit: string;
  credit: string;
  balance: string;
  saleId: string | null;
  saleNumber: string | null;
  paymentId: string | null;
  method: StatementRowIn['method'];
  /** A payment not yet corrected may be corrected, once. */
  correctable: boolean;
}

export function statementRowOf(row: StatementRowIn, currency: Currency): StatementRowOut {
  const amount = BigInt(row.amountMinor);
  const balance = BigInt(row.balanceMinor);
  return {
    id: row.id,
    kind: row.kind,
    day: row.day,
    debit: amount > 0n ? formatMinor(amount, currency) : '',
    credit: amount < 0n ? formatMinor(-amount, currency) : '',
    balance: balance < 0n ? `−${formatMinor(-balance, currency)}` : formatMinor(balance, currency),
    saleId: row.saleId,
    saleNumber: row.saleNumber,
    paymentId: row.paymentId,
    method: row.method,
    correctable: row.kind === 'PAYMENT' && row.paymentId !== null && !row.corrected,
  };
}

export interface AgeingItemIn {
  customerId: string;
  name: string;
  currency: Currency;
  owedMinor: string;
  buckets: Record<AgeingBucket, string>;
}

export function ageingRowOf(item: AgeingItemIn) {
  return {
    customerId: item.customerId,
    name: item.name,
    currency: item.currency,
    owed: formatMinor(BigInt(item.owedMinor), item.currency),
    cells: AGEING_BUCKETS.map((bucket) => ({ bucket, text: formatMinor(BigInt(item.buckets[bucket]), item.currency) })),
  };
}

/** `owed` text of a total in its currency (the screens group totals per currency; this is only the formatting). */
export const owedText = (minor: string, currency: Currency) => `${formatMinor(BigInt(minor), currency)} ${currency}`;

// The statement's range ---------------------------------------------------------------------------------------------------

export type RangeProblem = 'malformed' | 'order' | 'long';

/**
 * The statement's days from the address: both given and valid, or the last 30 Baghdad days. A range the server would refuse (not a
 * date, start after end, more than 366 days) is judged here with the server's own function and said in words; the screen then shows
 * the default range, never a half-read one.
 */
export function statementRange(rawFrom: string | undefined, rawTo: string | undefined, today: string): { from: string; to: string; problem: RangeProblem | null } {
  const fallback = { from: addDays(today, -29), to: today };
  if (rawFrom === undefined && rawTo === undefined) return { ...fallback, problem: null };
  try {
    baghdadWindow(rawFrom ?? '', rawTo ?? '');
    return { from: rawFrom as string, to: rawTo as string, problem: null };
  } catch (error) {
    if (!(error instanceof ReportsError)) throw error;
    return { ...fallback, problem: error.code === 'RANGE_TOO_LONG' ? 'long' : error.code === 'FROM_AFTER_TO' ? 'order' : 'malformed' };
  }
}
