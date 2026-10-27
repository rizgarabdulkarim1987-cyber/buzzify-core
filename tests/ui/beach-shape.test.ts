import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { registeredAs } from './body-registry';
import { BeachBody } from '@/ui/template/bodies/BeachBody';
import { contrastRatio as contrast } from '@/lib/palette';

describe('the Summer Beach shape', () => {
  it('is registered as a body that sets the hero, the navigation, the cards and the headings', () => {
    expect(registeredAs('beach')).toBe(BeachBody.name);
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
  const css = readFileSync('src/ui/template/bodies/beach.css', 'utf8');

  it('keeps the page text readable (4.5:1) on the sky, the sand and the cards, and the orange add and pill readable, in every palette', () => {
    for (const { id, palette } of TEMPLATES['the-summer-beach'].palettes) {
      expect(contrast(palette.text, palette.bg), `${id} on the sky`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.text, palette.surface), `${id} on the sand`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.text, palette.card), `${id} on the card`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.onAccent, palette.accent), `${id} on the orange`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast('#ffffff', '#7a0c2c')).toBeGreaterThanOrEqual(4.5);
  });

  it('draws the cards from the card colour, the orange from the accent and the sky from the background', () => {
    expect(css).toMatch(/--bc-cream:\s*var\(--card\)/);
    expect(css).toMatch(/--bc-orange:\s*var\(--accent\)/);
    expect(css).toMatch(/--bc-sand:\s*var\(--surface\)/);
    expect(css).toMatch(/--bc-ink:\s*var\(--text\)/);
  });

  it('resolves the signature palette to the mockup colours (sky blue, sand, cream and deep sea ink)', () => {
    const palette = TEMPLATES['the-summer-beach'].palette;
    for (const [role, fill] of [['bg', '#bfeefc'], ['surface', '#ffe9b8'], ['card', '#fffdf7'], ['text', '#0d3b52']] as const) expect(palette[role].toLowerCase(), role).toBe(fill);
  });

  it('writes no colour literal but black, white, the fixed sale pair, the sun and the sea of the header', () => {
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, '').toLowerCase();
    const allowed = ['#000', '#fff', '#7a0c2c', '#ffffff', '#ffe066'];
    for (const [literal] of bare.matchAll(/#[0-9a-f]{3,8}/g)) expect(allowed, literal).toContain(literal);
  });

  it('moves the sun and the waves a few seconds only (no infinite animation), the cards by transform and opacity, and uses no physical left/right properties', () => {
    expect(css).not.toMatch(/infinite/);
    expect(css).toMatch(/@keyframes bc-spin/);
    expect(css).toMatch(/@keyframes bc-flow/);
    expect(css).not.toMatch(/(^|[\s;{])(padding|margin|border)-(left|right)\b|(^|[\s;{])(left|right)\s*:/m);
    for (const [, property] of css.matchAll(/transition:\s*([a-z-]+)/g)) expect(['transform', 'opacity', 'background-color', 'none']).toContain(property);
  });
});
