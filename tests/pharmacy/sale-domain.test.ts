import { describe, expect, it } from 'vitest';
import {
  SaleMathError,
  expectedCash,
  discountPolicy,
  effectiveDiscount,
  saleRefundTotal,
  MAX_QTY,
  invoiceDiscountAllocation,
  invoiceRounding,
  isWithinReturnWindow,
  lineDiscount,
  lineGross,
  MAX_AMOUNT_MINOR,
  paymentCheck,
  refundForReturn,
  returnLimits,
  saleNumber,
  shiftVariance,
} from '@/server/domain/pharmacy/sale';

const PG_MAX = 9223372036854775807n;

/** A small deterministic generator (mulberry32) so the property runs are reproducible. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** A BigInt in [0, max], biased to hit the extremes often. */
function pick(r: () => number, max: bigint): bigint {
  const x = r();
  if (x < 0.05) return 0n;
  if (x < 0.1) return max;
  if (x < 0.15) return max > 0n ? max - 1n : 0n;
  if (x < 0.2) return max > 0n ? 1n : 0n;
  const bits = Math.max(1, max.toString(2).length);
  let v = 0n;
  for (let i = 0; i < bits; i += 30) v = (v << 30n) | BigInt(Math.floor(r() * 2 ** 30));
  return v % (max + 1n);
}
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof SaleMathError ? e.code : `other:${String(e)}`;
  }
  return 'none';
};

describe('lineGross', () => {
  it('multiplies quantity by the unit price', () => {
    expect(lineGross(3n, 1250n)).toBe(3750n);
    expect(lineGross(1n, 0n)).toBe(0n);
  });
  it('refuses a quantity below 1 and a negative price', () => {
    expect(code(() => lineGross(0n, 10n))).toBe('INVALID_QUANTITY');
    expect(code(() => lineGross(-1n, 10n))).toBe('INVALID_QUANTITY');
    expect(code(() => lineGross(1n, -1n))).toBe('INVALID_PRICE');
  });
  it('allows exactly the sanity cap and refuses one minor unit above it', () => {
    expect(MAX_AMOUNT_MINOR).toBe(10n ** 15n);
    expect(lineGross(1n, MAX_AMOUNT_MINOR)).toBe(MAX_AMOUNT_MINOR);
    expect(code(() => lineGross(1n, MAX_AMOUNT_MINOR + 1n))).toBe('OVERFLOW');
    expect(code(() => lineGross(2n, MAX_AMOUNT_MINOR / 2n + 1n))).toBe('OVERFLOW');
  });
  it('refuses at the Postgres bigint maximum without wrapping', () => {
    expect(code(() => lineGross(PG_MAX, PG_MAX))).toBe('OVERFLOW');
    expect(code(() => lineGross(PG_MAX + 1n, 1n))).toBe('OVERFLOW');
    expect(MAX_QTY).toBe(2147483647n);
    expect(lineGross(MAX_QTY, 1n)).toBe(MAX_QTY);
    expect(code(() => lineGross(MAX_QTY + 1n, 1n))).toBe('OVERFLOW');
    expect(code(() => lineGross(1n, PG_MAX))).toBe('OVERFLOW');
  });
  it('property: result is exact or refused, never above the cap', () => {
    const r = rng(1);
    for (let i = 0; i < 500; i++) {
      const q = pick(r, MAX_QTY - 1n) + 1n;
      const p = pick(r, 10n ** 14n);
      const c = code(() => lineGross(q, p));
      if (q * p > MAX_AMOUNT_MINOR) expect(c).toBe('OVERFLOW');
      else expect(lineGross(q, p)).toBe(q * p);
    }
  });
});

