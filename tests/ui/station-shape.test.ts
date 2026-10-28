import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { registeredAs } from './body-registry';
import { StationBody } from '@/ui/template/bodies/StationBody';
import { contrastRatio as contrast } from '@/lib/palette';
import { riseOf } from '@/ui/template/bodies/shared/rise';

const css = () => readFileSync('src/ui/template/bodies/station.css', 'utf8');

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

describe('the poster palette', () => {
  it('starts on the poster colours: the dark space ground, the pale violet text, the violet accent', () => {
    const palette = TEMPLATES['the-space-station'].palette;
    expect(palette.bg.toLowerCase()).toBe('#07051a');
    expect(palette.text.toLowerCase()).toBe('#e8e6ff');
    expect(palette.accent.toLowerCase()).toBe('#9b8cff');
  });

  it('reads at 4.5:1 on every palette of the shape: the text, the lifted accent (price, tab names) on the ground', () => {
    for (const palette of TEMPLATES['the-space-station'].palettes) {
      const colours = palette.palette;
      expect(contrast(colours.text, colours.bg), palette.id).toBeGreaterThanOrEqual(4.5);
      expect(contrast(riseOf(colours.accent), colours.bg), palette.id).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('draws every colour from the palette: the stylesheet writes no colour literal but black, white and the fixed sale pair', () => {
    const text = css().replace(/\/\*[\s\S]*?\*\//g, '').toLowerCase();
    const allowed = ['#000', '#fff', '#ffb454', '#1a0f00'];
    for (const [literal] of text.matchAll(/#[0-9a-f]{3,8}/g)) expect(allowed, literal).toContain(literal);
  });
});

describe('the stylesheet', () => {
  it('scopes every rule under the shape and never loops: no infinite animation, no physical left/right properties', () => {
    const text = css();
    expect(text).not.toMatch(/infinite/);
    expect(text).not.toMatch(/(^|[\s;{])(padding|margin|border)-(left|right)\b|(^|[\s;{])(left|right)\s*:/m);
    const outside = text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((line) => /^[^\s@}\/].*\{$/.test(line) && !line.startsWith("[data-body='station']"));
    expect(outside).toEqual([]);
  });

  it('turns the orbit once in under five seconds, with transform only, and rests with less motion', () => {
    const text = css();
    expect(text).toMatch(/animation: st-orbit 4\.5s/);
    expect(text).toMatch(/@keyframes st-orbit\s*\{[^@]*transform: rotate/);
    expect(text).toMatch(/prefers-reduced-motion: reduce[\s\S]*st-orbit[\s\S]*animation: none/);
  });

  it('puts hover inside the hover media query', () => {
    const text = css();
    for (const at of text.matchAll(/:hover/g)) expect(text.slice(0, at.index).lastIndexOf('@media (hover: hover)'), 'a :hover outside @media (hover: hover)').toBeGreaterThan(-1);
  });
});
