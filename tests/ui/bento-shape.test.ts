import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { BODIES } from '@/ui/template/bodies';
import { BentoBody, compartmentSizes, isSmallCompartment } from '@/ui/template/bodies/BentoBody';

describe('The Bento Box shape', () => {
  it('is registered as a body that sets the hero, the navigation, the cards and the headings', () => {
    expect(BODIES.bento).toBe(BentoBody);
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

  it('picks a compartment pattern for the number of dishes, repeating past six', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((n) => compartmentSizes(n))).toEqual([[], [1], [2], [3], [4], [5], [6]]);
    expect(compartmentSizes(7)).toEqual([4, 3]);
    expect(compartmentSizes(12)).toEqual([6, 6]);
    expect(compartmentSizes(13)).toEqual([6, 4, 3]);
    for (let n = 1; n < 60; n += 1) {
      const sizes = compartmentSizes(n);
      expect(sizes.reduce((a, b) => a + b, 0)).toBe(n);
      expect(sizes.every((size) => size >= 1 && size <= 6)).toBe(true);
      expect(sizes.filter((size) => size === 1).length).toBe(n === 1 ? 1 : 0);
    }
  });

  it('treats the one-row compartments as small (price on the name strip): all but the lead from a tray of three', () => {
    expect([0, 1].map((slot) => isSmallCompartment(1, slot))).toEqual([false, false]);
    expect([0, 1].map((slot) => isSmallCompartment(2, slot))).toEqual([false, false]);
    expect([0, 1, 2].map((slot) => isSmallCompartment(3, slot))).toEqual([false, true, true]);
    expect([0, 1, 2, 3, 4, 5].map((slot) => isSmallCompartment(6, slot))).toEqual([false, true, true, true, true, true]);
  });
});
