import { describe, expect, it } from 'vitest';
import {
  addMoney,
  assertEnabledCurrency,
  compareMoney,
  CurrencyMismatchError,
  CurrencyNotEnabledError,
  formatPhMoney,
  mulQty,
  parseMoney,
} from '@/server/domain/pharmacy/money';

describe('pharmacy money', () => {
  it('250 IQD parses to 250n and 12.50 USD to 1250n', () => {
    expect(parseMoney('250', 'IQD')).toEqual({ amount: 250n, currency: 'IQD' });
    expect(parseMoney('12.50', 'USD')).toEqual({ amount: 1250n, currency: 'USD' });
    expect(parseMoney('12.5', 'USD')?.amount).toBe(1250n);
    expect(parseMoney('12', 'USD')?.amount).toBe(1200n);
  });

  it('Arabic-Indic digits ١٢٥٠ parse to 1250n', () => {
    expect(parseMoney('١٢٥٠', 'IQD')?.amount).toBe(1250n);
    expect(parseMoney('۱۲۵۰', 'IQD')?.amount).toBe(1250n);
    expect(parseMoney('١٢٫٥٠', 'USD')?.amount).toBe(1250n);
  });

  it('1,250 and 1 250 and ١٬٢٥٠ parse equally', () => {
    const a = parseMoney('1,250', 'IQD');
    expect(a?.amount).toBe(1250n);
    expect(parseMoney('1 250', 'IQD')).toEqual(a);
    expect(parseMoney('١٬٢٥٠', 'IQD')).toEqual(a);
  });

  it('12.5 IQD is refused (no decimals)', () => {
    expect(parseMoney('12.5', 'IQD')).toBeNull();
    expect(parseMoney('12٫5', 'IQD')).toBeNull();
  });

  it('1.2E3 is refused', () => {
    expect(parseMoney('1.2E3', 'USD')).toBeNull();
    expect(parseMoney('1e3', 'IQD')).toBeNull();
  });

  it('extra decimals, empty and junk are refused', () => {
    expect(parseMoney('12.345', 'USD')).toBeNull();
    expect(parseMoney('1.2.3', 'USD')).toBeNull();
    expect(parseMoney('', 'IQD')).toBeNull();
    expect(parseMoney('   ', 'IQD')).toBeNull();
    expect(parseMoney('abc', 'IQD')).toBeNull();
    expect(parseMoney('.', 'USD')).toBeNull();
  });

  it('thousands separators are only proper grouping', () => {
    expect(parseMoney('12,50', 'USD')).toBeNull();
    expect(parseMoney('1,2,50', 'USD')).toBeNull();
    expect(parseMoney('1,25', 'IQD')).toBeNull();
    expect(parseMoney('1250,000', 'IQD')).toBeNull();
    expect(parseMoney(',250', 'IQD')).toBeNull();
    expect(parseMoney('1,250,000', 'IQD')?.amount).toBe(1250000n);
    expect(parseMoney('1,250.50', 'USD')?.amount).toBe(125050n);
    expect(parseMoney('١٬٢٥٠٫٥٠', 'USD')?.amount).toBe(125050n);
    expect(parseMoney('1,250', 'IQD')?.amount).toBe(1250n);
  });

  it('zero, mixed digits and leading zeros', () => {
    expect(parseMoney('٠', 'IQD')?.amount).toBe(0n);
    expect(parseMoney('1٢3٤', 'IQD')?.amount).toBe(1234n);
    expect(parseMoney('007', 'IQD')?.amount).toBe(7n);
  });

  it('negative amounts are refused by parseMoney', () => {
    expect(parseMoney('-5', 'IQD')).toBeNull();
    expect(parseMoney('-0.50', 'USD')).toBeNull();
  });

  it('amounts beyond Number range stay exact', () => {
    expect(parseMoney('9007199254740993', 'IQD')?.amount).toBe(9007199254740993n);
  });

  it('adding IQD and USD throws CurrencyMismatchError', () => {
    expect(() => addMoney({ amount: 1n, currency: 'IQD' }, { amount: 1n, currency: 'USD' })).toThrow(
      CurrencyMismatchError,
    );
    expect(() => compareMoney({ amount: 1n, currency: 'IQD' }, { amount: 1n, currency: 'USD' })).toThrow(
      CurrencyMismatchError,
    );
  });

  it('adds and compares within one currency', () => {
    expect(addMoney({ amount: 100n, currency: 'USD' }, { amount: 250n, currency: 'USD' })).toEqual({
      amount: 350n,
      currency: 'USD',
    });
    expect(compareMoney({ amount: 1n, currency: 'IQD' }, { amount: 2n, currency: 'IQD' })).toBe(-1);
    expect(compareMoney({ amount: 2n, currency: 'IQD' }, { amount: 2n, currency: 'IQD' })).toBe(0);
    expect(compareMoney({ amount: 3n, currency: 'IQD' }, { amount: 2n, currency: 'IQD' })).toBe(1);
  });

  it('mulQty of 9_000_000_000n by 1000 does not overflow', () => {
    expect(mulQty({ amount: 9_000_000_000n, currency: 'IQD' }, 1000)).toEqual({
      amount: 9_000_000_000_000n,
      currency: 'IQD',
    });
    expect(mulQty({ amount: 9_000_000_000n, currency: 'IQD' }, Number.MAX_SAFE_INTEGER).amount).toBe(
      9_000_000_000n * BigInt(Number.MAX_SAFE_INTEGER),
    );
  });

  it('mulQty refuses a non-integer or unsafe quantity', () => {
    const m = { amount: 5n, currency: 'IQD' as const };
    expect(() => mulQty(m, 1.5)).toThrow(RangeError);
    expect(() => mulQty(m, Number.MAX_SAFE_INTEGER + 2)).toThrow(RangeError);
    expect(() => mulQty(m, Number.NaN)).toThrow(RangeError);
  });

  it('a negative quantity gives a negative amount', () => {
    expect(mulQty({ amount: 5n, currency: 'IQD' }, -3).amount).toBe(-15n);
  });

  it('a USD price on a business that enabled only IQD throws CurrencyNotEnabledError', () => {
    expect(() => assertEnabledCurrency('USD', ['IQD'])).toThrow(CurrencyNotEnabledError);
    expect(() => assertEnabledCurrency('IQD', ['IQD'])).not.toThrow();
  });

  it('formats through formatMoney', () => {
    expect(formatPhMoney({ amount: 1250n, currency: 'USD' }, 'en')).toBe('$12.50');
    expect(formatPhMoney({ amount: 1250n, currency: 'IQD' }, 'en')).toContain('1,250');
  });
});
