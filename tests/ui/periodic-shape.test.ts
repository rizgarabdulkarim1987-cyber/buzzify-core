import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { registeredAs } from './body-registry';
import { elementSymbol, groupHue, PeriodicBody } from '@/ui/template/bodies/PeriodicBody';

describe('the Periodic Table shape', () => {
  it('is registered as a body that sets the hero, the navigation, the cards, the headings and the picture ratio', () => {
    expect(registeredAs('periodic')).toBe(PeriodicBody.name);
    expect(SHAPE_SETS.periodic).toEqual(expect.arrayContaining(['hero', 'nav', 'card', 'heading', 'imageRatio']));
  });

  it('starts on its own preset after the earlier ones, on the layout-per style', () => {
    const preset = TEMPLATES['the-periodic-table'];
    expect(TEMPLATE_IDS).toContain('the-periodic-table');
    expect(preset.number).toBe(TEMPLATE_IDS.indexOf('the-periodic-table') + 1);
    expect(preset.business).toBe('restaurant');
    expect(bodyOf(preset.layout)).toBe('periodic');
    expect(preset.layout.hero).toBe('compact');
    expect(preset.scene.mode).toBe('static');
    expect(preset.palettes.length).toBeGreaterThanOrEqual(4);
    expect(templateForStyle('layout-per')).toBe('the-periodic-table');
  });

  it('writes an element symbol: a capital and a small letter for Latin names, the first two letters otherwise', () => {
    expect(elementSymbol('Butter croissant')).toBe('Bu');
    expect(elementSymbol('éclair')).toBe('Éc');
    expect(elementSymbol('7 Up')).toBe('Up');
    expect(elementSymbol('X')).toBe('X');
    expect(elementSymbol('كرواسون بالزبدة')).toBe('كر');
    expect(elementSymbol('کرواسانی کەرە')).toBe('کر');
    expect(elementSymbol('   ')).toBe('·');
    expect(elementSymbol('😀 Smile')).toBe('Sm');
  });

  it('gives every group of a long menu a hue, spread around the wheel and repeating only after the wheel is full', () => {
    const hues = Array.from({ length: 8 }, (_, index) => groupHue(index));
    expect(new Set(hues).size).toBe(8);
    expect(groupHue(8)).toBe(groupHue(0));
    expect(groupHue(-1)).toBeGreaterThanOrEqual(0);
  });
});
