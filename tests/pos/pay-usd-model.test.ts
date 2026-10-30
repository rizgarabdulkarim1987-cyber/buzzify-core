import { describe, expect, it } from 'vitest';
import { toLegs, usdBack, usdDue, usdQuick } from '@/lib/pos-pay-legs';
import { usdChange, usdNeeded } from '@/server/domain/pos/usd';

describe('dollars on the pay dialog', () => {
  it('rounds the dollars to take up to a whole dollar', () => {
    expect(usdDue(15_000, 1500)).toBe(10);
    expect(usdDue(10_000, 1500)).toBe(7);
    expect(usdDue(1, 1500)).toBe(1);
  });

  it('has nothing to take for a zero amount, and refuses a missing rate', () => {
    expect(usdDue(0, 1500)).toBe(0);
    expect(usdDue(15_000, 0)).toBeNull();
    expect(usdDue(15_000, -1500)).toBeNull();
  });

  it('gives the overpayment back in dinars and never a negative change', () => {
    expect(usdBack(12, 1500, 15_000)).toBe(3_000);
    expect(usdBack(7, 1500, 10_000)).toBe(500);
    expect(usdBack(10, 1500, 15_000)).toBe(0);
    expect(usdBack(1, 1500, 15_000)).toBe(0);
  });

  it('offers the exact dollars first, then a few round amounts above it, each once', () => {
    expect(usdQuick(7)).toEqual([7, 10, 20, 50, 100]);
    expect(usdQuick(10)).toEqual([10, 20, 50, 100]);
    expect(usdQuick(120)).toEqual([120]);
    expect(usdQuick(0)).toEqual([]);
  });

  it('sends the dollar leg with the dollars and the rate', () => {
    expect(toLegs({ CASH: '6000', CASH_USD: '9000' }, {}, 6000, { dollars: 6, rate: 1500 })).toEqual([
      { method: 'CASH', amount: 6000, tendered: 6000 },
      { method: 'CASH_USD', amount: 9000, tenderedUsd: 6, rate: 1500 },
    ]);
  });

  it('shares its rule with the server', () => {
    expect(usdDue(10_000, 1500)).toBe(usdNeeded(10_000, 1500));
    expect(usdBack(7, 1500, 10_000)).toBe(usdChange(7, 1500, 10_000));
  });
});
