import { describe, expect, it } from 'vitest';
import { cashChange, computeTotals, lineDiscount, lineTotal, type Rates } from '@/server/domain/pos/totals';

const off: Rates = { serviceRatePercent: 0, taxRatePercent: 0 };

describe('computeTotals', () => {
  it('sums lines with options and quantity', () => {
    const t = computeTotals(
      [
        { unitPrice: 5000, optionsTotal: 500, quantity: 2 },
        { unitPrice: 3000, optionsTotal: 0, quantity: 1 },
      ],
      undefined,
      off,
    );
    expect(t.subtotal).toBe(14000);
    expect(t.total).toBe(14000);
  });

  it('line discount percent and amount', () => {
    const t = computeTotals(
      [
        { unitPrice: 5000, optionsTotal: 0, quantity: 2, discount: { kind: 'PERCENT', value: 10 } },
        { unitPrice: 3000, optionsTotal: 0, quantity: 1, discount: { kind: 'AMOUNT', value: 500 } },
      ],
      undefined,
      off,
    );
    expect(t.subtotal).toBe(9000 + 2500);
  });

  it('invoice discount applies after line discounts', () => {
    const t = computeTotals(
      [{ unitPrice: 10000, optionsTotal: 0, quantity: 1, discount: { kind: 'AMOUNT', value: 2000 } }],
      { kind: 'PERCENT', value: 25 },
      off,
    );
    expect(t.subtotal).toBe(8000);
    expect(t.invoiceDiscount).toBe(2000);
    expect(t.total).toBe(6000);
  });

  it('service then tax, in that order', () => {
    const t = computeTotals(
      [{ unitPrice: 10000, optionsTotal: 0, quantity: 1 }],
      { kind: 'AMOUNT', value: 1000 },
      { serviceRatePercent: 10, taxRatePercent: 5 },
    );
    expect(t).toEqual({ subtotal: 10000, invoiceDiscount: 1000, service: 900, tax: 495, deliveryFee: 0, total: 10395 });
  });

  it('rates of zero add nothing', () => {
    const t = computeTotals([{ unitPrice: 7000, optionsTotal: 0, quantity: 1 }], undefined, off);
    expect(t.service).toBe(0);
    expect(t.tax).toBe(0);
    expect(t.total).toBe(7000);
  });

  it('cancelled lines are ignored', () => {
    const t = computeTotals(
      [
        { unitPrice: 5000, optionsTotal: 0, quantity: 1 },
        { unitPrice: 9000, optionsTotal: 0, quantity: 3, cancelled: true },
      ],
      undefined,
      off,
    );
    expect(t.subtotal).toBe(5000);
  });

  it('discount above subtotal is clamped so total never goes negative', () => {
    const lineClamped = computeTotals(
      [{ unitPrice: 1000, optionsTotal: 0, quantity: 1, discount: { kind: 'AMOUNT', value: 5000 } }],
      undefined,
      off,
    );
    expect(lineClamped.subtotal).toBe(0);
    const invoiceClamped = computeTotals(
      [{ unitPrice: 1000, optionsTotal: 0, quantity: 1 }],
      { kind: 'AMOUNT', value: 5000 },
      { serviceRatePercent: 10, taxRatePercent: 5 },
    );
    expect(invoiceClamped.invoiceDiscount).toBe(1000);
    expect(invoiceClamped.total).toBe(0);
  });

  it('percent above 100 is clamped to 100', () => {
    const t = computeTotals(
      [{ unitPrice: 1000, optionsTotal: 0, quantity: 1 }],
      { kind: 'PERCENT', value: 150 },
      off,
    );
    expect(t.invoiceDiscount).toBe(1000);
    expect(t.total).toBe(0);
  });

  it('rounding is floor on percent results', () => {
    const t = computeTotals(
      [{ unitPrice: 1001, optionsTotal: 0, quantity: 1 }],
      { kind: 'PERCENT', value: 10 },
      { serviceRatePercent: 5, taxRatePercent: 5 },
    );
    expect(t.invoiceDiscount).toBe(100); // 100.1
    expect(t.service).toBe(45); // 901 * 5% = 45.05
    expect(t.tax).toBe(47); // 946 * 5% = 47.3
    expect(t.total).toBe(901 + 45 + 47);
  });
});

