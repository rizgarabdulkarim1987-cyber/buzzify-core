import { describe, expect, it } from 'vitest';
import { clipCut } from '@/ui/template/bodies/FloatBody';
import { FLOAT_LIMIT, FLOAT_TILT, floatClock, floatDepth, floatReach, floatSeed, floatShift, floatTilt } from '@/ui/template/bodies/float-motion';

const ids = Array.from({ length: 200 }, (_, at) => `product-${at}-${(at * 7919).toString(36)}`);

describe('the float body (Zero Gravity, Kilim, Pomegranate, Jamana, Clippings)', () => {
  it('gives every dish a steady seed in [0, 1), the same for the same key', () => {
    for (const id of ids) {
      const seed = floatSeed(id);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(1);
      expect(floatSeed(id)).toBe(seed);
    }
    expect(floatSeed('a', 1)).not.toBe(floatSeed('a', 2));
  });

  it('spreads the dishes over the three depths', () => {
    const depths = new Set(ids.map(floatDepth));
    expect([...depths].sort()).toEqual([0, 1, 2]);
  });

  it('keeps every tilt within the limit and every clock between five and eight seconds', () => {
    for (const id of ids) {
      expect(Math.abs(floatTilt(id))).toBeLessThanOrEqual(FLOAT_TILT);
      const { period, delay } = floatClock(id);
      expect(period).toBeGreaterThanOrEqual(5);
      expect(period).toBeLessThanOrEqual(8);
      expect(delay).toBeLessThanOrEqual(0);
      expect(delay).toBeGreaterThanOrEqual(-6);
    }
  });

  it('moves near dishes ahead of the scroll, far ones behind, the middle ones not at all, never past the limit', () => {
    expect(floatShift(50, 1)).toBe(0);
    expect(floatShift(50, 2)).toBeLessThan(0);
    expect(floatShift(50, 0)).toBeGreaterThan(0);
    for (const distance of [-5000, -400, 0, 400, 5000]) {
      for (const depth of [0, 1, 2] as const) expect(Math.abs(floatShift(distance, depth))).toBeLessThanOrEqual(FLOAT_LIMIT);
    }
  });

  it('keeps two neighbours in a column apart: what they reach together stays under the 2rem row gap', () => {
    const gap = 32;
    for (const [width, height] of [
      [100, 180],
      [170, 260],
      [220, 300],
    ]) {
      const { up, down } = floatReach(width, height);
      expect(up + down, `${width}x${height}`).toBeLessThan(gap);
    }
  });

  it('cuts the clippings in four sizes by place and four faces by dish', () => {
    expect([0, 1, 2, 3, 4].map((at) => clipCut('x', at).ratio)).toEqual([1.4, 1, 0.85, 1.2, 1.4]);
    const faces = new Set(ids.map((id) => clipCut(id, 0).face));
    expect([...faces].sort()).toEqual([0, 1, 2, 3]);
  });
});
