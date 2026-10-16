import { describe, expect, it } from 'vitest';
import { REST_BAND, morphState } from '@/ui/explore/morph';

describe('morphState', () => {
  it('shows a solid dish when the scroll rests on a scene', () => {
    expect(morphState(0, 5)).toEqual({ from: 0, to: 1, t: 0, resting: 0 });
    expect(morphState(2, 5)).toEqual({ from: 2, to: 3, t: 0, resting: 2 });
  });

  it('keeps the dish solid inside a small band around each scene', () => {
    expect(morphState(2 + REST_BAND / 2, 5).resting).toBe(2);
    expect(morphState(3 - REST_BAND / 2, 5).resting).toBe(3);
  });

  it('puts grains in flight between two scenes, halfway at the midpoint', () => {
    const mid = morphState(1.5, 5);
    expect(mid.resting).toBeNull();
    expect(mid.from).toBe(1);
    expect(mid.to).toBe(2);
    expect(mid.t).toBeCloseTo(0.5, 9);
  });

  it('moves the melt forward steadily as the scroll moves forward', () => {
    let last = -1;
    for (let p = 1 + REST_BAND + 0.001; p < 2 - REST_BAND; p += 0.01) {
      const state = morphState(p, 5);
      expect(state.t).toBeGreaterThan(last);
      expect(state.t).toBeGreaterThanOrEqual(0);
      expect(state.t).toBeLessThanOrEqual(1);
      last = state.t;
    }
  });

  it('stays inside the scenes there are, even when the scroll overshoots', () => {
    expect(morphState(-2, 5)).toEqual({ from: 0, to: 1, t: 0, resting: 0 });
    expect(morphState(9, 5)).toEqual({ from: 4, to: 4, t: 0, resting: 4 });
    expect(morphState(4, 5)).toEqual({ from: 4, to: 4, t: 0, resting: 4 });
    expect(morphState(0.5, 1)).toEqual({ from: 0, to: 0, t: 0, resting: 0 });
  });
});