describe('lineDiscount (rounds DOWN: the pharmacy never gives more than asked)', () => {
  it('amount discount is capped at the gross', () => {
    expect(lineDiscount(1000n, { kind: 'amount', value: 250n })).toBe(250n);
    expect(lineDiscount(1000n, { kind: 'amount', value: 5000n })).toBe(1000n);
    expect(lineDiscount(0n, { kind: 'amount', value: 5n })).toBe(0n);
  });
  it('percent is in basis points and floors', () => {
    expect(lineDiscount(1000n, { kind: 'percent', value: 500 })).toBe(50n);
    expect(lineDiscount(999n, { kind: 'percent', value: 500 })).toBe(49n); // 49.95 -> 49
    expect(lineDiscount(1n, { kind: 'percent', value: 9999 })).toBe(0n);
    expect(lineDiscount(1000n, { kind: 'percent', value: 10000 })).toBe(1000n);
    expect(lineDiscount(1000n, { kind: 'percent', value: 0 })).toBe(0n);
  });
  it('refuses a percent outside 0..10000, a fractional percent and a negative amount', () => {
    expect(code(() => lineDiscount(10n, { kind: 'percent', value: -1 }))).toBe('INVALID_DISCOUNT');
    expect(code(() => lineDiscount(10n, { kind: 'percent', value: 10001 }))).toBe('INVALID_DISCOUNT');
    expect(code(() => lineDiscount(10n, { kind: 'percent', value: 1.5 }))).toBe('INVALID_DISCOUNT');
    expect(code(() => lineDiscount(10n, { kind: 'amount', value: -1n }))).toBe('INVALID_DISCOUNT');
    expect(code(() => lineDiscount(-1n, { kind: 'amount', value: 1n }))).toBe('INVALID_AMOUNT');
  });
  it('property: never above the exact percentage, never above gross, never negative', () => {
    const r = rng(2);
    for (let i = 0; i < 500; i++) {
      const gross = pick(r, MAX_AMOUNT_MINOR);
      const bp = Number(pick(r, 10000n));
      const d = lineDiscount(gross, { kind: 'percent', value: bp });
      expect(d >= 0n && d <= gross).toBe(true);
      expect(d * 10000n <= gross * BigInt(bp)).toBe(true);
      expect((d + 1n) * 10000n > gross * BigInt(bp)).toBe(true);
      const a = pick(r, MAX_AMOUNT_MINOR * 2n);
      const da = lineDiscount(gross, { kind: 'amount', value: a });
      expect(da).toBe(a < gross ? a : gross);
    }
  });
});

describe('invoiceDiscountAllocation (largest remainder)', () => {
  const lines = (...t: bigint[]) => t.map((totalMinor) => ({ totalMinor }));
  const sum = (a: readonly bigint[]) => a.reduce((s, x) => s + x, 0n);
  it('splits proportionally and sums exactly', () => {
    expect(invoiceDiscountAllocation(lines(1000n, 1000n, 1000n), 100n)).toEqual([34n, 33n, 33n]);
    expect(invoiceDiscountAllocation(lines(1000n, 3000n), 400n)).toEqual([100n, 300n]);
  });
  it('breaks ties by line index and is deterministic', () => {
    const a = invoiceDiscountAllocation(lines(10n, 10n, 10n, 10n), 2n);
    expect(a).toEqual([1n, 1n, 0n, 0n]);
    expect(invoiceDiscountAllocation(lines(10n, 10n, 10n, 10n), 2n)).toEqual(a);
  });
  it('zero discount, zero-total lines and an empty list', () => {
    expect(invoiceDiscountAllocation(lines(5n, 0n), 0n)).toEqual([0n, 0n]);
    expect(invoiceDiscountAllocation(lines(0n, 7n), 3n)).toEqual([0n, 3n]);
    expect(invoiceDiscountAllocation([], 0n)).toEqual([]);
  });
  it('refuses a discount above the lines total, a negative discount and negative lines', () => {
    expect(code(() => invoiceDiscountAllocation(lines(5n, 5n), 11n))).toBe('DISCOUNT_EXCEEDS_TOTAL');
    expect(code(() => invoiceDiscountAllocation([], 1n))).toBe('DISCOUNT_EXCEEDS_TOTAL');
    expect(code(() => invoiceDiscountAllocation(lines(5n), -1n))).toBe('INVALID_DISCOUNT');
    expect(code(() => invoiceDiscountAllocation(lines(-5n), 0n))).toBe('INVALID_AMOUNT');
  });
  it('a full discount takes every line to exactly zero', () => {
    expect(invoiceDiscountAllocation(lines(7n, 11n, 13n), 31n)).toEqual([7n, 11n, 13n]);
  });
  it('property: parts sum exactly, never exceed a line, within 1 of the exact share, no negative', () => {
    const r = rng(3);
    for (let i = 0; i < 400; i++) {
      const n = 1 + Math.floor(r() * 8);
      const ls = Array.from({ length: n }, () => pick(r, MAX_AMOUNT_MINOR / 8n));
      const total = sum(ls);
      const discount = pick(r, total);
      const parts = invoiceDiscountAllocation(lines(...ls), discount);
      expect(sum(parts)).toBe(discount);
      parts.forEach((p, k) => {
        expect(p >= 0n && p <= ls[k]!).toBe(true);
        if (total > 0n) {
          const exactFloor = (discount * ls[k]!) / total;
          expect(p === exactFloor || p === exactFloor + 1n).toBe(true);
        }
      });
    }
  });
});

