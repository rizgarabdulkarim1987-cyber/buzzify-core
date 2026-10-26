import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { BODIES } from '@/ui/template/bodies';
import { StackedBody } from '@/ui/template/bodies/StackedBody';
import { STACK_MAX, tabsStack } from '@/ui/template/bodies/stacked-tabs';

describe('the Stacked Sheets shape', () => {
  it('is registered as a body that sets the hero, the navigation, the cards and the headings', () => {
    expect(BODIES.stacked).toBe(StackedBody);
    expect(SHAPE_SETS.stacked).toEqual(expect.arrayContaining(['hero', 'nav', 'card', 'heading']));
  });

  it('starts on its own preset after the earlier ones, on the motion-stk style', () => {
    const preset = TEMPLATES['the-stacked-sheets'];
    expect(TEMPLATE_IDS).toContain('the-stacked-sheets');
    expect(preset.number).toBe(TEMPLATE_IDS.indexOf('the-stacked-sheets') + 1);
    expect(preset.business).toBe('restaurant');
    expect(bodyOf(preset.layout)).toBe('stacked');
    expect(preset.layout.hero).toBe('compact');
    expect(preset.scene.mode).toBe('static');
    expect(preset.palettes.length).toBeGreaterThanOrEqual(4);
    expect(templateForStyle('motion-stk')).toBe('the-stacked-sheets');
  });

  it('stacks the tabs of a menu with a few sections and keeps them in a rail beyond that', () => {
    expect(tabsStack(1)).toBe(true);
    expect(tabsStack(STACK_MAX)).toBe(true);
    expect(tabsStack(STACK_MAX + 1)).toBe(false);
    expect(tabsStack(24)).toBe(false);
    // Few enough that every tab (both stacks together) leaves most of a phone screen to the dishes.
    expect(STACK_MAX * 2.75 * 16).toBeLessThanOrEqual(844 * 0.35);
  });
});
