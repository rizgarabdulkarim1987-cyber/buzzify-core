import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { registeredAs } from './body-registry';
import { LanternsBody } from '@/ui/template/bodies/LanternsBody';
import { contrastRatio as contrast } from '@/lib/palette';
import { BUNTING, FLAGS, FLICKER_MS, FLICKER_TIMES, LANTERNS, SWAY_MS, SWAY_TIMES, flagColour, sceneEndsAt } from '@/ui/template/bodies/lanterns-night';

describe('the Ramadan Nights shape', () => {
  it('is registered as a body that sets the hero, the navigation, the cards and the headings', () => {
    expect(registeredAs('lanterns')).toBe(LanternsBody.name);
    expect(SHAPE_SETS.lanterns).toEqual(expect.arrayContaining(['hero', 'nav', 'card', 'heading']));
  });

  it('starts on its own preset after the earlier ones, on the kurd-arab-ram style', () => {
    const preset = TEMPLATES['the-ramadan-nights'];
    expect(TEMPLATE_IDS).toContain('the-ramadan-nights');
    expect(preset.number).toBe(TEMPLATE_IDS.indexOf('the-ramadan-nights') + 1);
    expect(preset.business).toBe('restaurant');
    expect(bodyOf(preset.layout)).toBe('lanterns');
    expect(preset.layout.hero).toBe('compact');
    expect(preset.scene.mode).toBe('static');
    expect(preset.palettes.length).toBeGreaterThanOrEqual(4);
    expect(templateForStyle('kurd-arab-ram')).toBe('the-ramadan-nights');
  });
});

describe('the lanterns scene', () => {
  it('hangs four lanterns on cords of different lengths, each inside the sky', () => {
    expect(LANTERNS).toHaveLength(4);
    expect(new Set(LANTERNS.map((lantern) => lantern.cord)).size).toBe(4);
    for (const lantern of LANTERNS) {
      expect(lantern.at).toBeGreaterThan(0);
      expect(lantern.at).toBeLessThan(95);
    }
  });

  it('hangs a bunting of twelve flags in four colours, in a cycle', () => {
    const flags = Array.from({ length: FLAGS }, (_, at) => flagColour(at));
    expect(flags).toHaveLength(12);
    expect(new Set(flags).size).toBe(BUNTING.length);
    expect(flagColour(-1)).toBe(BUNTING[BUNTING.length - 1]);
    expect(flagColour(BUNTING.length + 1)).toBe(flagColour(1));
  });

  it('is at rest within five seconds (the sway and the flicker are counted, not endless)', () => {
    expect(sceneEndsAt()).toBeLessThanOrEqual(5000);
    expect(SWAY_MS * SWAY_TIMES).toBeGreaterThan(0);
    expect(FLICKER_MS * FLICKER_TIMES).toBeGreaterThan(0);
  });

  it('draws the night from the palette (lanterns.css writes no colour literal) and keeps its pairs readable in every palette', () => {
    const css = readFileSync('src/ui/template/bodies/lanterns.css', 'utf8');
    expect((css.match(/#[0-9a-f]{3,8}/gi) ?? []).map((hex) => hex.toLowerCase())).toEqual([]);
    for (const { id, palette } of TEMPLATES['the-ramadan-nights'].palettes) {
      expect(contrast(palette.onAccent, palette.accent), id).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.text, palette.bg), id).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.text, palette.raised), id).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.accent, palette.bg), id).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('the add button and its hover', () => {
  it('draws its plus in on-accent on the accent (at rest and on hover) at 4.5:1 in every palette', () => {
    for (const { id, palette } of TEMPLATES['the-ramadan-nights'].palettes) expect(contrast(palette.onAccent, palette.accent), id).toBeGreaterThanOrEqual(4.5);
  });
});