describe('invoiceRounding', () => {
  it('step 0 means no rounding', () => {
    expect(invoiceRounding(1234n, 0, 'IQD')).toEqual({ roundedMinor: 1234n, roundingMinor: 0n });
  });
  it('rounds to the nearest step, ties up, with a signed difference', () => {
    expect(invoiceRounding(1237n, 250, 'IQD')).toEqual({ roundedMinor: 1250n, roundingMinor: 13n });
    expect(invoiceRounding(1120n, 250, 'IQD')).toEqual({ roundedMinor: 1000n, roundingMinor: -120n });
    expect(invoiceRounding(1125n, 250, 'IQD')).toEqual({ roundedMinor: 1250n, roundingMinor: 125n }); // tie goes up
    expect(invoiceRounding(1124n, 250, 'IQD')).toEqual({ roundedMinor: 1000n, roundingMinor: -124n });
    expect(invoiceRounding(10n, 25, 'IQD')).toEqual({ roundedMinor: 0n, roundingMinor: -10n });
    expect(invoiceRounding(0n, 1000, 'IQD')).toEqual({ roundedMinor: 0n, roundingMinor: 0n });
  });
  it('never rounds USD: a non-zero step with USD is refused, step 0 is fine', () => {
    expect(code(() => invoiceRounding(1234n, 25, 'USD'))).toBe('ROUNDING_NOT_FOR_CURRENCY');
    expect(invoiceRounding(1234n, 0, 'USD')).toEqual({ roundedMinor: 1234n, roundingMinor: 0n });
  });
  it('refuses steps outside the allowed set and a negative total', () => {
    for (const s of [1, 10, 100, 249, 2500, -25, 25.5]) expect(code(() => invoiceRounding(100n, s, 'IQD'))).toBe('INVALID_ROUNDING_STEP');
    expect(code(() => invoiceRounding(-1n, 25, 'IQD'))).toBe('INVALID_AMOUNT');
  });
  it('property: on a step, within half a step, idempotent, never negative, fine at the cap', () => {
    const r = rng(4);
    for (const step of [0, 25, 50, 250, 500, 1000, 5000]) {
      for (let i = 0; i < 200; i++) {
        const t = pick(r, MAX_AMOUNT_MINOR);
        const { roundedMinor, roundingMinor } = invoiceRounding(t, step, 'IQD');
        expect(roundedMinor).toBe(t + roundingMinor);
        expect(roundedMinor >= 0n).toBe(true);
        if (step > 0) {
          const s = BigInt(step);
          expect(roundedMinor % s).toBe(0n);
          expect(2n * (roundingMinor < 0n ? -roundingMinor : roundingMinor) <= s).toBe(true);
        }
        expect(invoiceRounding(roundedMinor, step, 'IQD')).toEqual({ roundedMinor, roundingMinor: 0n });
      }
    }
  });
});

