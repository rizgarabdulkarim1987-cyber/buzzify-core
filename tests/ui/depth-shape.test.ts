import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { registeredAs } from './body-registry';
import { DepthBody } from '@/ui/template/bodies/DepthBody';
import { depthProgress } from '@/ui/template/bodies/useDepthShift';

describe('The Scroll Depth shape', () => {
  it('is registered as a body that sets the hero, the navigation, the cards and the headings', () => {
    expect(registeredAs('depth')).toBe(DepthBody.name);
    expect(SHAPE_SETS.depth).toEqual(expect.arrayContaining(['hero', 'nav', 'card', 'heading']));
  });

  it('starts on its own preset after the earlier ones, on the motion-dep style', () => {
    const preset = TEMPLATES['the-scroll-depth'];
    expect(TEMPLATE_IDS).toContain('the-scroll-depth');
    expect(preset.number).toBe(TEMPLATE_IDS.indexOf('the-scroll-depth') + 1);
    expect(preset.business).toBe('restaurant');
    expect(bodyOf(preset.layout)).toBe('depth');
    expect(preset.layout.hero).toBe('compact');
    expect(preset.scene.mode).toBe('static');
    expect(preset.palettes.length).toBeGreaterThanOrEqual(4);
    expect(templateForStyle('motion-dep')).toBe('the-scroll-depth');
  });

  it('measures how far a frame has crossed the screen: -1 as it enters at the bottom, 0 mid-way, +1 as it leaves at the top', () => {
    expect(depthProgress(800, 200, 800)).toBe(-1);
    expect(depthProgress(300, 200, 800)).toBeCloseTo(0, 5);
    expect(depthProgress(-200, 200, 800)).toBe(1);
    expect(depthProgress(2000, 200, 800)).toBe(-1);
    expect(depthProgress(-900, 200, 800)).toBe(1);
  });
});
