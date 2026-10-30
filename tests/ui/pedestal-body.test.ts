import { describe, expect, it } from 'vitest';
import { clockOf } from '@/ui/template/bodies/PedestalBody';

describe('the pedestal body', () => {
  it('gives every card a steady clock of 5 to 8 seconds, started 0 to 6 seconds in', () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const clock = clockOf(seed);
      expect(clock).toEqual(clockOf(seed));
      expect(clock.period).toBeGreaterThanOrEqual(5);
      expect(clock.period).toBeLessThan(8.01);
      expect(clock.offset).toBeGreaterThanOrEqual(0);
      expect(clock.offset).toBeLessThan(6.01);
    }
  });

  it('does not bob neighbouring cards together', () => {
    const periods = new Set([0, 1, 2, 3, 4, 5].map((seed) => clockOf(seed).period));
    expect(periods.size).toBeGreaterThan(3);
  });
});
