import { describe, expect, it } from 'vitest';
import { pingPong } from '@/motion/progress';

describe('pingPong', () => {
  it('travels from 0 to 1, holds, travels back and holds again', () => {
    expect(pingPong(0, 2, 1)).toBe(0);
    expect(pingPong(1, 2, 1)).toBeCloseTo(0.5);
    expect(pingPong(2, 2, 1)).toBe(1);
    expect(pingPong(2.5, 2, 1)).toBe(1);
    expect(pingPong(4, 2, 1)).toBeCloseTo(0.5);
    expect(pingPong(5, 2, 1)).toBe(0);
    expect(pingPong(5.5, 2, 1)).toBe(0);
  });

  it('eases: slow at both ends of a journey', () => {
    expect(pingPong(0.2, 2, 1)).toBeLessThan(0.1);
    expect(pingPong(1.8, 2, 1)).toBeGreaterThan(0.9);
  });

  it('repeats every two journeys and two holds', () => {
    for (const t of [0.3, 1.1, 2.7, 3.6, 5.2]) expect(pingPong(t + 6, 2, 1)).toBeCloseTo(pingPong(t, 2, 1));
  });

  it('stays at 0 before the start', () => {
    expect(pingPong(-3, 2, 1)).toBe(0);
  });
});
