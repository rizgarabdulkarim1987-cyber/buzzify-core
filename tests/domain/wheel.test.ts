import { describe, expect, it } from 'vitest';
import { dayOf, drawSlice, spinAllowed, validateWheel, wheelOpen } from '@/server/domain/wheel';

const slices = (weights: number[]) => weights.map((weight, index) => ({ id: `s${index}`, weight }));

describe('drawSlice', () => {
  it('picks by weight with a seeded random and never a zero-weight slice', () => {
    const set = slices([1, 0, 3]);
    // The random stand-in returns the position in the total weight (4): 0 is the first slice, 1 to 3 the third.
    expect(drawSlice(set, () => 0)).toBe('s0');
    expect(drawSlice(set, () => 1)).toBe('s2');
    expect(drawSlice(set, () => 3)).toBe('s2');
    const seen = new Set<string>();
    for (let n = 0; n < 4; n++) seen.add(drawSlice(set, () => n));
    expect(seen).toEqual(new Set(['s0', 's2']));
  });

  it('asks the random source for a position below the total weight', () => {
    const asked: number[] = [];
    drawSlice(slices([2, 5, 3]), (n) => {
      asked.push(n);
      return 0;
    });
    expect(asked).toEqual([10]);
  });

  it('refuses a set with no weight at all', () => {
    expect(() => drawSlice(slices([0, 0]), () => 0)).toThrow();
    expect(() => drawSlice([], () => 0)).toThrow();
  });
});

describe('validateWheel', () => {
  const ok = { slices: slices([1, 1, 1, 1]), spinsPerDay: 1 };

  it('needs 4 to 12 slices', () => {
    expect(validateWheel(ok)).toBeNull();
    expect(validateWheel({ ...ok, slices: slices(Array(12).fill(1)) })).toBeNull();
    expect(validateWheel({ ...ok, slices: slices([1, 1, 1]) })).toBe('SLICE_COUNT');
    expect(validateWheel({ ...ok, slices: slices(Array(13).fill(1)) })).toBe('SLICE_COUNT');
  });

  it('needs integer weights from 1 to 100', () => {
    for (const weight of [0, -1, 101, 1.5, Number.NaN]) {
      expect(validateWheel({ ...ok, slices: slices([weight, 1, 1, 1]) }), String(weight)).toBe('WEIGHT');
    }
    expect(validateWheel({ ...ok, slices: slices([100, 1, 1, 50]) })).toBeNull();
  });

  it('needs spinsPerDay from 1 to 10, whole', () => {
    for (const spinsPerDay of [0, 11, 1.5, -1]) expect(validateWheel({ ...ok, spinsPerDay }), String(spinsPerDay)).toBe('SPINS_PER_DAY');
    expect(validateWheel({ ...ok, spinsPerDay: 10 })).toBeNull();
  });
});

describe('wheelOpen', () => {
  const at = (iso: string) => new Date(iso);
  const now = at('2026-10-29T12:00:00Z');

  it('follows the window, a missing bound being open and the end inclusive', () => {
    expect(wheelOpen({ startsAt: null, endsAt: null }, now)).toBe(true);
    expect(wheelOpen({ startsAt: at('2026-10-30T00:00:00Z'), endsAt: null }, now)).toBe(false);
    expect(wheelOpen({ startsAt: null, endsAt: at('2026-10-29T11:59:59Z') }, now)).toBe(false);
    expect(wheelOpen({ startsAt: at('2026-10-29T12:00:00Z'), endsAt: at('2026-10-29T12:00:00Z') }, now)).toBe(true);
  });
});

describe('dayOf', () => {
  it('uses the time zone', () => {
    const instant = new Date('2026-10-29T22:30:00Z');
    expect(dayOf(instant, 'UTC')).toBe('2026-10-29');
    expect(dayOf(instant, 'Asia/Baghdad')).toBe('2026-10-30');
    expect(dayOf(instant, 'America/Los_Angeles')).toBe('2026-10-29');
  });
});

describe('spinAllowed', () => {
  it('allows the guest limit and three times that per address', () => {
    expect(spinAllowed({ guestSpins: 0, ipSpins: 0, spinsPerDay: 1 })).toBe(true);
    expect(spinAllowed({ guestSpins: 1, ipSpins: 1, spinsPerDay: 1 })).toBe(false);
    expect(spinAllowed({ guestSpins: 0, ipSpins: 2, spinsPerDay: 1 })).toBe(true);
    expect(spinAllowed({ guestSpins: 0, ipSpins: 3, spinsPerDay: 1 })).toBe(false);
    expect(spinAllowed({ guestSpins: 1, ipSpins: 5, spinsPerDay: 2 })).toBe(true);
    expect(spinAllowed({ guestSpins: 2, ipSpins: 5, spinsPerDay: 2 })).toBe(false);
    expect(spinAllowed({ guestSpins: 0, ipSpins: 6, spinsPerDay: 2 })).toBe(false);
  });
});
