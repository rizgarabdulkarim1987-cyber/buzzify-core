import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { registeredAs } from './body-registry';
import { CarpetBody } from '@/ui/template/bodies/CarpetBody';
import { contrastRatio as contrast } from '@/lib/palette';
import { WEAVES, carpetInks, carpetWeaveOf } from '@/ui/template/bodies/carpet-night';

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

describe('the carpets', () => {
  it('weaves each carpet from a cycle of a few colourways, the same one for the same place', () => {
    const picked = Array.from({ length: 30 }, (_, at) => carpetWeaveOf(at));
    expect(new Set(picked).size).toBeGreaterThanOrEqual(3);
    expect(carpetWeaveOf(2)).toBe(carpetWeaveOf(2 + WEAVES.length));
    expect(carpetWeaveOf(-1)).toBe(WEAVES[WEAVES.length - 1]);
  });

  it('keeps every text readable (4.5:1) on every weave, in every palette: names and the embroidered title', () => {
    for (const { id, palette } of TEMPLATES['the-thousand-and-one-nights'].palettes) {
      for (const weave of WEAVES) {
        const { ink, stitch } = carpetInks(weave, palette);
        expect(contrast(ink, weave.base), `${id} ${weave.base}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(ink, weave.thread), `${id} ${weave.thread}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(stitch, weave.thread), `${id} ${weave.thread}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(palette.onAccent, palette.accent), id).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.bg, palette.text), id).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps the palette text and accent on the default weaves (the default look is unchanged)', () => {
    const { palette } = TEMPLATES['the-thousand-and-one-nights'].palettes[0]!;
    for (const weave of WEAVES) {
      expect(carpetInks(weave, palette).ink).toBe(palette.text);
      expect(carpetInks(weave, palette).stitch).toBe(palette.accent);
    }
  });
});

describe('the colours come from the palette', () => {
  const css = readFileSync('src/ui/template/bodies/carpet.css', 'utf8');
  it('maps the night, the gold thread and the rolled carpets to palette tokens', () => {
    expect(css).toMatch(/--cp-sky:\s*var\(--bg\)/);
    expect(css).toMatch(/--cp-gold:\s*var\(--accent\)/);
    expect(css).toMatch(/--cp-chip-fill:\s*var\(--raised\)/);
  });

  it('writes no colour literal beyond the rolled carpet icon dyes and black shadows', () => {
    expect([...new Set((css.match(/#[0-9a-f]{3,8}\b/gi) ?? []).map((hex) => hex.toLowerCase()))].sort()).toEqual(['#000', '#7a2142', '#b3202a']);
    expect(css).not.toMatch(/rgb\((?!0 0 0|255 255 255)/);
  });
});
