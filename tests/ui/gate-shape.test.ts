import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { registeredAs } from './body-registry';
import { GateBody } from '@/ui/template/bodies/GateBody';
import { contrastRatio as contrast } from '@/lib/palette';

const css = () => readFileSync('src/ui/template/bodies/gate.css', 'utf8');

describe('the Ishtar Gate shape', () => {
  it('is registered as a body that sets the hero, the navigation, the cards and the headings', () => {
    expect(registeredAs('gate')).toBe(GateBody.name);
    expect(SHAPE_SETS.gate).toEqual(expect.arrayContaining(['hero', 'nav', 'card', 'heading']));
  });

  it('starts on its own preset after the earlier ones, on the themed-bab style', () => {
    const preset = TEMPLATES['the-ishtar-gate'];
    expect(TEMPLATE_IDS).toContain('the-ishtar-gate');
    expect(preset.number).toBe(TEMPLATE_IDS.indexOf('the-ishtar-gate') + 1);
    expect(preset.business).toBe('restaurant');
    expect(bodyOf(preset.layout)).toBe('gate');
    expect(preset.layout.hero).toBe('compact');
    expect(preset.scene.mode).toBe('static');
    expect(preset.palettes.length).toBeGreaterThanOrEqual(4);
    expect(templateForStyle('themed-bab')).toBe('the-ishtar-gate');
  });
});

describe('the poster palette', () => {
  it('starts on the poster colours: the lapis ground, the cream text, the gold accent', () => {
    const palette = TEMPLATES['the-ishtar-gate'].palette;
    expect(palette.bg.toLowerCase()).toBe('#163a7a');
    expect(palette.text.toLowerCase()).toBe('#fff3c4');
    expect(palette.accent.toLowerCase()).toBe('#e1b64a');
  });

  it('reads at 4.5:1 on every palette of the shape: the text on the ground and on the lapis card', () => {
    for (const palette of TEMPLATES['the-ishtar-gate'].palettes) {
      const colours = palette.palette;
      expect(contrast(colours.text, colours.bg), palette.id).toBeGreaterThanOrEqual(4.5);
      expect(contrast(colours.text, colours.card), palette.id).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('draws every colour from the palette: the stylesheet writes no colour literal but black and white', () => {
    const text = css().replace(/\/\*[\s\S]*?\*\//g, '').toLowerCase();
    const allowed = ['#000', '#fff'];
    for (const [literal] of text.matchAll(/#[0-9a-f]{3,8}/g)) expect(allowed, literal).toContain(literal);
  });
});

describe('the stylesheet', () => {
  it('scopes every rule under the shape and never loops: no infinite animation, no physical left/right properties', () => {
    const text = css();
    expect(text).not.toMatch(/infinite/);
    expect(text).not.toMatch(/(^|[\s;{])(padding|margin|border)-(left|right)\b|(^|[\s;{])(left|right)\s*:/m);
    const outside = text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((line) => /^[^\s@}\/].*\{$/.test(line) && !line.startsWith("[data-body='gate']"));
    expect(outside).toEqual([]);
  });

  it('parts the door leaves once in under five seconds, with translate only, and rests with less motion', () => {
    const text = css();
    expect(text).toMatch(/animation: gt-door 900ms[^;]*400ms both/);
    expect(text).toMatch(/@keyframes gt-door\s*\{[^@]*translate:/);
    expect(text).toMatch(/prefers-reduced-motion: reduce[\s\S]*gt-leaf[\s\S]*animation: none/);
  });

  it('puts hover inside the hover media query', () => {
    const text = css();
    for (const at of text.matchAll(/:hover/g)) expect(text.slice(0, at.index).lastIndexOf('@media (hover: hover)'), 'a :hover outside @media (hover: hover)').toBeGreaterThan(-1);
  });
});
