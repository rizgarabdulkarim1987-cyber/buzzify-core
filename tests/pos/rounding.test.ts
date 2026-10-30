import { describe, expect, it } from 'vitest';
import { roundTo } from '@/server/domain/pos/rounding';

describe('roundTo', () => {
  it('leaves the total alone when the step is 0', () => {
    expect(roundTo(10_124, 0)).toEqual({ total: 10_124, rounding: 0 });
  });

  it('rounds to the nearest step, half up', () => {
    expect(roundTo(10_124, 250)).toEqual({ total: 10_000, rounding: -124 });
    expect(roundTo(10_125, 250)).toEqual({ total: 10_250, rounding: 125 });
    expect(roundTo(10_374, 250)).toEqual({ total: 10_250, rounding: -124 });
  });

  it('leaves a multiple of the step unchanged', () => {
    expect(roundTo(10_250, 250)).toEqual({ total: 10_250, rounding: 0 });
  });

  it('never rounds a zero bill', () => {
    expect(roundTo(0, 1000)).toEqual({ total: 0, rounding: 0 });
  });

  it('never turns a real bill into a free one', () => {
    expect(roundTo(100, 1000)).toEqual({ total: 1000, rounding: 900 });
  });
});
