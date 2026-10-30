import { describe, expect, it } from 'vitest';
import { knotFringe, sashWeave, wrapSide } from '@/ui/template/bodies/WrapBody';

describe('the wrap body (The Pshtwen)', () => {
  it('winds each wrap in from the other side of the one above, the first from the start', () => {
    expect([0, 1, 2, 3].map(wrapSide)).toEqual([1, -1, 1, -1]);
  });

  it('weaves neighbouring sashes differently, in three weaves', () => {
    expect([0, 1, 2, 3, 4, -1].map(sashWeave)).toEqual([0, 1, 2, 0, 1, 2]);
  });

  it('hangs the same fringe on the same knot, each tassel between 1.5 and 2.25rem', () => {
    expect(knotFringe(2)).toEqual(knotFringe(2));
    expect(knotFringe(2)).toHaveLength(7);
    for (const length of knotFringe(5)) {
      expect(length).toBeGreaterThanOrEqual(1.5);
      expect(length).toBeLessThanOrEqual(2.25);
    }
  });
});
