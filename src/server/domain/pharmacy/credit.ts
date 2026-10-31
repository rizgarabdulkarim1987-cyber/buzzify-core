/**
 * Customer credit rules (phase 7, R7-5), pure: no database, no clock (the caller passes days as `YYYY-MM-DD`, Baghdad days).
 *
 * - A customer's BALANCE is the sum of their ledger rows (positive = the customer owes). A credit sale adds a CHARGE of the credit
 *   part of the sale; a payment, a refund of a credit sale and a reversal move it back. Nothing here stores a balance.
 * - A charge is refused when `balance + charge > limit` (a charge that lands exactly on the limit is allowed). A limit of 0 allows
 *   no credit. A customer who overpaid (negative balance) has the overpayment as extra room; one above a lowered limit has none.
 * - One currency per customer: a credit sale in another currency is refused, never converted.
 * - A refund of a credit sale lowers the debt FIRST, by at most what is still owed of that sale's credit and at most what the
 *   customer still owes at all (a balance never goes negative from a refund); the rest is handed back by the original methods.
 * - Ageing: a charge belongs to the bucket of its age on the as-of day (0-30, 31-60, 61-90, over 90 days); everything paid or
 *   refunded is applied to the OLDEST charges first (FIFO), so the buckets add up to what is owed.
 */

export const AGEING_BUCKETS = ['0-30', '31-60', '61-90', '90+'] as const;
export type AgeingBucket = (typeof AGEING_BUCKETS)[number];

export type CreditRefusal = 'CURRENCY_MISMATCH' | 'CUSTOMER_INACTIVE' | 'INVALID_AMOUNT' | 'LIMIT_EXCEEDED';

export type CreditVerdict = { ok: true; newBalanceMinor: bigint } | { ok: false; reason: CreditRefusal; availableMinor?: bigint };

/** May `chargeMinor` go on the customer's account? `availableMinor` (on a limit refusal) is the room that is left, never below 0. */
export function creditCheck(input: {
  customerCurrency: string;
  saleCurrency: string;
  active: boolean;
  balanceMinor: bigint;
  limitMinor: bigint;
  chargeMinor: bigint;
}): CreditVerdict {
  if (input.customerCurrency !== input.saleCurrency) return { ok: false, reason: 'CURRENCY_MISMATCH' };
  if (!input.active) return { ok: false, reason: 'CUSTOMER_INACTIVE' };
  if (input.chargeMinor <= 0n) return { ok: false, reason: 'INVALID_AMOUNT' };
  const next = input.balanceMinor + input.chargeMinor;
  if (next > input.limitMinor) {
    const room = input.limitMinor - input.balanceMinor;
    return { ok: false, reason: 'LIMIT_EXCEEDED', availableMinor: room > 0n ? room : 0n };
  }
  return { ok: true, newBalanceMinor: next };
}

/**
 * How a refund of a credit sale divides: `creditMinor` comes off the customer's balance, `restMinor` is handed back by the
 * original (non-credit) methods. `saleCreditLeftMinor` is the credit part of the sale not yet refunded to the balance.
 */
export function splitRefund(input: { refundMinor: bigint; saleCreditLeftMinor: bigint; balanceMinor: bigint }): { creditMinor: bigint; restMinor: bigint } {
  const { refundMinor, saleCreditLeftMinor, balanceMinor } = input;
  if (refundMinor < 0n || saleCreditLeftMinor < 0n) throw new RangeError('A refund and the credit left cannot be negative');
  const owed = balanceMinor > 0n ? balanceMinor : 0n;
  let creditMinor = refundMinor;
  if (saleCreditLeftMinor < creditMinor) creditMinor = saleCreditLeftMinor;
  if (owed < creditMinor) creditMinor = owed;
  return { creditMinor, restMinor: refundMinor - creditMinor };
}

const DAY_MS = 86_400_000;
const dayMs = (day: string) => Date.parse(`${day}T00:00:00.000Z`);

/** Whole calendar days from `day` to `asOf` (both `YYYY-MM-DD`); 0 when `day` is not before `asOf`. */
export function ageDays(day: string, asOf: string): number {
  return Math.max(0, Math.round((dayMs(asOf) - dayMs(day)) / DAY_MS));
}

export function bucketOf(days: number): AgeingBucket {
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

export interface AgeingResult {
  buckets: Record<AgeingBucket, bigint>;
  owedMinor: bigint;
  /** Paid or refunded beyond every charge: what the business owes the customer. */
  unappliedMinor: bigint;
}

/** A ledger row as ageing reads it. Without `kind` a row is a plain signed amount (positive: a debt of its day, negative: a payment). */
export interface AgeingEntry {
  day: string;
  amountMinor: bigint;
  kind?: 'CHARGE' | 'PAYMENT' | 'REFUND' | 'REVERSAL';
  /** The sale a CHARGE or REFUND belongs to. */
  saleId?: string | null;
  /** The payment a PAYMENT row records. */
  paymentId?: string | null;
  /** For a REVERSAL: the payment it corrects. */
  reversesPaymentId?: string | null;
}

/**
 * Open debt by age. A charge is a debt dated its day and keyed by its sale. A REFUND cancels its own sale's charge first (a returned
 * sale is not an older debt paid off), a REVERSAL cancels the payment it corrects (the debt it puts back is the one that payment
 * had settled, not a new one); what is left (payments, a refund beyond its charge) settles the oldest debts first, whatever its own
 * day. A row of a kind it cannot attribute (a plain entry, an unlinked reversal) keeps the plain rule: positive is a debt of its day,
 * negative a payment.
 */
export function ageingBuckets(entries: readonly AgeingEntry[], asOfDay: string): AgeingResult {
  const buckets: Record<AgeingBucket, bigint> = { '0-30': 0n, '31-60': 0n, '61-90': 0n, '90+': 0n };
  const open: { day: string; left: bigint; sale: string | null }[] = [];
  let loose = 0n;
  const refunds: { saleId: string; amount: bigint }[] = [];
  const reversed = new Set(entries.filter((e) => e.kind === 'REVERSAL' && e.reversesPaymentId).map((e) => e.reversesPaymentId as string));
  for (const e of entries) {
    if (e.kind === 'REFUND' && e.saleId && e.amountMinor < 0n) refunds.push({ saleId: e.saleId, amount: -e.amountMinor });
    else if (e.kind === 'REVERSAL' && e.reversesPaymentId) continue;
    else if (e.kind === 'PAYMENT' && e.paymentId && reversed.has(e.paymentId)) continue;
    else if (e.amountMinor > 0n) open.push({ day: e.day, left: e.amountMinor, sale: e.kind === 'CHARGE' ? (e.saleId ?? null) : null });
    else loose -= e.amountMinor;
  }
  for (const refund of refunds) {
    let rest = refund.amount;
    for (const d of open) {
      if (d.sale !== refund.saleId || rest === 0n) continue;
      const used = rest < d.left ? rest : d.left;
      d.left -= used;
      rest -= used;
    }
    loose += rest;
  }
  open.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  let paid = loose;
  let owedMinor = 0n;
  for (const debt of open) {
    const used = paid < debt.left ? paid : debt.left;
    paid -= used;
    const left = debt.left - used;
    if (left > 0n) {
      buckets[bucketOf(ageDays(debt.day, asOfDay))] += left;
      owedMinor += left;
    }
  }
  return { buckets, owedMinor, unappliedMinor: paid };
}
