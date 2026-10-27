/**
 * The arithmetic of a pharmacy sale, worked out in one place and kept pure: no Prisma, no database, no clock (dates come
 * in as arguments). Money is BigInt in the sale currency's minor unit; quantities are whole base units. A percent is in
 * basis points (1% = 100) and every comparison is an integer comparison, never a float.
 *
 * Rounding rules, stated once:
 *  - A percentage discount rounds DOWN (floor), so the pharmacy never gives more than was asked for.
 *  - An invoice discount is shared across lines by largest remainder: the parts sum EXACTLY to the discount, ties go to the
 *    lower line index, and a part never exceeds its line.
 *  - Invoice rounding goes to the nearest step, a tie goes UP; the signed difference is kept beside the total.
 *  - A refund is proportional to the units returned; the cumulative refund is floored, and the last unit refunds the
 *    remainder, so the refunds never exceed the line total and finally equal it.
 */

/** The Postgres bigint maximum: nothing larger can be stored. */
export const PG_BIGINT_MAX = 9223372036854775807n;
/** An application sanity cap on any single amount (10^15 minor units), far below the Postgres limit. */
export const MAX_AMOUNT_MINOR = 10n ** 15n;
/** A quantity (sold or base) fits a 32-bit integer column. */
export const MAX_QTY = 2147483647n;
/** The invoice rounding steps a branch may choose (0 = none). */
export const ROUNDING_STEPS = [0, 25, 50, 250, 500, 1000, 5000] as const;
export type RoundingStep = (typeof ROUNDING_STEPS)[number];
export type PaymentMethod = 'CASH' | 'CARD_MANUAL' | 'TRANSFER_MANUAL';

export type SaleMathCode =
  | 'INVALID_QUANTITY'
  | 'INVALID_PRICE'
  | 'INVALID_AMOUNT'
  | 'INVALID_DISCOUNT'
  | 'INVALID_ROUNDING_STEP'
  | 'ROUNDING_NOT_FOR_CURRENCY'
  | 'INVALID_DATE'
  | 'INVALID_SEQUENCE'
  | 'INVALID_DAYS'
  | 'OVERFLOW'
  | 'DISCOUNT_EXCEEDS_TOTAL';

/** An input the sale arithmetic refuses (a programming or validation error, not a business outcome). */
export class SaleMathError extends Error {
  constructor(
    readonly code: SaleMathCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'SaleMathError';
  }
}

const BASIS = 10_000n;

function amount(value: bigint): bigint {
  if (value < 0n) throw new SaleMathError('INVALID_AMOUNT', 'An amount cannot be negative');
  return value;
}

/** Quantity times the unit price. Refuses above the sanity cap (and so above the Postgres maximum) instead of wrapping. */
export function lineGross(qty: bigint, unitPriceMinor: bigint): bigint {
  if (qty < 1n) throw new SaleMathError('INVALID_QUANTITY', 'A line needs at least one unit');
  if (unitPriceMinor < 0n) throw new SaleMathError('INVALID_PRICE', 'A price cannot be negative');
  if (qty > MAX_QTY || unitPriceMinor > PG_BIGINT_MAX) throw new SaleMathError('OVERFLOW');
  const gross = qty * unitPriceMinor;
  if (gross > MAX_AMOUNT_MINOR) throw new SaleMathError('OVERFLOW', 'The line total is above the allowed maximum');
  return gross;
}

export type LineDiscountInput = { kind: 'amount'; value: bigint } | { kind: 'percent'; value: number };

/** The discount on one line: an amount capped at the gross, or basis points of it rounded down. */
export function lineDiscount(gross: bigint, discount: LineDiscountInput): bigint {
  amount(gross);
  if (discount.kind === 'amount') {
    if (discount.value < 0n) throw new SaleMathError('INVALID_DISCOUNT', 'A discount cannot be negative');
    return discount.value < gross ? discount.value : gross;
  }
  if (!Number.isInteger(discount.value) || discount.value < 0 || discount.value > 10_000) {
    throw new SaleMathError('INVALID_DISCOUNT', 'A percent is whole basis points from 0 to 10000');
  }
  return (gross * BigInt(discount.value)) / BASIS;
}

/**
 * Shares an invoice discount across lines in proportion to each line's remaining total (after its own discount), by
 * largest remainder. The parts sum exactly to `discountMinor`; a part never exceeds its line's total.
 */
