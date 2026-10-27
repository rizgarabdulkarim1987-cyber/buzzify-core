import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { registeredAs } from './body-registry';
import { StationBody } from '@/ui/template/bodies/StationBody';
import { contrastRatio as contrast } from '@/lib/palette';
import { HULL, ledOf } from '@/ui/template/bodies/station-hull';

describe('the Space Station shape', () => {
  it('is registered as a body that sets the hero, the navigation, the cards and the headings', () => {
    expect(registeredAs('station')).toBe(StationBody.name);
    expect(SHAPE_SETS.station).toEqual(expect.arrayContaining(['hero', 'nav', 'card', 'heading']));
  });

  it('starts on its own preset after the earlier ones, on the themed-spc style', () => {
    const preset = TEMPLATES['the-space-station'];
    expect(TEMPLATE_IDS).toContain('the-space-station');
    expect(preset.number).toBe(TEMPLATE_IDS.indexOf('the-space-station') + 1);
    expect(preset.business).toBe('restaurant');
    expect(bodyOf(preset.layout)).toBe('station');
    expect(preset.layout.hero).toBe('compact');
    expect(preset.scene.mode).toBe('static');
    expect(preset.palettes.length).toBeGreaterThanOrEqual(4);
    expect(templateForStyle('themed-spc')).toBe('the-space-station');
  });
});

describe('the hull, bezel and LED fills', () => {
  it('keeps every text on its fixed fill at 4.5:1: label plate, status bar, resting chip, sale chip', () => {
    expect(contrast(HULL.ice, HULL.plate)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(HULL.ice, HULL.bar)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(HULL.ice, HULL.deep)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(HULL.amberInk, HULL.amber)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(HULL.steelInk, HULL.steel)).toBeGreaterThanOrEqual(4.5);
  });

  it('draws the LED text in the palette accent lifted towards white, readable on the LED window whatever the accent is', () => {
    for (const accent of ['#000000', '#ffffff', '#ff0000', '#0000ff', '#00ff00', '#9b8cff', '#2b4fd8', '#7a1f1f']) {
      expect(contrast(ledOf(accent), HULL.deep), accent).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('draws the focus rings in colours that stand out (3:1) from what they sit on', () => {
    expect(contrast(HULL.ice, HULL.bar)).toBeGreaterThanOrEqual(3);
    expect(contrast(HULL.steelInk, HULL.steel)).toBeGreaterThanOrEqual(3);
    expect(contrast(HULL.ice, HULL.deep)).toBeGreaterThanOrEqual(3);
    expect(contrast(HULL.ice, HULL.hull)).toBeGreaterThanOrEqual(3);
  });

  it('draws every fill from the template palette: the stylesheet writes no colour literal but black, white and the fixed sale pair', () => {
    const css = readFileSync('src/ui/template/bodies/station.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').toLowerCase();
    const allowed = ['#000', '#fff', '#ffb454', '#1a0f00'];
    for (const [literal] of css.matchAll(/#[0-9a-f]{3,8}/g)) expect(allowed, literal).toContain(literal);
  });

  it('resolves the signature palette to the fills the shape was drawn with', () => {
    const palette = TEMPLATES['the-space-station'].palette;
    for (const [role, fill] of [['bg', HULL.space], ['surface', HULL.hull], ['line', HULL.hullEdge], ['card', HULL.plate], ['text', HULL.ice]] as const) expect(palette[role].toLowerCase(), role).toBe(fill.toLowerCase());
  });

  it('never loops: no infinite animation in the stylesheet, and no physical left/right properties', () => {
    const css = readFileSync('src/ui/template/bodies/station.css', 'utf8');
    expect(css).not.toMatch(/infinite/);
    expect(css).not.toMatch(/(^|[\s;{])(padding|margin|border)-(left|right)\b|(^|[\s;{])(left|right)\s*:/m);
  });
});
