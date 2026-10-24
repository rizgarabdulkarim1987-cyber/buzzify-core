import { describe, expect, it } from 'vitest';
import { baghdadDayOf, baghdadDayRange, isCalendarDay } from '@/lib/baghdad';
import { computeTotals } from '@/server/domain/pos/totals';
import { differenceKind, parseAmount, quickCashAmounts } from '@/server/domain/pos/cash';
import { elapsedLabel, formatNumber } from '@/lib/pos-format';

describe('the cash the cashier types', () => {
  it('reads Arabic-Indic digits and thousands marks', () => {
    expect(parseAmount('٤٥٬٠٠٠')).toBe(45000);
    expect(parseAmount('45,000')).toBe(45000);
  });

  it('refuses anything that is not a whole amount of dinars', () => {
    for (const text of ['1e5', '12.5', '-3', '', 'abc', '99999999999']) expect(parseAmount(text), text).toBeNull();
  });

  it('offers the exact total and the next banknotes', () => {
    expect(quickCashAmounts(10395)).toEqual([10395, 11000, 15000, 20000, 25000]);
  });

  it('names a count against the expected cash', () => {
    expect([differenceKind(5), differenceKind(-5), differenceKind(0)]).toEqual(['surplus', 'shortage', 'exact']);
  });
});

describe('a comped order', () => {
  it('totals zero when its only line is fully discounted, with service and tax on top of nothing', () => {
    const totals = computeTotals(
      [{ unitPrice: 5000, optionsTotal: 0, quantity: 2, discount: { kind: 'PERCENT', value: 100 } }],
      undefined,
      { serviceRatePercent: 10, taxRatePercent: 5 },
    );
    expect(totals.total).toBe(0);
  });
});

describe('the Baghdad business day', () => {
  it('rolls over at midnight in Baghdad (UTC+3), not in UTC', () => {
    expect(baghdadDayOf(new Date('2026-10-24T21:30:00Z'))).toBe('2026-10-25');
    expect(baghdadDayOf(new Date('2026-10-24T20:59:00Z'))).toBe('2026-10-24');
    expect(baghdadDayRange(new Date('2026-10-24T21:30:00Z')).start.toISOString()).toBe('2026-10-24T21:00:00.000Z');
  });

  it('accepts only real calendar days', () => {
    expect(isCalendarDay('2026-02-30')).toBe(false);
    expect(isCalendarDay('2026-10-25')).toBe(true);
  });
});

describe('numbers are Latin digits in every language', () => {
  it('groups thousands with a comma', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
  });
  it('says a minute count in the plural form of the language', () => {
    const text = { justNow: 'now', one: '{n} minute', two: '{n} minutes', few: '{n} minutes', many: '{n} minutes', other: '{n} minutes', hours: '{time} h' };
    expect(elapsedLabel(0, text, 'en')).toBe('now');
    expect(elapsedLabel(5, text, 'en')).toBe('5 minutes');
    expect(elapsedLabel(65, text, 'en')).toBe('1:05 h');
  });
});
