import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { everyOpen, foldSplit, REVEAL_LINE, REVEAL_MOTIFS, revealDelay } from '@/ui/template/bodies/RevealBody';

describe('the reveal family', () => {
  it('opens every cover while a search or a filter leaves fewer dishes than the menu has', () => {
    expect(everyOpen(3, 20)).toBe(true);
    expect(everyOpen(0, 20)).toBe(true);
    expect(everyOpen(20, 20)).toBe(false);
  });

  it('prints the first two dishes on the paper top half and the rest on the folded half', () => {
    expect(foldSplit(['a', 'b', 'c', 'd', 'e'])).toEqual([['a', 'b'], ['c', 'd', 'e']]);
    expect(foldSplit(['a'])).toEqual([['a'], []]);
    expect(foldSplit([])).toEqual([[], []]);
  });

  it('opens a row across from its start, the next row starting over', () => {
    expect([0, 1, 2, 3, 4].map((at) => revealDelay(at, 3))).toEqual([0, 90, 180, 0, 90]);
    expect(revealDelay(5, 2, 100)).toBe(100);
    expect(revealDelay(4, 0)).toBe(0);
  });

  it('opens a little past the middle of the screen', () => {
    expect(REVEAL_LINE).toBeGreaterThan(0.5);
    expect(REVEAL_LINE).toBeLessThan(0.75);
  });

  it('draws a cover shut only on an armed page, on a cover not yet seen, and never while filtering', () => {
    const dir = join(process.cwd(), 'src/ui/template/bodies');
    for (const motif of REVEAL_MOTIFS) {
      const css = readFileSync(join(dir, `${motif}.css`), 'utf8');
      const shut = [...css.matchAll(/^([^{}\n]*:not\(\[data-open\]\)[^{}\n]*)\{/gm)].map((match) => match[1]!);
      expect(shut.length, motif).toBeGreaterThan(0);
      for (const selector of shut) expect(selector, motif).toContain(`[data-body='${motif}'][data-armed]:not([data-all])`);
      expect(css, motif).toMatch(/prefers-reduced-motion: reduce/);
    }
  });
});