describe('paymentCheck', () => {
  const cash = (amountMinor: bigint) => ({ method: 'CASH' as const, amountMinor });
  const card = (amountMinor: bigint) => ({ method: 'CARD_MANUAL' as const, amountMinor });
  const xfer = (amountMinor: bigint) => ({ method: 'TRANSFER_MANUAL' as const, amountMinor });
  it('exact payment has no change', () => {
    expect(paymentCheck({ totalMinor: 1000n, payments: [cash(1000n)] })).toEqual({ ok: true, paidMinor: 1000n, changeMinor: 0n });
  });
  it('cash may overpay and the change is the overpay', () => {
    expect(paymentCheck({ totalMinor: 1000n, payments: [cash(1500n)] })).toEqual({ ok: true, paidMinor: 1500n, changeMinor: 500n });
    expect(paymentCheck({ totalMinor: 1000n, payments: [card(400n), cash(1000n)] })).toEqual({ ok: true, paidMinor: 1400n, changeMinor: 400n });
  });
  it('non-cash must not overpay, even when cash is also given', () => {
    expect(paymentCheck({ totalMinor: 1000n, payments: [card(1001n)] })).toMatchObject({ ok: false, reason: 'NON_CASH_OVERPAY', changeMinor: 0n });
    expect(paymentCheck({ totalMinor: 1000n, payments: [card(600n), xfer(500n), cash(100n)] })).toMatchObject({ ok: false, reason: 'NON_CASH_OVERPAY' });
    expect(paymentCheck({ totalMinor: 1000n, payments: [card(600n), xfer(400n)] })).toEqual({ ok: true, paidMinor: 1000n, changeMinor: 0n });
  });
  it('refuses a short payment, a non-positive amount and an unknown method', () => {
    expect(paymentCheck({ totalMinor: 1000n, payments: [cash(999n)] })).toMatchObject({ ok: false, reason: 'SHORT' });
    expect(paymentCheck({ totalMinor: 1000n, payments: [] })).toMatchObject({ ok: false, reason: 'SHORT' });
    expect(paymentCheck({ totalMinor: 1000n, payments: [cash(0n), cash(1000n)] })).toMatchObject({ ok: false, reason: 'INVALID_PAYMENT' });
    expect(paymentCheck({ totalMinor: 1000n, payments: [cash(-5n), cash(1005n)] })).toMatchObject({ ok: false, reason: 'INVALID_PAYMENT' });
    expect(paymentCheck({ totalMinor: 1000n, payments: [{ method: 'BITCOIN' as never, amountMinor: 1000n }] })).toMatchObject({ ok: false, reason: 'INVALID_PAYMENT' });
  });
  it('refuses cash when non-cash already covers the total', () => {
    expect(paymentCheck({ totalMinor: 1000n, payments: [card(1000n), cash(100n)] })).toMatchObject({ ok: false, reason: 'CASH_NOT_NEEDED', changeMinor: 0n });
    expect(paymentCheck({ totalMinor: 0n, payments: [cash(100n)] })).toMatchObject({ ok: false, reason: 'CASH_NOT_NEEDED' });
  });
  it('caps each payment and the sum at the amount cap', () => {
    expect(paymentCheck({ totalMinor: 1000n, payments: [cash(MAX_AMOUNT_MINOR)] })).toMatchObject({ ok: true });
    expect(paymentCheck({ totalMinor: 1000n, payments: [cash(MAX_AMOUNT_MINOR + 1n)] })).toMatchObject({ ok: false, reason: 'INVALID_PAYMENT' });
    expect(paymentCheck({ totalMinor: 1000n, payments: [cash(MAX_AMOUNT_MINOR), cash(1n)] })).toMatchObject({ ok: false, reason: 'INVALID_PAYMENT' });
  });
  it('a zero total needs no payment', () => {
    expect(paymentCheck({ totalMinor: 0n, payments: [] })).toEqual({ ok: true, paidMinor: 0n, changeMinor: 0n });
  });
  it('property: ok implies change >= 0 and change <= cash, paid = total + change', () => {
    const r = rng(5);
    const methods = ['CASH', 'CARD_MANUAL', 'TRANSFER_MANUAL'] as const;
    for (let i = 0; i < 800; i++) {
      const total = pick(r, MAX_AMOUNT_MINOR);
      const n = Math.floor(r() * 4);
      const payments = Array.from({ length: n }, () => ({ method: methods[Math.floor(r() * 3)]!, amountMinor: pick(r, total + 1000n) }));
      const res = paymentCheck({ totalMinor: total, payments });
      if (res.ok) {
        const cashSum = payments.filter((p) => p.method === 'CASH').reduce((s, p) => s + p.amountMinor, 0n);
        expect(res.changeMinor >= 0n && res.changeMinor <= cashSum).toBe(true);
        expect(res.paidMinor).toBe(total + res.changeMinor);
      } else {
        expect(res.changeMinor).toBe(0n);
      }
    }
  });
});

