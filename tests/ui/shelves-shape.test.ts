import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { BODIES } from '@/ui/template/bodies';
import { ShelvesBody } from '@/ui/template/bodies/ShelvesBody';

describe('the Supermarket Shelves shape', () => {
  it('is registered as a body that sets the hero, the navigation, the cards and the headings', () => {
    expect(BODIES.shelves).toBe(ShelvesBody);
    expect(SHAPE_SETS.shelves).toEqual(expect.arrayContaining(['hero', 'nav', 'card', 'heading']));
  });

  it('starts on its own preset after the earlier ones, on the layout-shf style', () => {
    const preset = TEMPLATES['the-supermarket-shelves'];
    expect(TEMPLATE_IDS).toContain('the-supermarket-shelves');
    expect(preset.number).toBe(TEMPLATE_IDS.indexOf('the-supermarket-shelves') + 1);
    expect(preset.business).toBe('restaurant');
    expect(bodyOf(preset.layout)).toBe('shelves');
    expect(preset.layout.hero).toBe('compact');
    expect(preset.scene.mode).toBe('static');
    expect(preset.palettes.length).toBeGreaterThanOrEqual(4);
    expect(templateForStyle('layout-shf')).toBe('the-supermarket-shelves');
  });
});