export function invoiceDiscountAllocation(lines: readonly { totalMinor: bigint }[], discountMinor: bigint): bigint[] {
  let sum = 0n;
  for (const l of lines) sum += amount(l.totalMinor);
  if (discountMinor < 0n) throw new SaleMathError('INVALID_DISCOUNT', 'A discount cannot be negative');
  if (discountMinor > sum) throw new SaleMathError('DISCOUNT_EXCEEDS_TOTAL', 'The discount is more than the lines add up to');
  const parts = lines.map(() => 0n);
  if (discountMinor === 0n) return parts;
  const remainders: { index: number; remainder: bigint }[] = [];
  let given = 0n;
  lines.forEach((l, index) => {
    if (l.totalMinor === 0n) return;
    const scaled = discountMinor * l.totalMinor;
    parts[index] = scaled / sum;
    given += parts[index]!;
    remainders.push({ index, remainder: scaled % sum });
  });
  // Biggest remainder first; equal remainders go to the lower line index.
  remainders.sort((a, b) => (a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1));
  let left = discountMinor - given;
  for (const { index } of remainders) {
    if (left === 0n) break;
    parts[index] = parts[index]! + 1n;
    left -= 1n;
  }
  return parts;
}

/**
 * The invoice total rounded to the nearest step (a tie goes up) and the signed difference. Step 0 changes nothing.
 * Only IQD is rounded: a non-zero step with any other currency is REFUSED (ROUNDING_NOT_FOR_CURRENCY), never silently ignored.
 */
export function invoiceRounding(totalMinor: bigint, stepMinor: number, currency: 'IQD' | 'USD'): { roundedMinor: bigint; roundingMinor: bigint } {
  if (!(ROUNDING_STEPS as readonly number[]).includes(stepMinor)) {
    throw new SaleMathError('INVALID_ROUNDING_STEP', 'The rounding step is not one of the allowed steps');
  }
  if (stepMinor !== 0 && currency !== 'IQD') throw new SaleMathError('ROUNDING_NOT_FOR_CURRENCY', 'Only IQD invoices are rounded');
  amount(totalMinor);
  if (stepMinor === 0) return { roundedMinor: totalMinor, roundingMinor: 0n };
  const step = BigInt(stepMinor);
  const roundedMinor = ((2n * totalMinor + step) / (2n * step)) * step;
  return { roundedMinor, roundingMinor: roundedMinor - totalMinor };
}

export interface PaymentInput {
  method: PaymentMethod;
  amountMinor: bigint;
}
export type PaymentCheck =
  | { ok: true; paidMinor: bigint; changeMinor: bigint }
  | { ok: false; reason: 'SHORT' | 'NON_CASH_OVERPAY' | 'CASH_NOT_NEEDED' | 'INVALID_PAYMENT'; paidMinor: bigint; changeMinor: 0n };

const METHODS: readonly string[] = ['CASH', 'CARD_MANUAL', 'TRANSFER_MANUAL'];

/**
 * Do the payments settle the total? `paidMinor` is everything tendered. Cash may exceed the total (the change is the
 * overpay) but only when the non-cash parts do not themselves exceed the total; non-cash never overpays.
 */
export function paymentCheck(input: { totalMinor: bigint; payments: readonly PaymentInput[] }): PaymentCheck {
  const total = amount(input.totalMinor);
  let paid = 0n;
  let nonCash = 0n;
  for (const p of input.payments) {
    if (!METHODS.includes(p.method) || p.amountMinor <= 0n || p.amountMinor > MAX_AMOUNT_MINOR) return { ok: false, reason: 'INVALID_PAYMENT', paidMinor: 0n, changeMinor: 0n };
    paid += p.amountMinor;
    if (p.method !== 'CASH') nonCash += p.amountMinor;
    if (paid > MAX_AMOUNT_MINOR) return { ok: false, reason: 'INVALID_PAYMENT', paidMinor: 0n, changeMinor: 0n };
  }
  const cash = paid - nonCash;
  if (nonCash > total) return { ok: false, reason: 'NON_CASH_OVERPAY', paidMinor: paid, changeMinor: 0n };
  if (cash > 0n && nonCash >= total) return { ok: false, reason: 'CASH_NOT_NEEDED', paidMinor: paid, changeMinor: 0n };
  if (paid < total) return { ok: false, reason: 'SHORT', paidMinor: paid, changeMinor: 0n };
  return { ok: true, paidMinor: paid, changeMinor: paid - total };
}

export type DiscountVerdict = 'ok' | 'needs_over_limit' | 'forbidden';

/**
 * May this discount be given? It is compared with the gross exactly (`discount x 10000 > gross x limit`). `ok` is
 * within `maxPercentBp` for a holder of discount.apply; above it the person needs the over-limit permission (and gives
 * a reason); without discount.apply, or above the limit without the over-limit permission, it is forbidden.
 */
