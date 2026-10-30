import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { registeredAs } from './body-registry';
import { matHue, TabletopBody } from '@/ui/template/bodies/TabletopBody';

describe('The Table from Above shape', () => {
  it('is registered as a body that sets the hero, the navigation, the cards and the headings', () => {
    expect(registeredAs('tabletop')).toBe(TabletopBody.name);
    expect(SHAPE_SETS.tabletop).toEqual(expect.arrayContaining(['hero', 'nav', 'card', 'heading']));
  });

  it('starts on its own preset after the earlier ones, on the layout-top style', () => {
    const preset = TEMPLATES['the-table-from-above'];
    expect(TEMPLATE_IDS).toContain('the-table-from-above');
    expect(preset.number).toBe(TEMPLATE_IDS.indexOf('the-table-from-above') + 1);
    expect(preset.business).toBe('restaurant');
    expect(bodyOf(preset.layout)).toBe('tabletop');
    expect(preset.layout.hero).toBe('compact');
    expect(preset.scene.mode).toBe('static');
    expect(preset.palettes.length).toBeGreaterThanOrEqual(4);
    expect(templateForStyle('layout-top')).toBe('the-table-from-above');
  });

  it('gives neighbouring placemats different colours and repeats the set', () => {
    expect(matHue(0)).not.toBe(matHue(1));
    expect(matHue(0)).toBe(matHue(6));
  });
});
