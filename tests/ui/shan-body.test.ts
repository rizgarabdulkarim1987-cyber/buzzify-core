import { describe, expect, it } from 'vitest';
import { railProgress, shanSway } from '@/ui/template/bodies/ShanBody';

describe('the Baghdadi house (kind shan)', () => {
  it('moves the rail dot from the top of the house to its foot as the page comes down', () => {
    expect(railProgress(0, 3000, 800)).toBe(0);
    expect(railProgress(-1100, 3000, 800)).toBe(0.5);
    expect(railProgress(-2200, 3000, 800)).toBe(1);
    expect(railProgress(400, 3000, 800)).toBe(0);
    expect(railProgress(-9000, 3000, 800)).toBe(1);
  });

  it('keeps the dot at the top of a house shorter than the screen', () => {
    expect(railProgress(-10, 600, 800)).toBe(0);
  });

  it('sways each oriel on its own steady clock', () => {
    const sway = shanSway(7);
    expect(sway).toEqual(shanSway(7));
    expect(sway.time).toBeGreaterThanOrEqual(5);
    expect(sway.time).toBeLessThanOrEqual(8);
    expect(sway.delay).toBeLessThanOrEqual(0);
    expect(shanSway(8).time).not.toBe(sway.time);
  });
});
