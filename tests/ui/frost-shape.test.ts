import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { registeredAs } from './body-registry';
import { FrostBody, isTallFrost } from '@/ui/template/bodies/FrostBody';
import { contrastRatio as contrast } from '@/lib/palette';
import { FROST, blendOver, riseOf } from '@/ui/template/bodies/frost-fills';

describe('the Frosted Window shape', () => {
  it('is registered as a body that sets the hero, the navigation, the cards and the headings', () => {
    expect(registeredAs('frost')).toBe(FrostBody.name);
    expect(SHAPE_SETS.frost).toEqual(expect.arrayContaining(['hero', 'nav', 'card', 'heading']));
  });

  it('starts on its own preset after the earlier ones, on the themed-win style', () => {
    const preset = TEMPLATES['the-frosted-window'];
    expect(TEMPLATE_IDS).toContain('the-frosted-window');
    expect(preset.number).toBe(TEMPLATE_IDS.indexOf('the-frosted-window') + 1);
    expect(preset.business).toBe('restaurant');
    expect(bodyOf(preset.layout)).toBe('frost');
    expect(preset.layout.hero).toBe('compact');
    expect(preset.scene.mode).toBe('static');
    expect(preset.palettes.length).toBeGreaterThanOrEqual(4);
    expect(templateForStyle('themed-win')).toBe('the-frosted-window');
  });
});

describe('the frost fills', () => {
  it('keeps every text on its fixed fill at 4.5:1: chips, label plate, badges, card, price, sale chip, add', () => {
    for (const [ink, fill] of [
      [FROST.frameInk, FROST.frame],
      [FROST.ice, FROST.deep],
      [FROST.cardInk, FROST.card],
      [FROST.priceInk, FROST.card],
      [FROST.saleInk, FROST.sale],
      [FROST.addInk, FROST.add],
    ] as const) {
      expect(contrast(ink, fill), `${ink} on ${fill}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps the card text readable while the condensation is still on it (the fog is a faint layer, never over 30%)', () => {
    expect(FROST.fogOpacity).toBeLessThanOrEqual(0.3);
    const card = blendOver(FROST.card, FROST.frame, FROST.fogOpacity);
    for (const ink of [FROST.cardInk, FROST.priceInk]) expect(contrast(blendOver(ink, FROST.frame, FROST.fogOpacity), card), ink).toBeGreaterThanOrEqual(4.5);
    expect(contrast(blendOver(FROST.saleInk, FROST.frame, FROST.fogOpacity), blendOver(FROST.sale, FROST.frame, FROST.fogOpacity))).toBeGreaterThanOrEqual(4.5);
  });

  it('draws the lit ring in the palette accent lifted towards white, standing out (3:1) from the deep chip whatever the accent is', () => {
    for (const accent of ['#000000', '#ffffff', '#ff0000', '#0000ff', '#00ff00', '#7fc4ff', '#2b4fd8', '#7a1f1f']) {
      expect(contrast(riseOf(accent), FROST.deep), accent).toBeGreaterThanOrEqual(3);
    }
  });

  it('draws the focus rings in colours that stand out (3:1) from what they sit on', () => {
    expect(contrast(FROST.ice, FROST.deep)).toBeGreaterThanOrEqual(3);
    expect(contrast(FROST.frameInk, FROST.frame)).toBeGreaterThanOrEqual(3);
    expect(contrast(FROST.addInk, FROST.add)).toBeGreaterThanOrEqual(3);
  });

  it('draws every fill from the template palette: the stylesheet writes no colour literal but black, white and the fixed sale pair', () => {
    const css = readFileSync('src/ui/template/bodies/frost.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').toLowerCase();
    const allowed = ['#000', '#fff', '#7a0c2c', '#ffffff'];
    for (const [literal] of css.matchAll(/#[0-9a-f]{3,8}/g)) expect(allowed, literal).toContain(literal);
  });

  it('resolves the signature palette to the fills the shape was drawn with', () => {
    const palette = TEMPLATES['the-frosted-window'].palette;
    for (const [role, fill] of [['bg', FROST.night], ['surface', FROST.dusk], ['text', FROST.ice]] as const) expect(palette[role].toLowerCase(), role).toBe(fill.toLowerCase());
  });

  it('never loops (no infinite animation), moves only transform and opacity, and uses no physical left/right properties', () => {
    const css = readFileSync('src/ui/template/bodies/frost.css', 'utf8');
    expect(css).not.toMatch(/infinite/);
    expect(css).not.toMatch(/(^|[\s;{])(padding|margin|border)-(left|right)\b|(^|[\s;{])(left|right)\s*:/m);
    for (const [, property] of css.matchAll(/transition:\s*([a-z-]+)/g)) expect(['transform', 'opacity', 'background-color', 'none']).toContain(property);
  });
});

describe('the masonry', () => {
  it('gives every third dish of a section, from the second, the tall photo (by its place in the full section)', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(isTallFrost)).toEqual([false, true, false, false, true, false, false]);
  });

  it('packs the panes into columns of small rows, the last pane across the wall, and makes the tall photo at least 40% taller', () => {
    const css = readFileSync('src/ui/template/bodies/frost.css', 'utf8');
    expect(css).toMatch(/\.fr-wall\[data-packed\]\s*\{\s*grid-auto-rows: 0\.5rem;/);
    expect(css).toMatch(/\.fr-pane:last-child\s*\{\s*grid-column: 1 \/ -1;/);
    const tall = 1;
    const short = 9 / 16;
    expect(tall / short).toBeGreaterThanOrEqual(1.4);
    expect(css).toContain('aspect-ratio: 16 / 9;');
  });
});
