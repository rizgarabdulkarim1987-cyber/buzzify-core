import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { BODIES } from '@/ui/template/bodies';
import { BeachBody, towelLayout } from '@/ui/template/bodies/BeachBody';
import { contrastRatio as contrast } from '@/lib/palette';
import { BEACH, riseOf, towelOf } from '@/ui/template/bodies/beach-fills';

describe('the Summer Beach shape', () => {
  it('is registered as a body that sets the hero, the navigation, the cards and the headings', () => {
    expect(BODIES.beach).toBe(BeachBody);
    expect(SHAPE_SETS.beach).toEqual(expect.arrayContaining(['hero', 'nav', 'card', 'heading']));
  });

  it('starts on its own preset after the earlier ones, on the themed-sum style', () => {
    const preset = TEMPLATES['the-summer-beach'];
    expect(TEMPLATE_IDS).toContain('the-summer-beach');
    expect(preset.number).toBe(TEMPLATE_IDS.indexOf('the-summer-beach') + 1);
    expect(preset.number).toBe(64);
    expect(preset.business).toBe('restaurant');
    expect(bodyOf(preset.layout)).toBe('beach');
    expect(preset.layout.hero).toBe('compact');
    expect(preset.scene.mode).toBe('static');
    expect(preset.palettes.length).toBeGreaterThanOrEqual(4);
    expect(templateForStyle('themed-sum')).toBe('the-summer-beach');
  });
});

describe('the beach fills', () => {
  it('keeps every text on its fixed fill at 4.5:1: bands, chips, badges, towel label, price, sale chip, add', () => {
    for (const [ink, fill] of [
      [BEACH.ink, BEACH.sand],
      [BEACH.ink, BEACH.sea],
      [BEACH.ink, BEACH.cream],
      [BEACH.ink, BEACH.strip],
      [BEACH.deepInk, BEACH.deep],
      [BEACH.priceInk, BEACH.cream],
      [BEACH.saleInk, BEACH.sale],
      [BEACH.addInk, BEACH.add],
    ] as const) {
      expect(contrast(ink, fill), `${ink} on ${fill}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('draws the lit ring in the palette accent lifted towards white, standing out (3:1) from the deep chip whatever the accent is', () => {
    for (const accent of ['#000000', '#ffffff', '#ff0000', '#0000ff', '#00ff00', '#ff6b35', '#2b4fd8', '#7a1f1f']) {
      expect(contrast(riseOf(accent), BEACH.deep), accent).toBeGreaterThanOrEqual(3);
    }
  });

  it('draws the focus rings in colours that stand out (3:1) from what they sit on', () => {
    expect(contrast(BEACH.ink, BEACH.cream)).toBeGreaterThanOrEqual(3);
    expect(contrast(BEACH.deepInk, BEACH.deep)).toBeGreaterThanOrEqual(3);
    expect(contrast(BEACH.addInk, BEACH.add)).toBeGreaterThanOrEqual(3);
  });

  it('lays the towels out: pairs of landscape towels, the photo at the start and at the end by rows, a lone last towel across the row', () => {
    const lay = (total: number) => Array.from({ length: total }, (_, at) => towelLayout(at, total));
    expect(lay(1)).toEqual([{ wide: true, end: false }]);
    expect(lay(2).map((l) => [l.wide, l.end])).toEqual([[false, false], [false, false]]);
    expect(lay(3).map((l) => [l.wide, l.end])).toEqual([[false, false], [false, false], [true, true]]);
    expect(lay(7).map((l) => l.end)).toEqual([false, false, true, true, false, false, true]);
    expect(lay(7).filter((l) => l.wide)).toHaveLength(1);
    expect(lay(8).filter((l) => l.wide)).toHaveLength(0);
  });

  it('colours the towels in turns, four stripe hues', () => {
    expect(new Set([0, 1, 2, 3].map(towelOf)).size).toBe(4);
    expect(towelOf(4)).toBe(towelOf(0));
    expect(towelOf(-1)).toBe(towelOf(3));
  });

  it('keeps the stylesheet and the constants in step (every fill is written in both)', () => {
    const css = readFileSync('src/ui/template/bodies/beach.css', 'utf8').toLowerCase();
    for (const [name, value] of Object.entries(BEACH)) if (typeof value === 'string') expect(css, name).toContain(value.toLowerCase());
  });

  it('plays the wave drift once (no infinite animation), moves only transform, and uses no physical left/right properties', () => {
    const css = readFileSync('src/ui/template/bodies/beach.css', 'utf8');
    expect(css).not.toMatch(/infinite/);
    expect(css).toMatch(/@keyframes bc-drift/);
    expect(css).not.toMatch(/(^|[\s;{])(padding|margin|border)-(left|right)\b|(^|[\s;{])(left|right)\s*:/m);
    for (const [, property] of css.matchAll(/transition:\s*([a-z-]+)/g)) expect(['transform', 'opacity', 'background-color', 'none']).toContain(property);
  });
});
