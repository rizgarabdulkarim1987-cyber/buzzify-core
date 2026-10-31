import { describe, expect, it } from 'vitest';
import { isOccasionLive, liveShowcase, SHOWCASE_MAX_PER_SLOT, type CatalogOccasion, type CatalogShowcaseCard } from '@/server/domain/showcase';
import { at } from './fixtures';

const TZ = 'Asia/Baghdad';

/** A local moment in Baghdad (UTC+3, no daylight saving). */
const local = (month: number, day: number, hour: number, minute = 0) => new Date(Date.UTC(2026, month - 1, day, hour - 3, minute));

const occasion = (overrides: Partial<CatalogOccasion> = {}): CatalogOccasion => ({
  id: 'o-eid',
  startsOn: '2026-10-15',
  endsOn: '2026-10-17',
  isActive: true,
  translations: { en: { name: 'Eid' } },
  ...overrides,
});

const card = (overrides: Partial<CatalogShowcaseCard> = {}): CatalogShowcaseCard => ({
  id: 'c1',
  slot: 'ABOVE_SEARCH',
  kind: 'BUFFET',
  sortOrder: 0,
  occasionId: null,
  promotionId: null,
  bundleId: null,
  price: null,
  startMinute: null,
  endMinute: null,
  daysOfWeek: 127,
  translations: { en: { title: 'Card' } },
  ...overrides,
});

const NONE = new Set<string>();
const run = (cards: CatalogShowcaseCard[], extra: Partial<Parameters<typeof liveShowcase>[0]> = {}) =>
  liveShowcase({ cards, occasions: [], liveOfferIds: NONE, shownBundleIds: NONE, now: at(12), timeZone: TZ, ...extra });

describe('isOccasionLive', () => {
  it('is false the day before it starts', () => {
    expect(isOccasionLive(occasion(), local(10, 14, 23, 30), TZ)).toBe(false);
  });

  it('is true on its first day', () => {
    expect(isOccasionLive(occasion(), local(10, 15, 0, 1), TZ)).toBe(true);
  });

  it('is true on its last day at 23:30 and false at 00:01 the next day', () => {
    expect(isOccasionLive(occasion(), local(10, 17, 23, 30), TZ)).toBe(true);
    expect(isOccasionLive(occasion(), local(10, 18, 0, 1), TZ)).toBe(false);
  });

  it('is false when switched off', () => {
    expect(isOccasionLive(occasion({ isActive: false }), at(12), TZ)).toBe(false);
  });

  it('runs a one-day occasion on that day only', () => {
    const one = occasion({ startsOn: '2026-10-15', endsOn: '2026-10-15' });
    expect(isOccasionLive(one, at(12), TZ)).toBe(true);
    expect(isOccasionLive(one, local(10, 16, 12), TZ)).toBe(false);
  });

  it('reads the date in the menu time zone, not UTC', () => {
    const instant = new Date(Date.UTC(2026, 9, 14, 22, 0)); // 14 Oct in UTC, 15 Oct 01:00 in Baghdad
    expect(isOccasionLive(occasion(), instant, TZ)).toBe(true);
    expect(isOccasionLive(occasion(), instant, 'UTC')).toBe(false);
  });
});

describe('liveShowcase', () => {
  it('keeps a card with no occasion', () => {
    expect(run([card()]).ABOVE_SEARCH.map((c) => c.id)).toEqual(['c1']);
  });

  it('drops a card whose occasion has ended, and one whose occasion is unknown', () => {
    const ended = occasion({ id: 'o-old', startsOn: '2026-09-01', endsOn: '2026-09-03' });
    const cards = [card({ id: 'a', occasionId: 'o-old' }), card({ id: 'b', occasionId: 'o-eid' }), card({ id: 'c', occasionId: 'o-gone' })];
    expect(run(cards, { occasions: [ended, occasion()] }).ABOVE_SEARCH.map((c) => c.id)).toEqual(['b']);
  });

  it('drops an OFFER card whose offer is not live', () => {
    const cards = [card({ id: 'a', kind: 'OFFER', promotionId: 'p1' }), card({ id: 'b', kind: 'OFFER', promotionId: 'p2' })];
    expect(run(cards, { liveOfferIds: new Set(['p1']) }).ABOVE_SEARCH.map((c) => c.id)).toEqual(['a']);
  });

  it('drops a SET card whose bundle is not shown', () => {
    const cards = [card({ id: 'a', kind: 'SET', bundleId: 'b1' }), card({ id: 'b', kind: 'SET', bundleId: 'b2' })];
    expect(run(cards, { shownBundleIds: new Set(['b2']) }).ABOVE_SEARCH.map((c) => c.id)).toEqual(['b']);
  });

  it('keeps a BUFFET card only inside its weekday and time window', () => {
    // 2026-10-15 is a Thursday (bit 3). 13:00 to 16:00.
    const buffet = card({ kind: 'BUFFET', price: 15, startMinute: 780, endMinute: 960, daysOfWeek: 1 << 3 });
    expect(run([buffet], { now: at(14) }).ABOVE_SEARCH).toHaveLength(1);
    expect(run([buffet], { now: at(17) }).ABOVE_SEARCH).toHaveLength(0);
    expect(run([buffet], { now: local(10, 16, 14) }).ABOVE_SEARCH).toHaveLength(0); // Friday
  });

  it('wraps a BUFFET window past midnight when the end is not after the start', () => {
    const late = card({ startMinute: 1320, endMinute: 120 });
    expect(run([late], { now: at(23) }).ABOVE_SEARCH).toHaveLength(1);
    expect(run([late], { now: at(1) }).ABOVE_SEARCH).toHaveLength(1);
    expect(run([late], { now: at(12) }).ABOVE_SEARCH).toHaveLength(0);
  });

  it('keeps an all-day BUFFET card on its days', () => {
    const all = card({ kind: 'BUFFET', daysOfWeek: 1 << 3 });
    expect(run([all], { now: at(3) }).ABOVE_SEARCH).toHaveLength(1);
    expect(run([all], { now: local(10, 16, 12) }).ABOVE_SEARCH).toHaveLength(0);
  });

  it('orders by sortOrder then id and splits the slots', () => {
    const cards = [
      card({ id: 'z', sortOrder: 1 }),
      card({ id: 'b', sortOrder: 0 }),
      card({ id: 'a', sortOrder: 0 }),
      card({ id: 'x', slot: 'BELOW_SEARCH' }),
    ];
    const live = run(cards);
    expect(live.ABOVE_SEARCH.map((c) => c.id)).toEqual(['a', 'b', 'z']);
    expect(live.BELOW_SEARCH.map((c) => c.id)).toEqual(['x']);
  });

  it('caps each slot', () => {
    const cards = Array.from({ length: SHOWCASE_MAX_PER_SLOT + 3 }, (_, i) => card({ id: `c${String(i).padStart(2, '0')}`, sortOrder: i }));
    expect(run(cards).ABOVE_SEARCH).toHaveLength(SHOWCASE_MAX_PER_SLOT);
  });

  it('always returns both slots as arrays', () => {
    expect(run([])).toEqual({ ABOVE_SEARCH: [], BELOW_SEARCH: [] });
  });
});
