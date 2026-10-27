import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { registeredAs } from './body-registry';
import { CarpetBody } from '@/ui/template/bodies/CarpetBody';
import { contrastRatio as contrast } from '@/lib/palette';
import { mix } from '@/lib/templates/palette';

describe('the One Thousand and One Nights shape', () => {
  it('is registered as a body that sets the hero, the navigation, the cards and the headings', () => {
    expect(registeredAs('carpet')).toBe(CarpetBody.name);
    expect(SHAPE_SETS.carpet).toEqual(expect.arrayContaining(['hero', 'nav', 'card', 'heading']));
  });

  it('starts on its own preset after the earlier ones, on the kurd-arab-lyl style', () => {
    const preset = TEMPLATES['the-thousand-and-one-nights'];
    expect(TEMPLATE_IDS).toContain('the-thousand-and-one-nights');
    expect(preset.number).toBe(TEMPLATE_IDS.indexOf('the-thousand-and-one-nights') + 1);
    expect(preset.business).toBe('restaurant');
    expect(bodyOf(preset.layout)).toBe('carpet');
    expect(preset.layout.hero).toBe('compact');
    expect(preset.scene.mode).toBe('static');
    expect(preset.palettes.length).toBeGreaterThanOrEqual(4);
    expect(templateForStyle('kurd-arab-lyl')).toBe('the-thousand-and-one-nights');
  });
});

describe('the colours come from the palette', () => {
  const css = readFileSync('src/ui/template/bodies/carpet.css', 'utf8');
  it('maps the night, the gold and the pills to palette tokens', () => {
    expect(css).toMatch(/--cp-sky:\s*var\(--bg\)/);
    expect(css).toMatch(/--cp-gold:\s*var\(--accent\)/);
    expect(css).toMatch(/--cp-gold-ink:\s*var\(--on-accent\)/);
    expect(css).toMatch(/--cp-ink:\s*var\(--text\)/);
  });

  it('writes no colour literal beyond the flying carpet frame dye and black shadows', () => {
    expect([...new Set((css.match(/#[0-9a-f]{3,8}\b/gi) ?? []).map((hex) => hex.toLowerCase()))].sort()).toEqual(['#000', '#b3202a']);
    expect(css).not.toMatch(/rgb\((?!0 0 0|255 255 255)/);
  });

  it('keeps the palette gold readable on the night and its ink on the gold, in every palette', () => {
    for (const { id, palette } of TEMPLATES['the-thousand-and-one-nights'].palettes) {
      expect(contrast(palette.onAccent, palette.accent), id).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.bg, palette.text), id).toBeGreaterThanOrEqual(4.5);
      // The text on the sky (the section titles, the hero's name and price): the sky's lightest stop is the raised colour a little toward the text.
      const lightest = mix(palette.raised, palette.text, 0.06);
      expect(contrast(palette.accent, lightest), `${id} gold on the sky`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.text, lightest), `${id} text on the sky`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
