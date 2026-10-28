import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inRows, lensOffset, lensScale } from '@/ui/template/bodies/lens-depth';
import { LENS_MOTIFS, lensSide } from '@/ui/template/bodies/LensBody';
import { FRAME_MOTIFS } from '@/ui/template/bodies/FrameBody';

describe('the lens family', () => {
  it('measures a dish against the middle of the screen, in half-screens, held to -1..1', () => {
    expect(lensOffset(350, 100, 800)).toBe(0);
    expect(lensOffset(0, 0, 800)).toBe(-1);
    expect(lensOffset(800, 0, 800)).toBe(1);
    expect(lensOffset(150, 100, 800)).toBe(-0.5);
    expect(lensOffset(-500, 100, 800)).toBe(-1);
    expect(lensOffset(2000, 100, 800)).toBe(1);
    expect(lensOffset(10, 10, 0)).toBe(0);
    expect(Object.is(lensOffset(400, 0, 800), -0)).toBe(false);
  });

  it('never shrinks a dish below the least scale, and keeps it full size at the middle', () => {
    expect(lensScale(0, 0.82)).toBe(1);
    expect(lensScale(1, 0.82)).toBeCloseTo(0.82);
    expect(lensScale(-1, 0.82)).toBeCloseTo(0.82);
    expect(lensScale(5, 0.82)).toBeCloseTo(0.82);
    expect(lensScale(0.5, 0.82)).toBeCloseTo(0.955);
    for (let at = -1; at <= 1; at += 0.1) expect(lensScale(at, 0.82)).toBeGreaterThanOrEqual(0.82 - 1e-9);
  });

  it('puts the stamps three to a strip, the last strip short', () => {
    expect(inRows([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
    expect(inRows([], 3)).toEqual([]);
    expect(inRows([1, 2], 0)).toEqual([[1], [2]]);
  });

  it('hangs the dishes on alternate sides, the first at the start', () => {
    expect([0, 1, 2, 3].map(lensSide)).toEqual(['start', 'end', 'start', 'end']);
  });

  it('names one kind per style', () => {
    expect(LENS_MOTIFS).toEqual(['space-warp', 'space-worm', 'space-hole', 'bazaar', 'stamps']);
    expect(FRAME_MOTIFS).toEqual(['deco', 'marquee']);
  });

  it('bends a dish only while the lens runs, and never with less motion', () => {
    for (const kind of LENS_MOTIFS) {
      const css = readFileSync(join(process.cwd(), 'src/ui/template/bodies', `${kind}.css`), 'utf8');
      const bends = css
        .split('}')
        .filter((rule) => /\btransform:\s*(?!none)[^;]*var\(--l[vthm]/.test(rule))
        .map((rule) => rule.slice(0, rule.lastIndexOf('{')).trim());
      expect(bends.length, kind).toBeGreaterThan(0);
      for (const selector of bends) expect(selector, kind).toMatch(/\[data-lens\]/);
      expect(css, kind).toMatch(/prefers-reduced-motion: reduce/);
    }
  });
});
