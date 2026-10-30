import { describe, expect, it } from 'vitest';
import { ageingBuckets, ageDays, creditCheck, splitRefund } from '@/server/domain/pharmacy/credit';

const base = { customerCurrency: 'IQD', saleCurrency: 'IQD', active: true } as const;

describe('creditCheck: the limit', () => {
  it('allows a charge that lands exactly on the limit (balance 40 000 + 60 000 = limit 100 000)', () => {
    expect(creditCheck({ ...base, balanceMinor: 40_000n, limitMinor: 100_000n, chargeMinor: 60_000n })).toEqual({ ok: true, newBalanceMinor: 100_000n });
  });

  it('refuses one minor unit above the limit and says how much room is left', () => {
    expect(creditCheck({ ...base, balanceMinor: 40_000n, limitMinor: 100_000n, chargeMinor: 60_001n })).toEqual({ ok: false, reason: 'LIMIT_EXCEEDED', availableMinor: 60_000n });
  });

  it('a limit of 0 allows no credit at all', () => {
    expect(creditCheck({ ...base, balanceMinor: 0n, limitMinor: 0n, chargeMinor: 1n })).toEqual({ ok: false, reason: 'LIMIT_EXCEEDED', availableMinor: 0n });
  });

  it('a customer who overpaid (balance -5 000) has the overpayment as extra room: -5 000 + 105 000 = 100 000 is allowed', () => {
    expect(creditCheck({ ...base, balanceMinor: -5_000n, limitMinor: 100_000n, chargeMinor: 105_000n })).toEqual({ ok: true, newBalanceMinor: 100_000n });
    expect(creditCheck({ ...base, balanceMinor: -5_000n, limitMinor: 100_000n, chargeMinor: 105_001n }).ok).toBe(false);
  });

  it('a customer already above the limit (it was lowered) has no room, never a negative room', () => {
    expect(creditCheck({ ...base, balanceMinor: 150_000n, limitMinor: 100_000n, chargeMinor: 1n })).toEqual({ ok: false, reason: 'LIMIT_EXCEEDED', availableMinor: 0n });
  });

  it('refuses a charge of zero or less', () => {
    expect(creditCheck({ ...base, balanceMinor: 0n, limitMinor: 10n, chargeMinor: 0n })).toMatchObject({ ok: false, reason: 'INVALID_AMOUNT' });
    expect(creditCheck({ ...base, balanceMinor: 0n, limitMinor: 10n, chargeMinor: -1n })).toMatchObject({ ok: false, reason: 'INVALID_AMOUNT' });
  });
});

describe('creditCheck: one currency, an active customer', () => {
  it('refuses a customer in another currency than the sale, never converting', () => {
    expect(creditCheck({ customerCurrency: 'USD', saleCurrency: 'IQD', active: true, balanceMinor: 0n, limitMinor: 1_000_000n, chargeMinor: 100n })).toMatchObject({ ok: false, reason: 'CURRENCY_MISMATCH' });
  });

  it('refuses an archived customer', () => {
    expect(creditCheck({ ...base, active: false, balanceMinor: 0n, limitMinor: 1_000n, chargeMinor: 1n })).toMatchObject({ ok: false, reason: 'CUSTOMER_INACTIVE' });
  });

  it('judges the currency before the limit', () => {
    expect(creditCheck({ customerCurrency: 'USD', saleCurrency: 'IQD', active: true, balanceMinor: 0n, limitMinor: 0n, chargeMinor: 100n })).toMatchObject({ reason: 'CURRENCY_MISMATCH' });
  });
});

