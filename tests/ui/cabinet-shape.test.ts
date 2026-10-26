import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { BODIES } from '@/ui/template/bodies';
import { CabinetBody, firstOpen, toggleDrawer } from '@/ui/template/bodies/CabinetBody';

describe('the Drawer Cabinet shape', () => {
  it('is registered as a body that sets the hero, the navigation, the cards and the headings', () => {
    expect(BODIES.cabinet).toBe(CabinetBody);
    expect(SHAPE_SETS.cabinet).toEqual(expect.arrayContaining(['hero', 'nav', 'card', 'heading']));
  });

  it('starts on its own preset after the earlier ones, on the layout-cab style', () => {
    const preset = TEMPLATES['the-drawer-cabinet'];
    expect(TEMPLATE_IDS).toContain('the-drawer-cabinet');
    expect(preset.number).toBe(TEMPLATE_IDS.indexOf('the-drawer-cabinet') + 1);
    expect(preset.business).toBe('restaurant');
    expect(bodyOf(preset.layout)).toBe('cabinet');
    expect(preset.layout.hero).toBe('compact');
    expect(preset.scene.mode).toBe('static');
    expect(preset.palettes.length).toBeGreaterThanOrEqual(4);
    expect(templateForStyle('layout-cab')).toBe('the-drawer-cabinet');
  });

  it('lets several drawers be open at once, each toggling on its own', () => {
    const one = toggleDrawer(new Set<string>(), 'a');
    const two = toggleDrawer(one, 'b');
    expect([...two].sort()).toEqual(['a', 'b']);
    expect([...toggleDrawer(two, 'a')]).toEqual(['b']);
    expect(one.has('b')).toBe(false);
  });

  it('opens the first drawer, and more of them while fewer than four dishes show', () => {
    expect([...firstOpen([5, 2], ['a', 'b'])]).toEqual(['a']);
    expect([...firstOpen([3, 2, 4], ['a', 'b', 'c'])]).toEqual(['a', 'b']);
    expect([...firstOpen([1, 1, 1], ['a', 'b', 'c'])]).toEqual(['a', 'b', 'c']);
    expect([...firstOpen([], [])]).toEqual([]);
  });
});
