import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { registeredAs } from './body-registry';
import { boxNumber, MailboxesBody } from '@/ui/template/bodies/MailboxesBody';

describe('The Mailbox Wall shape', () => {
  it('is registered as a body that sets the hero, the navigation, the cards and the headings', () => {
    expect(registeredAs('mailboxes')).toBe(MailboxesBody.name);
    expect(SHAPE_SETS.mailboxes).toEqual(expect.arrayContaining(['hero', 'nav', 'card', 'heading']));
  });

  it('starts on its own preset after the earlier ones, on the layout-2-box style', () => {
    const preset = TEMPLATES['the-mailbox-wall'];
    expect(TEMPLATE_IDS).toContain('the-mailbox-wall');
    expect(preset.number).toBe(TEMPLATE_IDS.indexOf('the-mailbox-wall') + 1);
    expect(preset.business).toBe('restaurant');
    expect(bodyOf(preset.layout)).toBe('mailboxes');
    expect(preset.layout.hero).toBe('compact');
    expect(preset.scene.mode).toBe('static');
    expect(preset.palettes.length).toBeGreaterThanOrEqual(4);
    expect(templateForStyle('layout-2-box')).toBe('the-mailbox-wall');
  });

  it('numbers the boxes from 101 along the whole menu, one per dish', () => {
    expect(boxNumber(0)).toBe(101);
    expect(boxNumber(7)).toBe(108);
  });
});