describe('discountPolicy (exact integer comparison)', () => {
  const base = { grossMinor: 10000n, maxPercentBp: 500, canApply: true, canOverLimit: false };
  it('no discount is always ok', () => {
    expect(discountPolicy({ ...base, discountMinor: 0n, canApply: false })).toBe('ok');
  });
  it('up to the limit is ok for a holder of discount.apply, exactly at the limit included', () => {
    expect(discountPolicy({ ...base, discountMinor: 500n })).toBe('ok');
    expect(discountPolicy({ ...base, discountMinor: 1n })).toBe('ok');
  });
  it('one minor unit over the limit needs the over-limit permission, or is forbidden without it', () => {
    expect(discountPolicy({ ...base, discountMinor: 501n })).toBe('forbidden');
    expect(discountPolicy({ ...base, discountMinor: 501n, canOverLimit: true })).toBe('needs_over_limit');
  });
  it('without discount.apply any discount is forbidden', () => {
    expect(discountPolicy({ ...base, discountMinor: 1n, canApply: false, canOverLimit: true })).toBe('forbidden');
  });
  it('a discount on a zero gross is over the limit, with no division and no float', () => {
    expect(discountPolicy({ ...base, grossMinor: 0n, discountMinor: 1n, canOverLimit: true })).toBe('needs_over_limit');
  });
  it('is exact at huge values where a float would round', () => {
    const gross = MAX_AMOUNT_MINOR - 1n;
    const limit = (gross * 500n) / 10000n;
    expect(discountPolicy({ ...base, grossMinor: gross, discountMinor: limit })).toBe('ok');
    expect(discountPolicy({ ...base, grossMinor: gross, discountMinor: limit + 1n })).toBe('forbidden');
  });
  it('refuses a bad limit', () => {
    expect(code(() => discountPolicy({ ...base, discountMinor: 1n, maxPercentBp: -1 }))).toBe('INVALID_DISCOUNT');
    expect(code(() => discountPolicy({ ...base, discountMinor: 1n, maxPercentBp: 10001 }))).toBe('INVALID_DISCOUNT');
    expect(code(() => discountPolicy({ ...base, discountMinor: 1n, maxPercentBp: 5.5 }))).toBe('INVALID_DISCOUNT');
  });
});

describe('effectiveDiscount: line and invoice discounts judged together', () => {
  const lines = [{ grossMinor: 6000n, lineDiscountMinor: 300n }, { grossMinor: 4000n, lineDiscountMinor: 200n }]; // 5% on each line
  const policy = (discountMinor: bigint, grossMinor: bigint, canOverLimit = false) =>
    discountPolicy({ discountMinor, grossMinor, maxPercentBp: 500, canApply: true, canOverLimit });
  it('5% on the lines plus 5% on the invoice is judged as the combined figure', () => {
    const e = effectiveDiscount({ lines, invoiceDiscountMinor: 475n }); // 5% of the 9500 left
    expect(e).toEqual({ grossMinor: 10000n, totalDiscountMinor: 975n, basisPoints: 975 });
    expect(policy(500n, 10000n)).toBe('ok'); // each half alone is within 5%
    expect(policy(e.totalDiscountMinor, e.grossMinor)).toBe('forbidden');
    expect(policy(e.totalDiscountMinor, e.grossMinor, true)).toBe('needs_over_limit');
  });
  it('is exact at the boundary and handles an empty or zero-gross sale', () => {
    const e = effectiveDiscount({ lines, invoiceDiscountMinor: 0n });
    expect(e.totalDiscountMinor).toBe(500n);
    expect(policy(e.totalDiscountMinor, e.grossMinor)).toBe('ok');
    expect(effectiveDiscount({ lines: [], invoiceDiscountMinor: 0n })).toEqual({ grossMinor: 0n, totalDiscountMinor: 0n, basisPoints: 0 });
  });
  it('refuses a line discount above its gross and an invoice discount above what is left', () => {
    expect(code(() => effectiveDiscount({ lines: [{ grossMinor: 10n, lineDiscountMinor: 11n }], invoiceDiscountMinor: 0n }))).toBe('INVALID_DISCOUNT');
    expect(code(() => effectiveDiscount({ lines, invoiceDiscountMinor: 9501n }))).toBe('DISCOUNT_EXCEEDS_TOTAL');
    expect(code(() => effectiveDiscount({ lines, invoiceDiscountMinor: -1n }))).toBe('INVALID_DISCOUNT');
  });
  it('a 100% discount sale: total 0, no payment needed, payment check ok', () => {
    const gross = lineGross(2n, 1250n);
    const ld = lineDiscount(gross, { kind: 'percent', value: 10000 });
    expect(ld).toBe(gross);
    expect(invoiceDiscountAllocation([{ totalMinor: gross - ld }], 0n)).toEqual([0n]);
    const { roundedMinor } = invoiceRounding(0n, 250, 'IQD');
    expect(roundedMinor).toBe(0n);
    expect(paymentCheck({ totalMinor: roundedMinor, payments: [] })).toEqual({ ok: true, paidMinor: 0n, changeMinor: 0n });
  });
});

