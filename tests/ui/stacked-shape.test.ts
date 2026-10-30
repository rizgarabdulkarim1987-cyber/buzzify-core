import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { registeredAs } from './body-registry';
import { StackedBody } from '@/ui/template/bodies/StackedBody';
import { coverProgress, litSheet, STACK_DOCK, STACK_HUES, stackHue, stickyTop } from '@/ui/template/bodies/stacked-sheets';

describe('the Stacked Sheets shape', () => {
  it('is registered as a body that sets the hero, the navigation, the cards and the headings', () => {
    expect(registeredAs('stacked')).toBe(StackedBody.name);
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

  it('gives neighbouring sheets different hues and repeats the set once it is used up', () => {
    for (let at = 1; at < STACK_HUES.length * 2; at++) expect(stackHue(at)).not.toBe(stackHue(at - 1));
    expect(stackHue(STACK_HUES.length)).toBe(stackHue(0));
    expect(stackHue(-1)).toBe(STACK_HUES[STACK_HUES.length - 1]);
  });

  it('sticks a sheet under the strip, and higher when it is taller than the screen so its foot can be reached', () => {
    expect(stickyTop(52, 844, 300)).toBe(52);
    expect(stickyTop(52, 844, 2000)).toBe(844 - 2000 - STACK_DOCK);
    // Exactly as tall as what fits: it still sticks under the strip.
    expect(stickyTop(52, 844, 844 - 52 - STACK_DOCK)).toBe(52);
  });

  it('measures how much of a sheet the next one has covered, from 0 to 1', () => {
    expect(coverProgress(500, 600, 300)).toBe(0);
    expect(coverProgress(500, 350, 300)).toBeCloseTo(0.5);
    expect(coverProgress(500, 100, 300)).toBe(1);
    expect(coverProgress(500, 100, 0)).toBe(0);
  });

  it('lights the last sheet whose top has reached the reading line, the first before any, the last at the end', () => {
    expect(litSheet([], 100, false)).toBe(0);
    expect(litSheet([300, 800, 1300], 100, false)).toBe(0);
    expect(litSheet([-400, 60, 600], 100, false)).toBe(1);
    expect(litSheet([-900, -400, 80], 100, false)).toBe(2);
    expect(litSheet([-900, -400, 300], 100, true)).toBe(2);
  });
});
