import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { BODIES } from '@/ui/template/bodies';
import { appHue, HomescreenBody } from '@/ui/template/bodies/HomescreenBody';

describe('Phone Home Screen shape', () => {
  it('is registered as a body that sets the hero, the navigation, the cards and the headings', () => {
    expect(BODIES.homescreen).toBe(HomescreenBody);
    expect(SHAPE_SETS.homescreen).toEqual(expect.arrayContaining(['hero', 'nav', 'card', 'heading']));
  });

  it('starts on its own preset after the earlier ones, on the layout-2-hom style', () => {
    const preset = TEMPLATES['the-phone-home-screen'];
    expect(TEMPLATE_IDS).toContain('the-phone-home-screen');
    expect(preset.number).toBe(TEMPLATE_IDS.indexOf('the-phone-home-screen') + 1);
    expect(preset.business).toBe('restaurant');
    expect(bodyOf(preset.layout)).toBe('homescreen');
    expect(preset.layout.hero).toBe('compact');
    expect(preset.scene.mode).toBe('static');
    expect(preset.palettes.length).toBeGreaterThanOrEqual(4);
    expect(templateForStyle('layout-2-hom')).toBe('the-phone-home-screen');
  });

  it('gives neighbouring dock icons different colours and repeats the set', () => {
    expect(appHue(0)).not.toBe(appHue(1));
    expect(appHue(0)).toBe(appHue(6));
  });
});