describe('returnLimits', () => {
  it('allows up to what is left', () => {
    expect(returnLimits({ soldBaseQty: 10n, returnedBaseQty: 3n, requestedBaseQty: 7n })).toEqual({ ok: true, remainingBaseQty: 7n });
    expect(returnLimits({ soldBaseQty: 10n, returnedBaseQty: 3n, requestedBaseQty: 1n })).toEqual({ ok: true, remainingBaseQty: 7n });
  });
  it('refuses a quantity above the 32-bit cap', () => {
    expect(returnLimits({ soldBaseQty: MAX_QTY + 1n, returnedBaseQty: 0n, requestedBaseQty: 1n })).toMatchObject({ ok: false, reason: 'INVALID_QUANTITY' });
  });
  it('refuses more than is left, nothing, and inconsistent history', () => {
    expect(returnLimits({ soldBaseQty: 10n, returnedBaseQty: 3n, requestedBaseQty: 8n })).toEqual({ ok: false, remainingBaseQty: 7n, reason: 'EXCEEDS_SOLD' });
    expect(returnLimits({ soldBaseQty: 10n, returnedBaseQty: 10n, requestedBaseQty: 1n })).toMatchObject({ ok: false, reason: 'EXCEEDS_SOLD', remainingBaseQty: 0n });
    expect(returnLimits({ soldBaseQty: 10n, returnedBaseQty: 0n, requestedBaseQty: 0n })).toMatchObject({ ok: false, reason: 'INVALID_QUANTITY' });
    expect(returnLimits({ soldBaseQty: 10n, returnedBaseQty: 11n, requestedBaseQty: 1n })).toMatchObject({ ok: false, reason: 'INVALID_QUANTITY' });
  });
});

describe('refundForReturn', () => {
  const refund = (lineTotalMinor: bigint, lineBaseQty: bigint, returnBaseQty: bigint, alreadyReturnedBaseQty: bigint, alreadyRefundedMinor: bigint) =>
    refundForReturn({ lineTotalMinor, lineBaseQty, returnBaseQty, alreadyReturnedBaseQty, alreadyRefundedMinor });
  it('is proportional, and the last unit refunds the remainder', () => {
    expect(refund(100n, 3n, 1n, 0n, 0n)).toBe(33n);
    expect(refund(100n, 3n, 1n, 1n, 33n)).toBe(33n); // cumulative floor(200/3)=66
    expect(refund(100n, 3n, 1n, 2n, 66n)).toBe(34n); // last one
  });
  it('a full return in one go refunds the whole line; a zero-total line refunds zero', () => {
    expect(refund(100n, 3n, 3n, 0n, 0n)).toBe(100n);
    expect(refund(0n, 3n, 1n, 0n, 0n)).toBe(0n);
  });
  it('refuses a quantity beyond the line or a refund history above the total', () => {
    expect(code(() => refund(100n, 3n, 2n, 2n, 66n))).toBe('INVALID_QUANTITY');
    expect(code(() => refund(100n, 3n, 0n, 0n, 0n))).toBe('INVALID_QUANTITY');
    expect(code(() => refund(100n, 0n, 1n, 0n, 0n))).toBe('INVALID_QUANTITY');
    expect(code(() => refund(100n, 3n, 1n, 0n, 101n))).toBe('INVALID_AMOUNT');
  });
  it('property: any split of returns refunds <= total at every step and exactly the total at the end', () => {
    const r = rng(6);
    for (let i = 0; i < 300; i++) {
      const total = pick(r, MAX_AMOUNT_MINOR);
      const qty = 1n + pick(r, 40n);
      let returned = 0n;
      let refunded = 0n;
      while (returned < qty) {
        const left = qty - returned;
        const take = 1n + pick(r, left - 1n);
        const part = refund(total, qty, take, returned, refunded);
        expect(part >= 0n).toBe(true);
        refunded += part;
        returned += take;
        expect(refunded <= total).toBe(true);
      }
      expect(refunded).toBe(total);
    }
  });
});