describe('splitRefund: a refund of a credit sale lowers the debt first', () => {
  it('sale of 100 000 on credit, nothing paid yet, refund 30 000: all 30 000 goes to the balance, nothing is handed back', () => {
    expect(splitRefund({ refundMinor: 30_000n, saleCreditLeftMinor: 100_000n, balanceMinor: 100_000n })).toEqual({ creditMinor: 30_000n, restMinor: 0n });
  });

  it('sale = 60 000 cash + 40 000 credit, refund of everything 100 000: 40 000 off the debt, 60 000 back by the original method', () => {
    expect(splitRefund({ refundMinor: 100_000n, saleCreditLeftMinor: 40_000n, balanceMinor: 40_000n })).toEqual({ creditMinor: 40_000n, restMinor: 60_000n });
  });

  it('the customer already paid 25 000 of the 40 000: only the 15 000 still owed comes off, 85 000 goes back', () => {
    expect(splitRefund({ refundMinor: 100_000n, saleCreditLeftMinor: 40_000n, balanceMinor: 15_000n })).toEqual({ creditMinor: 15_000n, restMinor: 85_000n });
  });

  it('a customer who owes nothing (or is in credit) gets the whole refund back, the balance never goes negative from a refund', () => {
    expect(splitRefund({ refundMinor: 10_000n, saleCreditLeftMinor: 10_000n, balanceMinor: 0n })).toEqual({ creditMinor: 0n, restMinor: 10_000n });
    expect(splitRefund({ refundMinor: 10_000n, saleCreditLeftMinor: 10_000n, balanceMinor: -3_000n })).toEqual({ creditMinor: 0n, restMinor: 10_000n });
  });

  it('a sale that took no credit refunds as before', () => {
    expect(splitRefund({ refundMinor: 10_000n, saleCreditLeftMinor: 0n, balanceMinor: 99_000n })).toEqual({ creditMinor: 0n, restMinor: 10_000n });
  });

  it('refuses a negative figure', () => {
    expect(() => splitRefund({ refundMinor: -1n, saleCreditLeftMinor: 0n, balanceMinor: 0n })).toThrow();
  });
});

describe('ageDays', () => {
  it('counts calendar days between two YYYY-MM-DD days, never negative', () => {
    expect(ageDays('2026-10-01', '2026-10-31')).toBe(30);
    expect(ageDays('2026-10-31', '2026-10-01')).toBe(0);
    expect(ageDays('2026-02-28', '2026-03-01')).toBe(1);
  });
});

describe('ageingBuckets: charge dates, payments applied oldest first', () => {
  const asOf = '2026-10-31';
  const zero = { '0-30': 0n, '31-60': 0n, '61-90': 0n, '90+': 0n };

  it('puts each charge in the bucket of its age: 0, 30 | 31, 60 | 61, 90 | 91 days', () => {
    const entries = [
      { day: '2026-10-31', amountMinor: 1n }, // 0
      { day: '2026-10-01', amountMinor: 2n }, // 30
      { day: '2026-09-30', amountMinor: 4n }, // 31
      { day: '2026-09-01', amountMinor: 8n }, // 60
      { day: '2026-08-31', amountMinor: 16n }, // 61
      { day: '2026-08-02', amountMinor: 32n }, // 90
      { day: '2026-08-01', amountMinor: 64n }, // 91
    ];
    expect(ageingBuckets(entries, asOf)).toEqual({ buckets: { '0-30': 3n, '31-60': 12n, '61-90': 48n, '90+': 64n }, owedMinor: 127n, unappliedMinor: 0n });
  });

  it('a payment settles the oldest charge first: charges 50 000 (100 days) + 30 000 (40 days) + 20 000 (5 days), paid 60 000 leaves 20 000 of the 40-day one and 20 000 of the 5-day one', () => {
    const entries = [
      { day: '2026-07-23', amountMinor: 50_000n },
      { day: '2026-09-21', amountMinor: 30_000n },
      { day: '2026-10-26', amountMinor: 20_000n },
      { day: '2026-10-28', amountMinor: -60_000n },
    ];
    const r = ageingBuckets(entries, asOf);
    // 60 000 paid: 50 000 clears the 100-day charge, 10 000 more reduces the 40-day one to 20 000.
    expect(r.buckets).toEqual({ ...zero, '0-30': 20_000n, '31-60': 20_000n });
    expect(r.owedMinor).toBe(40_000n);
    expect(r.unappliedMinor).toBe(0n);
  });

  it('is the same whatever order the entries come in, and the buckets always add up to what is owed', () => {
    const entries = [
      { day: '2026-10-28', amountMinor: -60_000n },
      { day: '2026-10-26', amountMinor: 20_000n },
      { day: '2026-07-23', amountMinor: 50_000n },
      { day: '2026-09-21', amountMinor: 30_000n },
    ];
    const r = ageingBuckets(entries, asOf);
    const sum = Object.values(r.buckets).reduce((a, b) => a + b, 0n);
    expect(sum).toBe(r.owedMinor);
    expect(r.buckets).toEqual({ ...zero, '0-30': 20_000n, '31-60': 20_000n });
  });

  it('payments above all charges leave no owed amount and the excess as unapplied', () => {
    const r = ageingBuckets([{ day: '2026-10-01', amountMinor: 10_000n }, { day: '2026-10-02', amountMinor: -12_500n }], asOf);
    expect(r).toEqual({ buckets: zero, owedMinor: 0n, unappliedMinor: 2_500n });
  });

  it('a reversal of a payment (a positive entry) is a debt dated the day it was made', () => {
    const r = ageingBuckets([{ day: '2026-06-01', amountMinor: 10_000n }, { day: '2026-06-02', amountMinor: -10_000n }, { day: '2026-10-30', amountMinor: 10_000n }], asOf);
    expect(r.buckets).toEqual({ ...zero, '0-30': 10_000n });
  });

  it('nothing at all is all zero', () => {
    expect(ageingBuckets([], asOf)).toEqual({ buckets: zero, owedMinor: 0n, unappliedMinor: 0n });
  });
});

