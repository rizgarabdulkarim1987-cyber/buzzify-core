import { describe, expect, it } from 'vitest';
import { refundIsTerminal, usdRefund } from '@/lib/pos-pay-legs';
import { usdDrawer } from '@/server/pos/payment-legs';

describe('reversing a payment that took dollars', () => {
  it('tells the cashier the dollars to give back and the dinar change to take back', () => {
    const legs = [{ method: 'CASH_USD', amount: 25_000, tendered: null, reference: null, tenderedUsd: 20, rate: 1500 }];
    expect(usdRefund(legs)).toEqual({ dollars: 20, dinarChange: 5_000 });
  });

  it('matches what the drawer counts for the same reversal', () => {
    const dollarLeg = { method: 'CASH_USD' as const, amount: 14_000, tenderedUsd: 10, rate: 1500 };
    const legs = [{ method: 'CASH', amount: 4_000 }, dollarLeg];
    const drawer = usdDrawer([], [{ legs: [dollarLeg] }]);
    expect(usdRefund(legs)).toEqual({ dollars: drawer.refunded, dinarChange: -drawer.dinarChange });
  });

  it('floors the expected dollars at zero and flags the dollars refunded beyond what the drawer took', () => {
    const sale = { legs: [{ method: 'CASH_USD' as const, amount: 15_000, tenderedUsd: 10, rate: 1500 }] };
    const bigRefund = { legs: [{ method: 'CASH_USD' as const, amount: 45_000, tenderedUsd: 30, rate: 1500 }] };
    expect(usdDrawer([sale], [bigRefund])).toMatchObject({ received: 10, refunded: 30, expectedUsd: 0, beyondDrawer: 20 });
    expect(usdDrawer([sale, sale], [sale])).toMatchObject({ expectedUsd: 10, beyondDrawer: 0 });
  });

  it('has no dinar change to take back when the dollars were exact', () => {
    expect(usdRefund([{ method: 'CASH_USD', amount: 15_000, tenderedUsd: 10, rate: 1500 }])).toEqual({ dollars: 10, dinarChange: 0 });
  });

  it('says nothing about dollars for a payment without a dollar leg, or an old leg without the dollars', () => {
    expect(usdRefund([{ method: 'CASH', amount: 10_000 }])).toBeNull();
    expect(usdRefund([{ method: 'CASH_USD', amount: 10_000, tenderedUsd: null, rate: null }])).toBeNull();
  });

  it('treats a dollar payment as cash from the drawer, not a terminal refund', () => {
    expect(refundIsTerminal('CASH')).toBe(false);
    expect(refundIsTerminal('CASH_USD')).toBe(false);
    expect(refundIsTerminal('FIB')).toBe(true);
    expect(refundIsTerminal('ZAINCASH')).toBe(true);
  });
});
