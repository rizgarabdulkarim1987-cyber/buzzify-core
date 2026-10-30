import { describe, expect, it } from 'vitest';
import { edgeCodes, frameFlicker } from '@/ui/template/bodies/FilmBody';

describe('the filmstrip body (The Film Strip)', () => {
  it('numbers the frames along the whole reel, across the sections shown', () => {
    expect(edgeCodes([2, 0, 3])).toEqual([[1, 2], [], [3, 4, 5]]);
  });

  it('gives every frame its own steady flicker, the same for the same frame', () => {
    expect(frameFlicker(4)).toEqual(frameFlicker(4));
    expect(frameFlicker(4)).not.toEqual(frameFlicker(5));
    for (let seed = 1; seed < 40; seed++) {
      const { time, delay } = frameFlicker(seed);
      expect(time).toBeGreaterThanOrEqual(3);
      expect(time).toBeLessThanOrEqual(5.5);
      expect(delay).toBeLessThanOrEqual(0);
      expect(delay).toBeGreaterThanOrEqual(-5);
    }
  });
});
