import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime } from '@/studio/format';
import { phDate, phDateTime, todayInStudioZone } from '@/app/pharmacy/_ui/ph-date';

describe('phDate, the one way the pharmacy screens write a date inside a left-to-right isolate', () => {
  const iso = '2026-10-28T00:00:00.000Z';
  it('keeps the interface language form in English', () => {
    expect(phDate(iso, 'en')).toBe(formatDate(iso, 'en'));
    expect(phDateTime('2026-10-28T11:05:00.000Z', 'en')).toBe(formatDateTime('2026-10-28T11:05:00.000Z', 'en'));
  });
  for (const locale of ['ar', 'ckb'] as const) {
    it(`is year-month-day in Latin digits in ${locale}, with no direction marks that reorder inside an isolate`, () => {
      expect(phDate(iso, locale)).toBe('2026-10-28');
      expect(phDate(iso, locale)).toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/);
    });
    it(`writes a date and time on the Studio calendar in ${locale}`, () => {
      // Baghdad is UTC+3 all year: 21:30 UTC on the 27th is 00:30 on the 28th.
      expect(phDateTime('2026-10-27T21:30:00.000Z', locale)).toBe('2026-10-28 00:30');
      expect(phDateTime('2026-10-27T21:30:00.000Z', locale)).toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}$/);
    });
  }
  it('is the same day for a date-only value in every language', () => {
    expect(phDate('2027-01-01T00:00:00.000Z', 'ar')).toBe('2027-01-01');
    expect(phDate('2027-01-01T00:00:00.000Z', 'ckb')).toBe('2027-01-01');
  });
});

describe('todayInStudioZone', () => {
  it('is the Baghdad day, not the UTC day', () => {
    expect(todayInStudioZone(new Date('2026-10-27T22:30:00.000Z'))).toBe('2026-10-28');
    expect(todayInStudioZone(new Date('2026-10-27T20:59:00.000Z'))).toBe('2026-10-27');
  });
});
