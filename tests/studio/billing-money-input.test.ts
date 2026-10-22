import { describe, expect, it } from 'vitest';
import { amountProblemKey } from '@/studio/billing';
import { STUDIO_MESSAGES } from '@/studio/messages';
import { formatAmountInput, MAX_MINOR, parseAmountInput } from '@/studio/money-input';

/** Ported from Business Core (tests/admin/money-input.test.ts), then made strict per currency. */
describe('IQD amounts', () => {
  it.each([
    // In Iraq a point groups thousands: "25.000" is twenty-five thousand dinars, never 25.
    ['25.000', 25000],
    ['25,000', 25000],
    ['25٬000', 25000],
    ['25 000', 25000],
    ['25 000', 25000],
    ['25000', 25000],
    ['1.250.000', 1250000],
    ['1,250,000', 1250000],
    ['1 250 000', 1250000],
    // The narrow no-break space, which `Intl` writes between groups for some locales.
    ['25 000', 25000],
    ['1 250 000', 1250000],
    ['٢٥٬٠٠٠', 25000],
    ['٢٥٠٠٠', 25000],
    ['۲۵۰۰۰', 25000],
    ['۲۵.۰۰۰', 25000],
    ['0', 0],
    ['2147483647', MAX_MINOR],
    ['2.147.483.647', MAX_MINOR],
  ] as const)('reads %j as %i dinars', (text, minor) => {
    expect(parseAmountInput(text, 'IQD')).toEqual({ ok: true, minor });
  });

  it.each([
    ['25.5'],
    ['25.00'],
    ['2.50.000'],
    ['25.'],
    ['25,'],
    ['.000'],
    ['25.000,000'],
    ['25,0000'],
    ['1250.000'],
    ['25٫5'],
    // The Arabic decimal mark is a decimal mark: dinars have none.
    ['٢٥٫٠٠٠'],
    ['abc'],
  ] as const)('refuses %j as not whole dinars', (text) => {
    const read = parseAmountInput(text, 'IQD');
    expect(read.ok).toBe(false);
    expect(read.ok ? null : amountProblemKey(read.reason, 'IQD')).toBe('billing.amount.whole');
  });

  it('refuses an empty, negative or too large amount', () => {
    expect(parseAmountInput('', 'IQD')).toEqual({ ok: false, reason: 'EMPTY' });
    expect(parseAmountInput('-5', 'IQD')).toEqual({ ok: false, reason: 'NEGATIVE' });
    expect(parseAmountInput('2147483648', 'IQD')).toEqual({ ok: false, reason: 'TOO_LARGE' });
    expect(parseAmountInput('3.000.000.000', 'IQD')).toEqual({ ok: false, reason: 'TOO_LARGE' });
  });
});

describe('USD amounts', () => {
  it.each([
    ['19.99', 1999],
    ['0.29', 29],
    ['20', 2000],
    ['20.5', 2050],
    ['1,250.50', 125050],
    ['1,250', 125000],
    ['1,234,567.89', 123456789],
    ['١٩٫٩٩', 1999],
    ['١٬٢٥٠٫٥٠', 125050],
    ['۱۹.۹۹', 1999],
    ['21474836.47', MAX_MINOR],
  ] as const)('reads %j as %i cents', (text, minor) => {
    expect(parseAmountInput(text, 'USD')).toEqual({ ok: true, minor });
  });

  it.each([
    ['1.250,50', 'billing.amount.usdFormat'],
    ['4,50', 'billing.amount.usdFormat'],
    ['1,25', 'billing.amount.usdFormat'],
    ['19.', 'billing.amount.usdFormat'],
    ['.5', 'billing.amount.usdFormat'],
    ['1 250.50', 'billing.amount.usdFormat'],
    ['abc', 'billing.amount.usdFormat'],
    ['1.999', 'billing.amount.cents'],
    ['19.990', 'billing.amount.cents'],
  ] as const)('refuses %j with %s', (text, key) => {
    const read = parseAmountInput(text, 'USD');
    expect(read.ok).toBe(false);
    expect(read.ok ? null : amountProblemKey(read.reason, 'USD')).toBe(key);
  });

  it('refuses an amount above the largest Int4', () => {
    expect(parseAmountInput('21474836.48', 'USD')).toEqual({ ok: false, reason: 'TOO_LARGE' });
  });
});

describe('the messages', () => {
  it.each(['en', 'ar', 'ckb'] as const)('has every amount message and the read-back in %s', (locale) => {
    for (const key of ['billing.amount.whole', 'billing.amount.cents', 'billing.amount.usdFormat', 'billing.amount.EMPTY', 'billing.amount.NEGATIVE', 'billing.amount.TOO_LARGE']) {
      expect(STUDIO_MESSAGES[locale][key], key).toBeTruthy();
    }
    expect(STUDIO_MESSAGES[locale]['billing.amountReads']).toContain('{amount}');
  });

  it('names, for every problem in every currency, a message that exists, and keeps no amount message nothing names', () => {
    const problems = ['EMPTY', 'NOT_A_NUMBER', 'NEGATIVE', 'NOT_WHOLE', 'TOO_PRECISE', 'TOO_LARGE'] as const;
    const named = new Set(problems.flatMap((reason) => (['IQD', 'USD'] as const).map((currency) => amountProblemKey(reason, currency))));
    for (const key of named) expect(STUDIO_MESSAGES.en[key], key).toBeTruthy();
    const defined = Object.keys(STUDIO_MESSAGES.en).filter((key) => key.startsWith('billing.amount.'));
    expect(defined.sort()).toEqual([...named].sort());
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