describe('saleRefundTotal (rounding comes back with the final return)', () => {
  it('a partial return refunds its lines; the final one refunds what is left including the rounding difference', () => {
    // Lines add up to 1237, rounded up to 1250 (rounding +13).
    expect(saleRefundTotal({ totalMinor: 1250n, alreadyRefundedMinor: 0n, isFinalReturn: false, lineRefundSumMinor: 600n, roundingMinor: 13n })).toBe(600n);
    expect(saleRefundTotal({ totalMinor: 1250n, alreadyRefundedMinor: 600n, isFinalReturn: true, lineRefundSumMinor: 637n, roundingMinor: 13n })).toBe(650n);
  });
  it('rounded down: the final return refunds less than its lines', () => {
    expect(saleRefundTotal({ totalMinor: 1000n, alreadyRefundedMinor: 400n, isFinalReturn: true, lineRefundSumMinor: 720n, roundingMinor: -120n })).toBe(600n);
  });
  it('a partial return never refunds above what is left of the sale', () => {
    expect(saleRefundTotal({ totalMinor: 1000n, alreadyRefundedMinor: 900n, isFinalReturn: false, lineRefundSumMinor: 500n, roundingMinor: 0n })).toBe(100n);
    expect(saleRefundTotal({ totalMinor: 1000n, alreadyRefundedMinor: 0n, isFinalReturn: false, lineRefundSumMinor: 1120n, roundingMinor: -120n })).toBe(1000n);
  });
  it('refuses a history above the total', () => {
    expect(code(() => saleRefundTotal({ totalMinor: 10n, alreadyRefundedMinor: 11n, isFinalReturn: true, lineRefundSumMinor: 0n, roundingMinor: 0n }))).toBe('INVALID_AMOUNT');
  });
  it('property: any partial sequence ending in a full return refunds exactly the total, never above at any step', () => {
    const r = rng(7);
    const steps = [0, 25, 50, 250, 500, 1000, 5000];
    for (let i = 0; i < 300; i++) {
      const n = 1 + Math.floor(r() * 5);
      const lns = Array.from({ length: n }, () => ({ total: pick(r, MAX_AMOUNT_MINOR / 10n), qty: 1n + pick(r, 12n), returned: 0n, refunded: 0n }));
      const lineSum = lns.reduce((s, l) => s + l.total, 0n);
      const { roundedMinor, roundingMinor } = invoiceRounding(lineSum, steps[Math.floor(r() * steps.length)]!, 'IQD');
      let refunded = 0n;
      for (;;) {
        const open = lns.filter((l) => l.returned < l.qty);
        if (open.length === 0) break;
        let lineRefundSum = 0n;
        for (const l of open) {
          if (r() < 0.5 && open.length > 1) continue;
          const take = 1n + pick(r, l.qty - l.returned - 1n);
          const part = refundForReturn({ lineTotalMinor: l.total, lineBaseQty: l.qty, returnBaseQty: take, alreadyReturnedBaseQty: l.returned, alreadyRefundedMinor: l.refunded });
          l.returned += take;
          l.refunded += part;
          lineRefundSum += part;
        }
        const isFinalReturn = lns.every((l) => l.returned === l.qty);
        const part = saleRefundTotal({ totalMinor: roundedMinor, alreadyRefundedMinor: refunded, isFinalReturn, lineRefundSumMinor: lineRefundSum, roundingMinor });
        expect(part >= 0n).toBe(true);
        refunded += part;
        expect(refunded <= roundedMinor).toBe(true);
      }
      expect(refunded).toBe(roundedMinor);
    }
  });
});

