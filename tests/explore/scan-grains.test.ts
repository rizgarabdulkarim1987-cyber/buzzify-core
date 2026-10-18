import { PlaneGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { sampleSurface } from '@/ui/explore/grains';

describe('sampleSurface', () => {
  // A 2 by 1 sheet whose texture is red on its left half and blue on its right.
  const sheet = () => new PlaneGeometry(2, 1, 8, 4);
  const colour = (u: number, _v: number, out: { r: number; g: number; b: number }) => {
    out.r = u < 0.5 ? 1 : 0;
    out.g = 0;
    out.b = u < 0.5 ? 0 : 1;
  };

  it('puts every grain on the surface, coloured by the texture where it lands', () => {
    const cloud = sampleSurface(sheet(), 2000, colour);
    expect(cloud.count).toBe(2000);
    let red = 0;
    for (let i = 0; i < cloud.count; i++) {
      const x = cloud.positions[i * 3]!;
      expect(Math.abs(x)).toBeLessThanOrEqual(1.0001);
      expect(Math.abs(cloud.positions[i * 3 + 1]!)).toBeLessThanOrEqual(0.5001);
      expect(cloud.positions[i * 3 + 2]).toBeCloseTo(0, 6);
      // The left half of the sheet is the left half of the texture.
      expect(cloud.colors[i * 3]).toBe(x < 0 ? 1 : 0);
      if (x < 0) red++;
      expect(cloud.alphas[i]).toBe(1);
    }
    expect(red / cloud.count).toBeGreaterThan(0.4);
    expect(red / cloud.count).toBeLessThan(0.6);
  });

  it('is deterministic, so the same model always melts the same way', () => {
    expect(Array.from(sampleSurface(sheet(), 300, colour).positions)).toEqual(Array.from(sampleSurface(sheet(), 300, colour).positions));
  });
});
