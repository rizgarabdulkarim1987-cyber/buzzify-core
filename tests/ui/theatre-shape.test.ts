import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { registeredAs } from './body-registry';
import { TheatreBody } from '@/ui/template/bodies/TheatreBody';

describe('The Curtain and Spotlight shape', () => {
  it('is registered as a body that sets the hero, the navigation, the cards and the headings', () => {
    expect(registeredAs('theatre')).toBe(TheatreBody.name);
    expect(SHAPE_SETS.theatre).toEqual(expect.arrayContaining(['hero', 'nav', 'card', 'heading']));
  });

  it('starts on its own preset after the earlier ones, on the motion-thr style', () => {
    const preset = TEMPLATES['the-curtain-and-spotlight'];
    expect(TEMPLATE_IDS).toContain('the-curtain-and-spotlight');
    expect(preset.number).toBe(TEMPLATE_IDS.indexOf('the-curtain-and-spotlight') + 1);
    expect(preset.business).toBe('restaurant');
    expect(bodyOf(preset.layout)).toBe('theatre');
    expect(preset.layout.hero).toBe('compact');
    expect(preset.scene.mode).toBe('static');
    expect(preset.palettes.length).toBeGreaterThanOrEqual(4);
    expect(templateForStyle('motion-thr')).toBe('the-curtain-and-spotlight');
  });
});
