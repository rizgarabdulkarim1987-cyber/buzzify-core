import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { glintDelay, souqHue, tagTilt, VITRINE_MOTIFS, vitrineNoise } from '@/ui/template/bodies/VitrineBody';
import { SHAPE_HUES } from '@/ui/template/bodies/shared/hue';

describe('the vitrine family', () => {
  it('has five motifs, each its own kind', () => {
    expect(VITRINE_MOTIFS).toEqual(['wash', 'jewel', 'apoth', 'qays', 'clay']);
  });

  it('gives every dish a steady noise in [0, 1)', () => {
    for (const seed of [0, 1, 2, 97, 1000]) {
      const value = vitrineNoise(seed);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      expect(vitrineNoise(seed)).toBe(value);
    }
  });

  it('staggers the glint of the jars within one six-second pass, already on its way', () => {
    const delays = [1, 2, 3, 4, 5, 6].map(glintDelay);
    for (const delay of delays) {
      expect(delay).toBeLessThanOrEqual(0);
      expect(delay).toBeGreaterThan(-6);
    }
    expect(new Set(delays).size).toBeGreaterThan(3);
  });

  it('tilts every price tag back, between -15 and -6 degrees', () => {
    for (let seed = 1; seed < 40; seed++) {
      const tilt = tagTilt(seed);
      expect(tilt).toBeLessThanOrEqual(-6);
      expect(tilt).toBeGreaterThanOrEqual(-15);
    }
    expect(new Set([1, 2, 3, 4, 5].map(tagTilt)).size).toBeGreaterThan(1);
  });

  it('colours each souq by its place in the full menu, wrapping round the hue set', () => {
    expect(souqHue(0)).toBe(SHAPE_HUES[0]);
    expect(souqHue(1)).toBe(SHAPE_HUES[1]);
    expect(souqHue(SHAPE_HUES.length)).toBe(SHAPE_HUES[0]);
  });

  it('scopes each motif sheet under its own kind, and the shared sheet under the family', () => {
    const dir = join(process.cwd(), 'src/ui/template/bodies');
    const rules = (file: string) => {
      const css = readFileSync(join(dir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      return [...css.matchAll(/([^{}]+)\{/g)]
        .map(([, selectors]) => selectors!.trim())
        .filter((rule) => !/^(from|to|\d+%)/.test(rule) && !rule.startsWith('@'))
        .flatMap((rule) => rule.split(/,(?![^(]*\))/).map((selector) => selector.trim()));
    };
    for (const motif of VITRINE_MOTIFS) {
      for (const selector of rules(`vitrine-${motif}.css`)) expect(selector, `vitrine-${motif}.css`).toMatch(new RegExp(`^\\[data-body='${motif}'\\]`));
    }
    for (const selector of rules('vitrine.css')) expect(selector, 'vitrine.css').toMatch(/^(:is\(\[data-body='|\[data-body=')/);
  });
});
