import { describe, expect, it } from 'vitest';
import { addPeriod } from '@/server/domain/billing/periods';

const at = (s: string) => new Date(s);

describe('addPeriod', () => {
  it('clamps a month-end start to the shorter month', () => {
    expect(addPeriod(at('2027-01-31T09:00:00+03:00'), 'MONTHLY').toISOString()).toBe(at('2027-02-28T09:00:00+03:00').toISOString());
  });

  it('returns to the anchor day when the month is long enough', () => {
    expect(addPeriod(at('2027-02-28T09:00:00+03:00'), 'MONTHLY', 31).toISOString()).toBe(at('2027-03-31T09:00:00+03:00').toISOString());
  });

  it('uses 29 February in a leap year', () => {
    expect(addPeriod(at('2028-01-31T09:00:00+03:00'), 'MONTHLY').toISOString()).toBe(at('2028-02-29T09:00:00+03:00').toISOString());
  });

  it('moves a leap day one year on, clamped', () => {
    expect(addPeriod(at('2028-02-29T09:00:00+03:00'), 'YEARLY').toISOString()).toBe(at('2029-02-28T09:00:00+03:00').toISOString());
  });

  it('rolls over the year in December', () => {
    expect(addPeriod(at('2027-12-15T09:00:00+03:00'), 'MONTHLY').toISOString()).toBe(at('2028-01-15T09:00:00+03:00').toISOString());
  });

  it('works on the Baghdad day, not the UTC day', () => {
    // 01:00 Baghdad on the 1st is still the 31st in UTC.
    expect(addPeriod(at('2027-03-01T01:00:00+03:00'), 'MONTHLY').toISOString()).toBe(at('2027-04-01T01:00:00+03:00').toISOString());
  });
});