describe('computeTotals with a delivery fee', () => {
  const ten = [{ unitPrice: 10000, optionsTotal: 0, quantity: 1 }];

  it('adds the fee after tax: subtotal 10000, tax 10% -> 11000 + fee 2000 = 13000', () => {
    const t = computeTotals(ten, undefined, { serviceRatePercent: 0, taxRatePercent: 10 }, 2000);
    expect(t).toEqual({ subtotal: 10000, invoiceDiscount: 0, service: 0, tax: 1000, deliveryFee: 2000, total: 13000 });
  });

  it('is not discounted, taxed or service-charged: discount 10%, service 10%, tax 5%, fee 3000', () => {
    // 10000 - 1000 = 9000; service 900; tax floor(9900 * 5%) = 495; total 9000 + 900 + 495 + 3000.
    const t = computeTotals(ten, { kind: 'PERCENT', value: 10 }, { serviceRatePercent: 10, taxRatePercent: 5 }, 3000);
    expect(t).toEqual({ subtotal: 10000, invoiceDiscount: 1000, service: 900, tax: 495, deliveryFee: 3000, total: 13395 });
  });

  it('a 100% invoice discount leaves only the fee', () => {
    const t = computeTotals(ten, { kind: 'PERCENT', value: 100 }, { serviceRatePercent: 10, taxRatePercent: 10 }, 2500);
    expect(t.total).toBe(2500);
    expect(t.tax).toBe(0);
    expect(t.service).toBe(0);
  });

  it('an amount discount above the subtotal still leaves only the fee', () => {
    expect(computeTotals(ten, { kind: 'AMOUNT', value: 99999 }, { serviceRatePercent: 0, taxRatePercent: 5 }, 1500).total).toBe(1500);
  });

  it('fee 0 equals the old result for every existing case', () => {
    const cases: { d: Parameters<typeof computeTotals>[1]; r: Rates }[] = [
      { d: undefined, r: off },
      { d: { kind: 'AMOUNT', value: 1000 }, r: { serviceRatePercent: 10, taxRatePercent: 5 } },
      { d: { kind: 'PERCENT', value: 10 }, r: { serviceRatePercent: 5, taxRatePercent: 5 } },
      { d: { kind: 'PERCENT', value: 150 }, r: { serviceRatePercent: 10, taxRatePercent: 5 } },
    ];
    for (const { d, r } of cases) {
      const implicit = computeTotals(ten, d, r);
      expect(computeTotals(ten, d, r, 0)).toEqual(implicit);
      expect(implicit.deliveryFee).toBe(0);
      expect(implicit.total).toBe(implicit.subtotal - implicit.invoiceDiscount + implicit.service + implicit.tax);
    }
  });

  it('an empty order with a fee totals the fee', () => {
    expect(computeTotals([], undefined, off, 2000).total).toBe(2000);
  });

  it('a fractional, negative or non-finite fee throws', () => {
    expect(() => computeTotals(ten, undefined, off, 1500.5)).toThrow();
    expect(() => computeTotals(ten, undefined, off, -1)).toThrow();
    expect(() => computeTotals(ten, undefined, off, Number.NaN)).toThrow();
    expect(() => computeTotals(ten, undefined, off, Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe('lineTotal', () => {
  it('is the gross minus the line discount, the same amount computeTotals adds', () => {
    const line = { unitPrice: 5000, optionsTotal: 1500, quantity: 2, discount: { kind: 'PERCENT' as const, value: 10 } };
    expect(lineTotal(line)).toBe(11700);
    expect(lineTotal({ ...line, discount: { kind: 'AMOUNT', value: 99999 } })).toBe(0);
    expect(computeTotals([line], undefined, { serviceRatePercent: 0, taxRatePercent: 0 }).subtotal).toBe(lineTotal(line));
  });
});

describe('lineDiscount', () => {
  it('is the amount the line discount takes off the gross, so gross = lineTotal + lineDiscount', () => {
    const line = { unitPrice: 5000, optionsTotal: 1500, quantity: 2, discount: { kind: 'PERCENT' as const, value: 10 } };
    expect(lineDiscount(line)).toBe(1300);
    expect(lineDiscount(line) + lineTotal(line)).toBe(13000);
    expect(lineDiscount({ ...line, discount: { kind: 'AMOUNT', value: 700 } })).toBe(700);
  });

  it('is clamped to the gross, and 0 without a discount', () => {
    const line = { unitPrice: 1000, optionsTotal: 0, quantity: 3 };
    expect(lineDiscount(line)).toBe(0);
    expect(lineDiscount({ ...line, discount: { kind: 'AMOUNT', value: 99999 } })).toBe(3000);
    expect(lineDiscount({ ...line, discount: { kind: 'PERCENT', value: 33 } })).toBe(990);
  });
});

describe('cashChange', () => {
  it('is the cash received minus the total (the worked example: 15000 for 10395 gives 4605)', () => {
    expect(cashChange(10395, 15000)).toBe(4605);
    expect(cashChange(10395, 10395)).toBe(0);
    expect(cashChange(0, 0)).toBe(0);
  });

  it('is null when the cash does not cover the total', () => {
    expect(cashChange(10395, 10394)).toBeNull();
    expect(cashChange(1, 0)).toBeNull();
  });
});
