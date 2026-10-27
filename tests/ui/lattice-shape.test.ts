import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { registeredAs } from './body-registry';
import { LatticeBody } from '@/ui/template/bodies/LatticeBody';
import { contrastRatio as contrast } from '@/lib/palette';
import { WOOD } from '@/ui/template/bodies/lattice-wood';

describe('the Baghdad Shanashil shape', () => {
  it('is registered as a body that sets the hero, the navigation, the cards and the headings', () => {
    expect(registeredAs('lattice')).toBe(LatticeBody.name);
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
    // The description line and the names beside the window, on the pane's plaque; a lit chip's name on brass.
    expect(contrast(WOOD.creamSoft, WOOD.plaque)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(WOOD.brassInk, WOOD.brass)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the bay closed on every palette: the bracket or its carved rim stands out from the page (3:1)', () => {
    for (const palette of TEMPLATES['the-baghdad-shanashil'].palettes) {
      const bg = palette.palette.bg;
      expect(Math.max(contrast(WOOD.board, bg), contrast(WOOD.rim, bg)), palette.id).toBeGreaterThanOrEqual(3);
    }
  });

  it('draws the focus ring in a colour that stands out from the pane edge, the strip chip and the brass chip (3:1)', () => {
    expect(contrast(WOOD.ring, WOOD.edge)).toBeGreaterThanOrEqual(3);
    expect(contrast(WOOD.ring, WOOD.plaque)).toBeGreaterThanOrEqual(3);
    expect(contrast(WOOD.ring, WOOD.board)).toBeGreaterThanOrEqual(3);
    expect(contrast(WOOD.cream, WOOD.chip)).toBeGreaterThanOrEqual(3);
    expect(contrast(WOOD.brassInk, WOOD.brass)).toBeGreaterThanOrEqual(3);
  });

  it('keeps the stylesheet and the constants in step: each constant is declared by name (--sh-<name>) with the same value', () => {
    const css = readFileSync('src/ui/template/bodies/lattice.css', 'utf8');
    const declared = Object.fromEntries([...css.matchAll(/(--sh-[a-z-]+):\s*(#[0-9a-f]{3,8})\s*;/gi)].map((match) => [match[1], match[2]!.toLowerCase()]));
    for (const [name, hex] of Object.entries(WOOD)) {
      const property = `--sh-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
      expect(declared[property], property).toBe(hex.toLowerCase());
    }
  });
});

describe('the mashrabiya bands', () => {
  const css = readFileSync('src/ui/template/bodies/lattice.css', 'utf8');
  const tsx = readFileSync('src/ui/template/bodies/LatticeBody.tsx', 'utf8');

  it('is not a grid of window cells (the Erbil Citadel skeleton): one wide pane per band on a phone', () => {
    expect(css).not.toMatch(/\.sh-screen\s*\{[^}]*grid-template-columns:\s*repeat\((3|4|5|6), minmax\(0, 1fr\)\)/);
    expect(css).toMatch(/\.sh-screen\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)\s*;/);
    expect(tsx).not.toMatch(/sh-cell|data-cell/);
  });

  it('lays each pane out as an arched window beside a carved plaque, the window side alternating band by band', () => {
    expect(css).toMatch(/\.sh-pane\s*\{[^}]*grid-template-areas:\s*'window plaque'/);
    expect(css).toMatch(/\.sh-pane:nth-child\(even\)\s*\{[^}]*grid-template-areas:\s*'plaque window'/);
    expect(css).toMatch(/\.sh-photo\s*\{[^}]*border-start-start-radius/);
    expect(tsx).toContain('data-screen');
    expect(tsx).toContain('sh-plaque');
  });
});
