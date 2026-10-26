import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { BODIES } from '@/ui/template/bodies';
import { KineticBody } from '@/ui/template/bodies/KineticBody';
import { dishWords } from '@/ui/template/bodies/useRowEntrance';

describe('The Dancing Letters shape', () => {
  it('is registered as a body that sets the hero, the navigation, the cards and the headings', () => {
    expect(BODIES.kinetic).toBe(KineticBody);
    expect(SHAPE_SETS.kinetic).toEqual(expect.arrayContaining(['hero', 'nav', 'card', 'heading']));
  });

  it('starts on its own preset after the earlier ones, on the motion-kin style', () => {
    const preset = TEMPLATES['the-dancing-letters'];
    expect(TEMPLATE_IDS).toContain('the-dancing-letters');
    expect(preset.number).toBe(TEMPLATE_IDS.indexOf('the-dancing-letters') + 1);
    expect(preset.business).toBe('restaurant');
    expect(bodyOf(preset.layout)).toBe('kinetic');
    expect(preset.layout.hero).toBe('compact');
    expect(preset.scene.mode).toBe('static');
    expect(preset.palettes.length).toBeGreaterThanOrEqual(4);
    expect(templateForStyle('motion-kin')).toBe('the-dancing-letters');
  });

  it('splits a dish name into words only, never into letters (joined scripts stay joined)', () => {
    expect(dishWords('Pain au chocolat')).toEqual(['Pain', 'au', 'chocolat']);
    expect(dishWords('  Double   espresso ')).toEqual(['Double', 'espresso']);
    expect(dishWords('دجاج مشوي بالفحم')).toEqual(['دجاج', 'مشوي', 'بالفحم']);
    expect(dishWords('کەباب')).toEqual(['کەباب']);
    expect(dishWords('')).toEqual([]);
  });
});
