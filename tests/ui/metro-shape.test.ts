import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { BODIES } from '@/ui/template/bodies';
import { MetroBody, stationHue } from '@/ui/template/bodies/MetroBody';

describe('the Metro Line shape', () => {
  it('is registered as a body that sets the hero, the navigation, the cards and the headings', () => {
    expect(BODIES.metro).toBe(MetroBody);
    expect(SHAPE_SETS.metro).toEqual(expect.arrayContaining(['hero', 'nav', 'card', 'heading']));
  });

  it('starts on its own preset after the earlier ones, on the layout-met style', () => {
    const preset = TEMPLATES['the-metro-line'];
    expect(TEMPLATE_IDS).toContain('the-metro-line');
    expect(preset.number).toBe(TEMPLATE_IDS.indexOf('the-metro-line') + 1);
    expect(preset.business).toBe('restaurant');
    expect(bodyOf(preset.layout)).toBe('metro');
    expect(preset.layout.hero).toBe('compact');
    expect(preset.scene.mode).toBe('static');
    expect(preset.palettes.length).toBeGreaterThanOrEqual(4);
    expect(templateForStyle('layout-met')).toBe('the-metro-line');
  });

  it('gives every station of a long line its own colour, repeating only after the set is used up', () => {
    const hues = Array.from({ length: 8 }, (_, index) => stationHue(index));
    expect(new Set(hues).size).toBe(8);
    expect(stationHue(8)).toBe(stationHue(0));
    expect(stationHue(-1)).toBeGreaterThanOrEqual(0);
  });
});
