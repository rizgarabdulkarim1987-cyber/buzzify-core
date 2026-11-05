import { describe, expect, it } from 'vitest';
import { daysLeft, liveOccasionMood } from '@/server/domain/occasion-mood';
import type { CatalogOccasion } from '@/server/domain/types';

const occasion = (overrides: Partial<CatalogOccasion> & Pick<CatalogOccasion, 'id'>): CatalogOccasion => ({
  startsOn: '2027-03-01',
  endsOn: '2027-03-30',
  isActive: true,
  translations: { en: { name: 'Ramadan' }, ar: { name: 'رمضان' } },
  ...overrides,
});

// Midday in Baghdad (UTC+3, no daylight saving) on the given local date.
const noon = (date: string) => new Date(`${date}T09:00:00Z`);
const zone = 'Asia/Baghdad';

describe('daysLeft', () => {
  it('counts whole days to the last date, and is 0 on the last day itself', () => {
    expect(daysLeft('2027-03-30', '2027-03-25')).toBe(5);
    expect(daysLeft('2027-03-30', '2027-03-30')).toBe(0);
    expect(daysLeft('2027-04-02', '2027-03-30')).toBe(3);
  });

  it('crosses a month and a year end', () => {
    expect(daysLeft('2027-01-02', '2026-12-30')).toBe(3);
  });
});

describe('liveOccasionMood', () => {
  const ramadan = occasion({ id: 'o-ramadan', mood: 'RAMADAN' });

  it('names the live occasion that has a mood, with its days left', () => {
    expect(liveOccasionMood([ramadan], noon('2027-03-25'), zone, 'en')).toEqual({ mood: 'RAMADAN', name: 'Ramadan', daysLeft: 5 });
  });

  it('reads the name in the guest\'s language, falling back to the menu\'s own', () => {
    expect(liveOccasionMood([ramadan], noon('2027-03-25'), zone, 'ar')?.name).toBe('رمضان');
    expect(liveOccasionMood([ramadan], noon('2027-03-25'), zone, 'ckb')?.name).toBe('Ramadan');
  });

  it('shows nothing before it starts, after it ends, when it is switched off, or when it has no mood', () => {
    expect(liveOccasionMood([ramadan], noon('2027-02-28'), zone, 'en')).toBeNull();
    expect(liveOccasionMood([ramadan], noon('2027-03-31'), zone, 'en')).toBeNull();
    expect(liveOccasionMood([{ ...ramadan, isActive: false }], noon('2027-03-25'), zone, 'en')).toBeNull();
    expect(liveOccasionMood([occasion({ id: 'o-plain' })], noon('2027-03-25'), zone, 'en')).toBeNull();
  });

  it('takes the occasion that ends soonest when two are live', () => {
    const eid = occasion({ id: 'o-eid', mood: 'EID', startsOn: '2027-03-24', endsOn: '2027-03-27', translations: { en: { name: 'Eid' } } });
    expect(liveOccasionMood([ramadan, eid], noon('2027-03-25'), zone, 'en')).toEqual({ mood: 'EID', name: 'Eid', daysLeft: 2 });
  });

  it('uses the menu\'s time zone for today, not the server\'s', () => {
    // 22:00 UTC on 3-30 is already 3-31 in Baghdad, so the occasion has ended there.
    expect(liveOccasionMood([ramadan], new Date('2027-03-30T22:00:00Z'), zone, 'en')).toBeNull();
    expect(liveOccasionMood([ramadan], new Date('2027-03-30T22:00:00Z'), 'UTC', 'en')).not.toBeNull();
  });
});
