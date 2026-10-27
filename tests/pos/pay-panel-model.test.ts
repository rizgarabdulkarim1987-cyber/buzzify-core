import { describe, expect, it } from 'vitest';
import { cashChange, legsReady, remaining, tipPreset, toLegs } from '@/lib/pos-pay-legs';

describe('pay panel model', () => {
  it('remaining is what the typed amounts leave of the bill', () => {
    expect(remaining(10000, { CASH: '4000', CARD: '' })).toBe(6000);
    expect(remaining(10000, { CASH: '12000' })).toBe(-2000);
  });

  it('legs are ready only when the used amounts add up to the bill', () => {
    expect(legsReady(10000, { CASH: '4000', CARD: '6000' })).toBe(true);
    expect(legsReady(10000, { CASH: '4000', CARD: '5000' })).toBe(false);
    expect(legsReady(10000, { CASH: '0', CARD: '10000' })).toBe(true);
    expect(legsReady(10000, {})).toBe(false);
  });

  it('toLegs drops empty methods and gives cash its tendered amount', () => {
    expect(toLegs({ CASH: '4000', CARD: '6000', ZAINCASH: '' }, { CARD: 'ref1' }, 5000)).toEqual([
      { method: 'CASH', amount: 4000, tendered: 5000 },
      { method: 'CARD', amount: 6000, reference: 'ref1' },
    ]);
  });

  it('cash change counts the cash tip', () => {
    expect(cashChange({ cash: 4000, cashTip: 500, tendered: 5000 })).toBe(500);
    expect(cashChange({ cash: 4000, cashTip: 0, tendered: 3000 })).toBe(-1000);
  });

  it('tip presets are a percent of the bill', () => {
    expect(tipPreset(10000, 10)).toBe(1000);
    expect(tipPreset(3333, 15)).toBe(500);
  });
});