export function discountPolicy(input: {
  discountMinor: bigint;
  grossMinor: bigint;
  maxPercentBp: number;
  canApply: boolean;
  canOverLimit: boolean;
}): DiscountVerdict {
  if (!Number.isInteger(input.maxPercentBp) || input.maxPercentBp < 0 || input.maxPercentBp > 10_000) {
    throw new SaleMathError('INVALID_DISCOUNT', 'The discount limit is whole basis points from 0 to 10000');
  }
  if (input.discountMinor < 0n) throw new SaleMathError('INVALID_DISCOUNT', 'A discount cannot be negative');
  amount(input.grossMinor);
  if (input.discountMinor === 0n) return 'ok';
  if (!input.canApply) return 'forbidden';
  if (input.discountMinor * BASIS <= input.grossMinor * BigInt(input.maxPercentBp)) return 'ok';
  return input.canOverLimit ? 'needs_over_limit' : 'forbidden';
}

/**
 * Line and invoice discounts judged together: the total given away and its share of the total gross in whole basis
 * points (rounded down). Feed `totalDiscountMinor` and `grossMinor` to discountPolicy, so 5% on a line plus 5% on the
 * invoice is judged as the combined figure, not as two small ones.
 */
export function effectiveDiscount(input: {
  lines: readonly { grossMinor: bigint; lineDiscountMinor: bigint }[];
  invoiceDiscountMinor: bigint;
}): { grossMinor: bigint; totalDiscountMinor: bigint; basisPoints: number } {
  let gross = 0n;
  let lineDiscounts = 0n;
  for (const l of input.lines) {
    amount(l.grossMinor);
    if (l.lineDiscountMinor < 0n || l.lineDiscountMinor > l.grossMinor) throw new SaleMathError('INVALID_DISCOUNT', 'A line discount must fit its line');
    gross += l.grossMinor;
    lineDiscounts += l.lineDiscountMinor;
  }
  if (input.invoiceDiscountMinor < 0n) throw new SaleMathError('INVALID_DISCOUNT', 'A discount cannot be negative');
  if (input.invoiceDiscountMinor > gross - lineDiscounts) throw new SaleMathError('DISCOUNT_EXCEEDS_TOTAL', 'The discount is more than the lines add up to');
  const totalDiscountMinor = lineDiscounts + input.invoiceDiscountMinor;
  const basisPoints = gross === 0n ? 0 : Number((totalDiscountMinor * BASIS) / gross);
  return { grossMinor: gross, totalDiscountMinor, basisPoints };
}

export type ReturnLimit =
  | { ok: true; remainingBaseQty: bigint }
  | { ok: false; remainingBaseQty: bigint; reason: 'EXCEEDS_SOLD' | 'INVALID_QUANTITY' };

/** A return is limited to what was sold minus what already came back. */
export function returnLimits(input: { soldBaseQty: bigint; returnedBaseQty: bigint; requestedBaseQty: bigint }): ReturnLimit {
  const { soldBaseQty, returnedBaseQty, requestedBaseQty } = input;
  if (soldBaseQty < 1n || soldBaseQty > MAX_QTY || returnedBaseQty < 0n || returnedBaseQty > soldBaseQty || requestedBaseQty < 1n) {
    return { ok: false, remainingBaseQty: 0n, reason: 'INVALID_QUANTITY' };
  }
  const remainingBaseQty = soldBaseQty - returnedBaseQty;
  return requestedBaseQty > remainingBaseQty ? { ok: false, remainingBaseQty, reason: 'EXCEEDS_SOLD' } : { ok: true, remainingBaseQty };
}

/**
 * The refund for returning `returnBaseQty` units of a line: the line total (what was charged after discounts) pro rata,
 * on the cumulative quantity so no rounding drift builds up, and the return that completes the line refunds exactly what
 * is left. The refunds over any series of returns never exceed the line total and end equal to it.
 */
