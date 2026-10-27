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

  it('keeps every text readable in every palette: carved cream on the wood, the glass number, the brass ink', () => {
    for (const { id, palette } of TEMPLATES['the-baghdad-shanashil'].palettes) {
      // The wood is the text colour, the cream is the raised colour; the price is the cream warmed a little (checked in the browser on every palette).
      expect(contrast(palette.raised, palette.text), id).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.onAccent, palette.accent), id).toBeGreaterThanOrEqual(4.5);
      // The wooden cards stand out from the page.
      expect(contrast(palette.text, palette.bg), id).toBeGreaterThanOrEqual(3);
    }
    expect(contrast('#2a1608', '#e2b04a')).toBeGreaterThanOrEqual(4.5);
  });

  it('draws the wood from the text colour and the glass from the accent, and writes as hex only the brass and the dusk sky of the header', () => {
    expect(css).toMatch(/--sh-board:\s*var\(--text\)/);
    expect(css).toMatch(/--sh-glass:\s*var\(--accent\)/);
    expect(css).toMatch(/--sh-cream:\s*var\(--raised\)/);
    const brass = ['#2a1608', '#e2b04a', '#c9a24a', '#e9c27a'];
    const sky = ['#0d3b5a', '#1f6d8a', '#ffe8a3', '#e9a51b', '#8a5a12'];
    expect([...new Set((css.match(/#[0-9a-f]{3,8}\b/gi) ?? []).map((hex) => hex.toLowerCase()))].sort()).toEqual([...brass, ...sky].sort());
  });
});

describe('the arched cards', () => {
  const css = readFileSync('src/ui/template/bodies/lattice.css', 'utf8');
  const tsx = readFileSync('src/ui/template/bodies/LatticeBody.tsx', 'utf8');

  it('lays dishes out as arched cards two across on a phone, with an arched brass-framed window', () => {
    expect(css).toMatch(/\.sh-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    expect(css).toMatch(/\.sh-card\s*\{[^}]*border-start-start-radius:\s*4\.375rem/);
    expect(css).toMatch(/\.sh-window\s*\{[^}]*border:\s*3px solid/);
    expect(tsx).toContain('sh-shutter');
  });

  it('opens the shutters once per card, only when the page arms them, and draws none with less motion', () => {
    expect(css).toMatch(/\[data-armed\] \.sh-card\[data-open\] \.sh-shutter\s*\{[^}]*transform:\s*rotateY\(var\(--sh-swing\)\)/);
    expect(css).toMatch(/\[data-armed\] \.sh-shutter\s*\{[^}]*transition:\s*transform/);
    expect(css.slice(css.indexOf('prefers-reduced-motion'))).toMatch(/\.sh-shutter\s*\{\s*display:\s*none/);
  });
});
