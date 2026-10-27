import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { BODIES } from '@/ui/template/bodies';
import { LatticeBody } from '@/ui/template/bodies/LatticeBody';
import { contrastRatio as contrast } from '@/lib/palette';
import { WOOD } from '@/ui/template/bodies/lattice-wood';

describe('the Baghdad Shanashil shape', () => {
  it('is registered as a body that sets the hero, the navigation, the cards and the headings', () => {
    expect(BODIES.lattice).toBe(LatticeBody);
    expect(SHAPE_SETS.lattice).toEqual(expect.arrayContaining(['hero', 'nav', 'card', 'heading']));
  });

  it('starts on its own preset after the earlier ones, on the themed-shn style', () => {
    const preset = TEMPLATES['the-baghdad-shanashil'];
    expect(TEMPLATE_IDS).toContain('the-baghdad-shanashil');
    expect(preset.number).toBe(TEMPLATE_IDS.indexOf('the-baghdad-shanashil') + 1);
    expect(preset.business).toBe('restaurant');
    expect(bodyOf(preset.layout)).toBe('lattice');
    expect(preset.layout.hero).toBe('compact');
    expect(preset.scene.mode).toBe('static');
    expect(preset.palettes.length).toBeGreaterThanOrEqual(4);
    expect(templateForStyle('themed-shn')).toBe('the-baghdad-shanashil');
  });
});

describe('the wood and glass fills', () => {
  it('keeps every text on its fixed fill at 4.5:1: the board, the plaque, the brass tag, the glass, the lit glass', () => {
    expect(contrast(WOOD.cream, WOOD.board)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(WOOD.cream, WOOD.plaque)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(WOOD.brassInk, WOOD.brass)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(WOOD.cream, WOOD.glass)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(WOOD.litInk, WOOD.lit)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(WOOD.brassInk, WOOD.brass)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(WOOD.cream, WOOD.chip)).toBeGreaterThanOrEqual(4.5);
  });

  it('draws the focus ring in a colour that stands out from the pane edge, the strip chip and the brass chip (3:1)', () => {
    expect(contrast(WOOD.ring, WOOD.edge)).toBeGreaterThanOrEqual(3);
    expect(contrast(WOOD.ring, WOOD.plaque)).toBeGreaterThanOrEqual(3);
    expect(contrast(WOOD.ring, WOOD.board)).toBeGreaterThanOrEqual(3);
    expect(contrast(WOOD.cream, WOOD.chip)).toBeGreaterThanOrEqual(3);
    expect(contrast(WOOD.brassInk, WOOD.brass)).toBeGreaterThanOrEqual(3);
  });

  it('keeps the stylesheet and the constants in step (every fill is written in both)', () => {
    const css = readFileSync('src/ui/template/bodies/lattice.css', 'utf8').toLowerCase();
    for (const [name, hex] of Object.entries(WOOD)) expect(css, name).toContain(hex.toLowerCase());
  });
});
