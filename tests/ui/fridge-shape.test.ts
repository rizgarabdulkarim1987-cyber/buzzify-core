import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { BODIES } from '@/ui/template/bodies';
import { FridgeBody, shelfHue } from '@/ui/template/bodies/FridgeBody';

describe('The Fridge shape', () => {
  it('is registered as a body that sets the hero, the navigation, the cards and the headings', () => {
    expect(BODIES.fridge).toBe(FridgeBody);
    expect(SHAPE_SETS.fridge).toEqual(expect.arrayContaining(['hero', 'nav', 'card', 'heading']));
  });

  it('starts on its own preset after the earlier ones, on the layout-2-frg style', () => {
    const preset = TEMPLATES['the-fridge'];
    expect(TEMPLATE_IDS).toContain('the-fridge');
    expect(preset.number).toBe(TEMPLATE_IDS.indexOf('the-fridge') + 1);
    expect(preset.business).toBe('restaurant');
    expect(bodyOf(preset.layout)).toBe('fridge');
    expect(preset.layout.hero).toBe('compact');
    expect(preset.scene.mode).toBe('static');
    expect(preset.palettes.length).toBeGreaterThanOrEqual(4);
    expect(templateForStyle('layout-2-frg')).toBe('the-fridge');
  });

  it('gives neighbouring shelves different lid hues and repeats the set', () => {
    expect(shelfHue(0)).not.toBe(shelfHue(1));
    expect(shelfHue(0)).toBe(shelfHue(6));
  });
});
