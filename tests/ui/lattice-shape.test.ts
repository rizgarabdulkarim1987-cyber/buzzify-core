import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { registeredAs } from './body-registry';
import { LatticeBody } from '@/ui/template/bodies/LatticeBody';
import { contrastRatio as contrast } from '@/lib/palette';

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
  const css = readFileSync('src/ui/template/bodies/lattice.css', 'utf8');

  it('keeps every text readable in every palette: carved cream on the wood, the glass number, the brass tag', () => {
    for (const { id, palette } of TEMPLATES['the-baghdad-shanashil'].palettes) {
      // The wood is the text colour (lightened or darkened a little), the cream is the raised colour.
      expect(contrast(palette.raised, palette.text), id).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.onAccent, palette.accent), id).toBeGreaterThanOrEqual(4.5);
      // The bay stays closed: the wood board stands out from the page.
      expect(contrast(palette.text, palette.bg), id).toBeGreaterThanOrEqual(3);
    }
    expect(contrast('#2a1608', '#e2b04a')).toBeGreaterThanOrEqual(4.5);
  });

  it('draws the wood from the text colour and the glass from the accent, and writes only the brass as hex', () => {
    expect(css).toMatch(/--sh-board:\s*var\(--text\)/);
    expect(css).toMatch(/--sh-glass:\s*var\(--accent\)/);
    expect(css).toMatch(/--sh-cream:\s*var\(--raised\)/);
    expect((css.match(/#[0-9a-f]{3,8}\b/gi) ?? []).map((hex) => hex.toLowerCase()).sort()).toEqual(['#2a1608', '#e2b04a']);
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