export function refundForReturn(input: {
  lineTotalMinor: bigint;
  lineBaseQty: bigint;
  returnBaseQty: bigint;
  alreadyReturnedBaseQty: bigint;
  alreadyRefundedMinor: bigint;
}): bigint {
  const { lineTotalMinor, lineBaseQty, returnBaseQty, alreadyReturnedBaseQty, alreadyRefundedMinor } = input;
  if (lineBaseQty < 1n || lineBaseQty > MAX_QTY || returnBaseQty < 1n || alreadyReturnedBaseQty < 0n || alreadyReturnedBaseQty + returnBaseQty > lineBaseQty) {
    throw new SaleMathError('INVALID_QUANTITY', 'The returned quantity does not fit the line');
  }
  amount(lineTotalMinor);
  if (alreadyRefundedMinor < 0n || alreadyRefundedMinor > lineTotalMinor) {
    throw new SaleMathError('INVALID_AMOUNT', 'The refund history does not fit the line total');
  }
  const returnedAfter = alreadyReturnedBaseQty + returnBaseQty;
  const target = returnedAfter === lineBaseQty ? lineTotalMinor : (lineTotalMinor * returnedAfter) / lineBaseQty;
  const refund = target - alreadyRefundedMinor;
  return refund > 0n ? refund : 0n;
}

/**
 * What one return refunds at sale level. A partial return refunds the sum of its line refunds, but never more than is
 * left of the sale total. The return that completes the sale (every line fully returned) refunds everything still
 * unrefunded, so the invoice rounding difference goes back too and the refunds over all returns equal `totalMinor`
 * (what was paid net of change) exactly, never above it at any step.
 */
export function saleRefundTotal(input: {
  totalMinor: bigint;
  alreadyRefundedMinor: bigint;
  isFinalReturn: boolean;
  lineRefundSumMinor: bigint;
  roundingMinor: bigint;
}): bigint {
  const { totalMinor, alreadyRefundedMinor, isFinalReturn, lineRefundSumMinor, roundingMinor } = input;
  amount(totalMinor);
  amount(lineRefundSumMinor);
  if (alreadyRefundedMinor < 0n || alreadyRefundedMinor > totalMinor) throw new SaleMathError('INVALID_AMOUNT', 'The refund history does not fit the sale total');
  const left = totalMinor - alreadyRefundedMinor;
  if (isFinalReturn) return left;
  // Without the rounding difference the lines add up to total - rounding; a partial return never goes past that.
  const lineCeiling = totalMinor - roundingMinor - alreadyRefundedMinor;
  const room = lineCeiling < left ? lineCeiling : left;
  const cap = room > 0n ? room : 0n;
  return lineRefundSumMinor < cap ? lineRefundSumMinor : cap;
}

/**
 * The cash that should be in the drawer when a shift closes: the opening float plus the cash tendered on sales, minus the
 * change given out and the cash refunds, plus paid in and minus paid out. Every component is a not-negative amount.
 */
export function expectedCash(input: {
  openingFloat: bigint;
  cashSales: bigint;
  cashChange: bigint;
  cashRefunds: bigint;
  paidIn: bigint;
  paidOut: bigint;
}): bigint {
  const { openingFloat, cashSales, cashChange, cashRefunds, paidIn, paidOut } = input;
  return amount(openingFloat) + amount(cashSales) - amount(cashChange) - amount(cashRefunds) + amount(paidIn) - amount(paidOut);
}

/** Counted minus expected: negative is a shortage, positive an excess. */
export function shiftVariance(counted: bigint, expected: bigint): bigint {
  return amount(counted) - expected;
}

/** `YYYYMMDD-000123`: the UTC day of the sale and its per-branch sequence (more than six digits when it needs them). */
export function saleNumber(dateISO: string, sequence: number): string {
  // A date alone, or a full timestamp with Z or an offset (a time without one is ambiguous and refused).
  const m = /^(\d{4})-(\d{2})-(\d{2})(T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(dateISO);
  const parsed = m ? new Date(m[4] ? dateISO : `${dateISO}T00:00:00.000Z`) : null;
  if (!m || !parsed || Number.isNaN(parsed.getTime())) throw new SaleMathError('INVALID_DATE', 'Not an ISO date');
  const day = parsed.toISOString().slice(0, 10);
  if (!m[4] && day !== dateISO) throw new SaleMathError('INVALID_DATE', 'Not a real calendar date');
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new SaleMathError('INVALID_SEQUENCE', 'The sequence starts at 1');
  return `${day.replaceAll('-', '')}-${String(sequence).padStart(6, '0')}`;
}

/** Is a sale still returnable without a manager? `now` is passed in; a sale stamped after `now` (clock skew) counts as inside. */
export function isWithinReturnWindow(soldAt: Date, now: Date, days: number): boolean {
  if (!Number.isInteger(days) || days < 0) throw new SaleMathError('INVALID_DAYS', 'The window is a whole number of days');
  if (Number.isNaN(soldAt.getTime()) || Number.isNaN(now.getTime())) throw new SaleMathError('INVALID_DATE', 'Invalid date');
  return now.getTime() - soldAt.getTime() <= days * 86_400_000;
}
