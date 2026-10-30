import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { registeredAs } from './body-registry';
import { FrostBody } from '@/ui/template/bodies/FrostBody';
import { contrastRatio as contrast } from '@/lib/palette';

const css = () => readFileSync('src/ui/template/bodies/frost.css', 'utf8');

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

describe('the poster palette', () => {
  it('starts on the poster colours: the night-blue ground, the white text, the blue accent', () => {
    const palette = TEMPLATES['the-frosted-window'].palette;
    expect(palette.bg.toLowerCase()).toBe('#1b2a4a');
    expect(palette.text.toLowerCase()).toBe('#ffffff');
    expect(palette.accent.toLowerCase()).toBe('#2e6cc8');
  });

  it('reads at 4.5:1 on every palette: the text on the ground, and the card ink with the darkened-accent price on the pale card', () => {
    for (const palette of TEMPLATES['the-frosted-window'].palettes) {
      const { bg, text, accent } = palette.palette;
      expect(contrast(text, bg), palette.id).toBeGreaterThanOrEqual(4.5);
      // The card is the text colour at 92% over the ground; the price is the accent at 40% over the ground.
      const mix = (a: string, b: string, share: number) => '#' + [1, 3, 5].map((at) => Math.round(parseInt(a.slice(at, at + 2), 16) * share + parseInt(b.slice(at, at + 2), 16) * (1 - share)).toString(16).padStart(2, '0')).join('');
      const card = mix(text, bg, 0.92);
      expect(contrast(bg, card), palette.id).toBeGreaterThanOrEqual(4.5);
      expect(contrast(mix(accent, bg, 0.4), card), palette.id).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('draws every colour from the palette: the stylesheet writes no colour literal but black, white and the fixed sale rose', () => {
    const text = css().replace(/\/\*[\s\S]*?\*\//g, '').toLowerCase();
    const allowed = ['#000', '#fff', '#7a0c2c'];
    for (const [literal] of text.matchAll(/#[0-9a-f]{3,8}/g)) expect(allowed, literal).toContain(literal);
  });
});

describe('the stylesheet', () => {
  it('scopes every rule under the shape and never loops: no infinite animation, no physical left/right properties', () => {
    const text = css();
    expect(text).not.toMatch(/infinite/);
    expect(text).not.toMatch(/(^|[\s;{])(padding|margin|border)-(left|right)\b|(^|[\s;{])(left|right)\s*:/m);
    const outside = text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((line) => /^[^\s@}\/].*\{$/.test(line) && !line.startsWith("[data-body='frost']"));
    expect(outside).toEqual([]);
  });

  it('drifts the snow down once in five seconds, with transform only, and rests with less motion', () => {
    const text = css();
    expect(text).toMatch(/animation: fr-snow 5s linear both/);
    expect(text).toMatch(/@keyframes fr-snow\s*\{[^@]*transform: translateY/);
    expect(text).toMatch(/prefers-reduced-motion: reduce[\s\S]*::before[\s\S]*animation: none/);
  });

  it('puts hover inside the hover media query', () => {
    const text = css();
    for (const at of text.matchAll(/:hover/g)) expect(text.slice(0, at.index).lastIndexOf('@media (hover: hover)'), 'a :hover outside @media (hover: hover)').toBeGreaterThan(-1);
  });
});
