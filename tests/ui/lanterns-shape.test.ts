import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { registeredAs } from './body-registry';
import { LanternsBody } from '@/ui/template/bodies/LanternsBody';
import { contrastRatio as contrast } from '@/lib/palette';
import { mix } from '@/lib/templates/palette';
import { DROPS, dropOf } from '@/ui/template/bodies/lanterns-night';

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

describe('the lanterns', () => {
  it('hang on strings of a few lengths that repeat, the same one for the same place', () => {
    const drops = Array.from({ length: 40 }, (_, at) => dropOf(at));
    expect(new Set(drops).size).toBeGreaterThanOrEqual(3);
    expect(dropOf(7)).toBe(dropOf(7));
    expect(dropOf(DROPS.length + 2)).toBe(dropOf(2));
    expect(dropOf(-1)).toBe(DROPS[DROPS.length - 1]);
  });

  it('draws the night from the palette (lanterns.css writes no colour literal but black shadows) and keeps its pairs readable in every palette', () => {
    const css = readFileSync('src/ui/template/bodies/lanterns.css', 'utf8');
    expect((css.match(/#[0-9a-f]{3,8}\b/gi) ?? []).map((hex) => hex.toLowerCase())).toEqual(['#000']);
    for (const { id, palette } of TEMPLATES['the-ramadan-nights'].palettes) {
      const dimPane = mix(palette.raised, palette.text, 0.12);
      expect(contrast(palette.text, dimPane), id).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.onAccent, palette.accent), id).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.text, palette.bg), id).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.accent, palette.bg), id).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('the add button and its hover', () => {
  it('draws its plus in on-accent on the accent (at rest and on hover) at 4.5:1 in every palette', () => {
    for (const { id, palette } of TEMPLATES['the-ramadan-nights'].palettes) expect(contrast(palette.onAccent, palette.accent), id).toBeGreaterThanOrEqual(4.5);
  });
});
