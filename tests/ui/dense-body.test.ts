import { describe, expect, it } from 'vitest';
import { denseWide } from '@/ui/template/bodies/DenseBody';

describe('the dense body (Classifieds, Mission Control)', () => {
  it('makes the first ad of every five a display ad spanning two columns', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((at) => denseWide('ads', at, 7))).toEqual([true, false, false, false, false, true, false]);
  });

  it('has no display ad in a section of fewer than three dishes, and none in the control room', () => {
    expect(denseWide('ads', 0, 2)).toBe(false);
    expect([0, 1, 2, 5].some((at) => denseWide('space-ctrl', at, 9))).toBe(false);
  });
});
