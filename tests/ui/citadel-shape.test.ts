import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { registeredAs } from './body-registry';
import { CitadelBody } from '@/ui/template/bodies/CitadelBody';
import { contrastRatio as contrast } from '@/lib/palette';
import { roofOf, SKY, windowState } from '@/ui/template/bodies/citadel-skyline';

describe('the Erbil Citadel shape', () => {
  it('is registered as a body that sets the hero, the navigation, the cards and the headings', () => {
    expect(registeredAs('citadel')).toBe(CitadelBody.name);
    expect(SHAPE_SETS.citadel).toEqual(expect.arrayContaining(['hero', 'nav', 'card', 'heading']));
  });

  it('starts on its own preset after the earlier ones, on the kurd-arab-cit style', () => {
    const preset = TEMPLATES['the-erbil-citadel'];
    expect(TEMPLATE_IDS).toContain('the-erbil-citadel');
    expect(preset.number).toBe(TEMPLATE_IDS.indexOf('the-erbil-citadel') + 1);
    expect(preset.business).toBe('restaurant');
    expect(bodyOf(preset.layout)).toBe('citadel');
    expect(preset.layout.hero).toBe('compact');
    expect(preset.scene.mode).toBe('static');
    expect(preset.palettes.length).toBeGreaterThanOrEqual(4);
    expect(templateForStyle('kurd-arab-cit')).toBe('the-erbil-citadel');
  });
});

describe('the skyline windows', () => {
  it('lights the windows up to the section in view, and marks that one', () => {
    expect([0, 1, 2, 3].map((at) => windowState(at, 2))).toEqual(['lit', 'lit', 'active', 'dark']);
    expect(windowState(0, 0)).toBe('active');
  });

  it('is all dark until a section is known', () => {
    expect([0, 1].map((at) => windowState(at, -1))).toEqual(['dark', 'dark']);
  });

  it('gives each house a roof from a short cycle, the same one for the same place', () => {
    const roofs = Array.from({ length: 40 }, (_, at) => roofOf(at));
    expect(new Set(roofs).size).toBeGreaterThanOrEqual(4);
    expect(roofOf(7)).toBe(roofOf(7));
    expect(roofOf(25)).toBe(roofOf(25 % 8));
  });

  it('keeps the numerals and the caption readable on their fixed fills (4.5:1)', () => {
    expect(contrast(SKY.darkInk, SKY.darkPane)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(SKY.litInk, SKY.litPane)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(SKY.activeInk, SKY.activePane)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(SKY.caption, SKY.skyTop)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(SKY.caption, SKY.skyMid)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(SKY.ring, SKY.wall)).toBeGreaterThanOrEqual(3);
  });
});
