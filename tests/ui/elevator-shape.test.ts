import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { BODIES } from '@/ui/template/bodies';
import { ElevatorBody } from '@/ui/template/bodies/ElevatorBody';

describe('the Elevator shape', () => {
  it('is registered as a body that sets the hero, the navigation, the cards and the headings', () => {
    expect(BODIES.elevator).toBe(ElevatorBody);
    expect(SHAPE_SETS.elevator).toEqual(expect.arrayContaining(['hero', 'nav', 'card', 'heading']));
  });

  it('starts on its own preset after the earlier ones, on the layout-elv style', () => {
    const preset = TEMPLATES['the-elevator'];
    expect(TEMPLATE_IDS).toContain('the-elevator');
    expect(preset.number).toBe(TEMPLATE_IDS.indexOf('the-elevator') + 1);
    expect(preset.business).toBe('restaurant');
    expect(bodyOf(preset.layout)).toBe('elevator');
    expect(preset.layout.hero).toBe('compact');
    expect(preset.scene.mode).toBe('static');
    expect(preset.palettes.length).toBeGreaterThanOrEqual(4);
    expect(templateForStyle('layout-elv')).toBe('the-elevator');
  });
});
