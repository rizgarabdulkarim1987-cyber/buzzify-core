import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { registeredAs } from './body-registry';
import { islandShape, TreasureBody } from '@/ui/template/bodies/TreasureBody';

describe('Treasure Map shape', () => {
  it('is registered as a body that sets the hero, the navigation, the cards and the headings', () => {
    expect(registeredAs('treasure')).toBe(TreasureBody.name);
    expect(SHAPE_SETS.treasure).toEqual(expect.arrayContaining(['hero', 'nav', 'card', 'heading']));
  });

  it('starts on its own preset after the earlier ones, on the layout-2-map style', () => {
    const preset = TEMPLATES['the-treasure-map'];
    expect(TEMPLATE_IDS).toContain('the-treasure-map');
    expect(preset.number).toBe(TEMPLATE_IDS.indexOf('the-treasure-map') + 1);
    expect(preset.business).toBe('restaurant');
    expect(bodyOf(preset.layout)).toBe('treasure');
    expect(preset.layout.hero).toBe('compact');
    expect(preset.scene.mode).toBe('static');
    expect(preset.palettes.length).toBeGreaterThanOrEqual(4);
    expect(templateForStyle('layout-2-map')).toBe('the-treasure-map');
  });

  it('gives neighbouring islands different coasts and repeats the set', () => {
    expect(islandShape(0)).not.toBe(islandShape(1));
    expect(islandShape(0)).toBe(islandShape(5));
  });
});
