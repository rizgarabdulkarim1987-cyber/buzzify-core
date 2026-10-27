import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { registeredAs } from './body-registry';
import { TicketsBody } from '@/ui/template/bodies/TicketsBody';

describe('the Kitchen Ticket Rail shape', () => {
  it('is registered as a body that sets the hero, the navigation, the cards and the headings', () => {
    expect(registeredAs('tickets')).toBe(TicketsBody.name);
    expect(SHAPE_SETS.tickets).toEqual(expect.arrayContaining(['hero', 'nav', 'card', 'heading']));
  });

  it('starts on its own preset after the earlier ones, on the layout-tkt style', () => {
    const preset = TEMPLATES['the-kitchen-ticket-rail'];
    expect(TEMPLATE_IDS).toContain('the-kitchen-ticket-rail');
    expect(preset.number).toBe(TEMPLATE_IDS.indexOf('the-kitchen-ticket-rail') + 1);
    expect(preset.business).toBe('restaurant');
    expect(bodyOf(preset.layout)).toBe('tickets');
    expect(preset.layout.hero).toBe('compact');
    expect(preset.scene.mode).toBe('static');
    expect(preset.palettes.length).toBeGreaterThanOrEqual(4);
    expect(templateForStyle('layout-tkt')).toBe('the-kitchen-ticket-rail');
  });
});
