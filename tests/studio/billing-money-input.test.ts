import { describe, expect, it } from 'vitest';
import { formatAmountInput, MAX_MINOR, parseAmountInput } from '@/studio/money-input';

/** Ported from Business Core (tests/admin/money-input.test.ts), with the Int4 ceiling. */
describe('parseAmountInput', () => {
  it.each([
    ['19.99', 'USD', 1999],
    ['0.29', 'USD', 29],
    ['4,50', 'USD', 450],
    ['20', 'USD', 2000],
    ['50,000', 'IQD', 50000],
    ['50000', 'IQD', 50000],
    ['٥٠٠٠٠', 'IQD', 50000],
    ['١٩٫٩٩', 'USD', 1999],
    ['1,234.56', 'USD', 123456],
    ['2147483647', 'IQD', MAX_MINOR],
  ] as const)('reads %s %s as %i minor units', (text, currency, minor) => {
    expect(parseAmountInput(text, currency)).toEqual({ ok: true, minor });
  });

  it.each([
    ['', 'USD', 'EMPTY'],
    ['abc', 'USD', 'NOT_A_NUMBER'],
    ['-5', 'USD', 'NEGATIVE'],
    ['1.999', 'USD', 'TOO_PRECISE'],
    ['1.5', 'IQD', 'TOO_PRECISE'],
    ['2147483648', 'IQD', 'TOO_LARGE'],
    ['21474836.48', 'USD', 'TOO_LARGE'],
    ['3000000000', 'IQD', 'TOO_LARGE'],
  ] as const)('refuses %j in %s as %s', (text, currency, reason) => {
    expect(parseAmountInput(text, currency)).toEqual({ ok: false, reason });
  });
});

describe('formatAmountInput', () => {
  it('writes the major unit with the currency digits', () => {
    expect(formatAmountInput(1999, 'USD')).toBe('19.99');
    expect(formatAmountInput(5, 'USD')).toBe('0.05');
    expect(formatAmountInput(50000, 'IQD')).toBe('50000');
  });

  it('reads back what it writes', () => {
    for (const [minor, currency] of [
      [1999, 'USD'],
      [100, 'USD'],
      [25000, 'IQD'],
      [0, 'IQD'],
    ] as const) {
      expect(parseAmountInput(formatAmountInput(minor, currency), currency)).toEqual({ ok: true, minor });
    }
  });
});
