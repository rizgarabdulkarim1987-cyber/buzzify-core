import { describe, expect, it } from 'vitest';
import { cashDifference, expectedCash } from '@/server/domain/pos/cash-drawer';

describe('expectedCash', () => {
  it('adds cash sales and subtracts expenses', () => {
    expect(expectedCash({ openingFloat: 50000, cashSales: [10395, 20000], expenses: [5000], cashRefunds: [] })).toBe(75395);
  });

  it('is the opening float when nothing happened', () => {
    expect(expectedCash({ openingFloat: 50000, cashSales: [], expenses: [], cashRefunds: [] })).toBe(50000);
  });

  it('returns a negative value as is, without clamping', () => {
    expect(expectedCash({ openingFloat: 1000, cashSales: [], expenses: [4000], cashRefunds: [] })).toBe(-3000);
  });

  it('throws on non-integer values', () => {
    expect(() => expectedCash({ openingFloat: 0.5, cashSales: [], expenses: [], cashRefunds: [] })).toThrow();
    expect(() => expectedCash({ openingFloat: 0, cashSales: [1.5], expenses: [], cashRefunds: [] })).toThrow();
    expect(() => expectedCash({ openingFloat: 0, cashSales: [], expenses: [NaN], cashRefunds: [] })).toThrow();
    expect(() => expectedCash({ openingFloat: Infinity, cashSales: [], expenses: [], cashRefunds: [] })).toThrow();
  });

  it('expectedCash subtracts cashRefunds', () => {
    expect(expectedCash({ openingFloat: 50000, cashSales: [10395, 20000], expenses: [5000], cashRefunds: [10395] })).toBe(65000);
    // Never clamped: a refund larger than the drawer leaves it negative.
    expect(expectedCash({ openingFloat: 0, cashSales: [], expenses: [], cashRefunds: [5000] })).toBe(-5000);
  });

  it('a float refund amount throws', () => {
    expect(() => expectedCash({ openingFloat: 0, cashSales: [], expenses: [], cashRefunds: [1.5] })).toThrow(/cashRefunds/);
    expect(() => expectedCash({ openingFloat: 0, cashSales: [], expenses: [], cashRefunds: [NaN] })).toThrow(/cashRefunds/);
  });
});

describe('cashDifference', () => {
  it('is negative for a shortage', () => {
    expect(cashDifference(75000, 75395)).toBe(-395);
  });

  it('is positive for a surplus and zero when equal', () => {
    expect(cashDifference(76000, 75395)).toBe(605);
    expect(cashDifference(75395, 75395)).toBe(0);
  });

  it('throws on non-integer values', () => {
    expect(() => cashDifference(1.5, 1)).toThrow();
    expect(() => cashDifference(1, NaN)).toThrow();
  });
});