describe('ageingBuckets: refunds and corrections go to what they belong to', () => {
  const asOf = '2026-10-27';
  const old = { day: '2026-07-30', amountMinor: 30_000n, kind: 'CHARGE', saleId: 's1' } as const; // 89 days
  const recent = { day: '2026-10-25', amountMinor: 10_000n, kind: 'CHARGE', saleId: 's2' } as const; // 2 days

  it('a refund of the recent sale cancels that sale, not the oldest debt', () => {
    const refund = { day: '2026-10-26', amountMinor: -10_000n, kind: 'REFUND', saleId: 's2' } as const;
    expect(ageingBuckets([old, recent, refund], asOf)).toEqual({ buckets: { '0-30': 0n, '31-60': 0n, '61-90': 30_000n, '90+': 0n }, owedMinor: 30_000n, unappliedMinor: 0n });
  });

  it('a refund beyond its own charge (the customer had paid) is a credit on the account, applied to the oldest debt', () => {
    const paid = { day: '2026-10-20', amountMinor: -10_000n, kind: 'PAYMENT', paymentId: 'p1' } as const;
    const refund = { day: '2026-10-26', amountMinor: -10_000n, kind: 'REFUND', saleId: 's2' } as const;
    // 40 000 charged, the recent sale (10 000) cancelled by its refund, 10 000 paid off the oldest: 20 000 of the July sale is left.
    expect(ageingBuckets([old, recent, paid, refund], asOf)).toEqual({ buckets: { '0-30': 0n, '31-60': 0n, '61-90': 20_000n, '90+': 0n }, owedMinor: 20_000n, unappliedMinor: 0n });
  });

  it('a corrected payment disappears with its correction: both sales are open in full', () => {
    const paid = { day: '2026-10-26', amountMinor: -5000n, kind: 'PAYMENT', paymentId: 'p1' } as const;
    const fixed = { day: '2026-10-27', amountMinor: 5000n, kind: 'REVERSAL', paymentId: 'p2', reversesPaymentId: 'p1' } as const;
    expect(ageingBuckets([old, recent, paid, fixed], asOf)).toEqual({ buckets: { '0-30': 10_000n, '31-60': 0n, '61-90': 30_000n, '90+': 0n }, owedMinor: 40_000n, unappliedMinor: 0n });
  });

  it('plain entries without a kind keep the plain rule', () => {
    expect(ageingBuckets([{ day: '2026-07-30', amountMinor: 30_000n }, { day: '2026-10-25', amountMinor: 10_000n }, { day: '2026-10-26', amountMinor: -10_000n }], asOf).buckets).toEqual({
      '0-30': 10_000n,
      '31-60': 0n,
      '61-90': 20_000n,
      '90+': 0n,
    });
  });
});
