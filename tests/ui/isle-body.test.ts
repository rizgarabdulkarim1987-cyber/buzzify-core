import { describe, expect, it } from 'vitest';
import { isleDrift, isleOffset, isleSway } from '@/ui/template/bodies/IsleBody';

describe('the isle family (The Floating Islands, The Flying Carpet)', () => {
  it('sets the islands in near the start and near the end by turns, the pattern repeating', () => {
    const offsets = [0, 1, 2, 3, 4, 5].map(isleOffset);
    for (const [at, offset] of offsets.entries()) expect(offset < 3, `island ${at}`).toBe(at % 2 === 0);
    expect(isleOffset(6)).toBe(isleOffset(0));
    expect(isleOffset(-1)).toBe(isleOffset(5));
  });

  it('floats each island on its own clock, tilting the other way from its neighbour', () => {
    const [a, b] = [isleSway(0), isleSway(1)];
    for (const sway of [a, b]) {
      expect(sway.time).toBeGreaterThanOrEqual(5);
      expect(sway.time).toBeLessThanOrEqual(8);
      expect(sway.delay).toBeLessThanOrEqual(0);
      expect(sway.delay).toBeGreaterThanOrEqual(-6);
    }
    expect(a.time).not.toBe(b.time);
    expect(Math.sign(a.tilt)).toBe(-Math.sign(b.tilt));
    expect(isleSway(3)).toEqual(isleSway(3));
  });

  it('lags an island by its distance from the middle of the screen, never more than the cap', () => {
    expect(isleDrift(0)).toBe(0);
    expect(isleDrift(100)).toBe(-5);
    expect(isleDrift(-100)).toBe(5);
    expect(isleDrift(5000)).toBe(-24);
    expect(isleDrift(-5000)).toBe(24);
  });
});
