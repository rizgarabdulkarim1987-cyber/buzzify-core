import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { registeredAs } from './body-registry';
import { BentoBody, trayColumns } from '@/ui/template/bodies/BentoBody';

describe('The Bento Box shape', () => {
  it('is registered as a body that sets the hero, the navigation, the cards and the headings', () => {
    expect(registeredAs('bento')).toBe(BentoBody.name);
    expect(SHAPE_SETS.bento).toEqual(expect.arrayContaining(['hero', 'nav', 'card', 'heading']));
  });

  it('starts on its own preset after the earlier ones, on the layout-2-bnt style', () => {
    const preset = TEMPLATES['the-bento-box'];
    expect(TEMPLATE_IDS).toContain('the-bento-box');
    expect(preset.number).toBe(TEMPLATE_IDS.indexOf('the-bento-box') + 1);
    expect(preset.business).toBe('restaurant');
    expect(bodyOf(preset.layout)).toBe('bento');
    expect(preset.layout.hero).toBe('compact');
    expect(preset.scene.mode).toBe('static');
    expect(preset.palettes.length).toBeGreaterThanOrEqual(4);
    expect(templateForStyle('layout-2-bnt')).toBe('the-bento-box');
  });

  it('lays a tray out three compartments across, two across for a section of two', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 12].map((count) => trayColumns(count))).toEqual([3, 3, 2, 3, 3, 3, 3, 3]);
  });
});