describe('expectedCash and shiftVariance', () => {
  it('opening + cash sales - change - refunds + paid in - paid out', () => {
    expect(expectedCash({ openingFloat: 10000n, cashSales: 50000n, cashChange: 2000n, cashRefunds: 3000n, paidIn: 500n, paidOut: 1500n })).toBe(54000n);
  });
  it('can be reached with only a float', () => {
    expect(expectedCash({ openingFloat: 7n, cashSales: 0n, cashChange: 0n, cashRefunds: 0n, paidIn: 0n, paidOut: 0n })).toBe(7n);
  });
  it('refuses a negative component', () => {
    expect(code(() => expectedCash({ openingFloat: -1n, cashSales: 0n, cashChange: 0n, cashRefunds: 0n, paidIn: 0n, paidOut: 0n }))).toBe('INVALID_AMOUNT');
  });
  it('variance is counted - expected, signed', () => {
    expect(shiftVariance(54000n, 54000n)).toBe(0n);
    expect(shiftVariance(53000n, 54000n)).toBe(-1000n);
    expect(shiftVariance(54250n, 54000n)).toBe(250n);
    expect(code(() => shiftVariance(-1n, 0n))).toBe('INVALID_AMOUNT');
  });
});

describe('saleNumber', () => {
  it('is YYYYMMDD-000123 from the UTC date', () => {
    expect(saleNumber('2026-10-28', 123)).toBe('20261028-000123');
    expect(saleNumber('2026-10-28T23:59:59.000Z', 1)).toBe('20261028-000001');
    expect(saleNumber('2026-01-02', 999999)).toBe('20260102-999999');
  });
  it('converts an offset timestamp to its UTC day', () => {
    expect(saleNumber('2026-10-28T23:30:00-02:00', 5)).toBe('20261029-000005');
  });
  it('keeps going past six digits instead of wrapping', () => {
    expect(saleNumber('2026-10-28', 1234567)).toBe('20261028-1234567');
  });
  it('refuses a bad date or sequence', () => {
    expect(code(() => saleNumber('28/10/2026', 1))).toBe('INVALID_DATE');
    expect(code(() => saleNumber('2026-13-40', 1))).toBe('INVALID_DATE');
    expect(code(() => saleNumber('2026-02-30', 1))).toBe('INVALID_DATE');
    expect(code(() => saleNumber('2026-10-28T10:00:00', 1))).toBe('INVALID_DATE'); // a time without Z or an offset is ambiguous
    expect(code(() => saleNumber('2026-10-28', 0))).toBe('INVALID_SEQUENCE');
    expect(code(() => saleNumber('2026-10-28', 1.5))).toBe('INVALID_SEQUENCE');
  });
});

describe('isWithinReturnWindow', () => {
  const now = new Date('2026-10-28T12:00:00.000Z');
  it('inside, exactly on and just past the window', () => {
    expect(isWithinReturnWindow(new Date('2026-10-01T12:00:00.000Z'), now, 30)).toBe(true);
    expect(isWithinReturnWindow(new Date('2026-09-28T12:00:00.000Z'), now, 30)).toBe(true); // exactly 30 days
    expect(isWithinReturnWindow(new Date('2026-09-28T11:59:59.999Z'), now, 30)).toBe(false);
  });
  it('a sale stamped in the future (clock skew) is inside; 0 days only allows the same instant', () => {
    expect(isWithinReturnWindow(new Date('2026-10-28T12:00:01.000Z'), now, 30)).toBe(true);
    expect(isWithinReturnWindow(now, now, 0)).toBe(true);
    expect(isWithinReturnWindow(new Date('2026-10-28T11:59:59.999Z'), now, 0)).toBe(false);
  });
  it('refuses a negative or fractional window and invalid dates', () => {
    expect(code(() => isWithinReturnWindow(now, now, -1))).toBe('INVALID_DAYS');
    expect(code(() => isWithinReturnWindow(now, now, 1.5))).toBe('INVALID_DAYS');
    expect(code(() => isWithinReturnWindow(new Date('x'), now, 30))).toBe('INVALID_DATE');
  });
});
