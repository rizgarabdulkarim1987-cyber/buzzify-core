import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { BODIES } from '@/ui/template/bodies';
import { layerNumber, PrinterBody, printedShare, sweepDelay } from '@/ui/template/bodies/PrinterBody';
import { contrastRatio as contrast } from '@/lib/palette';
import { riseOf } from '@/ui/template/bodies/shared/rise';
import { PRINTER } from '@/ui/template/bodies/printer-fills';
import { MESSAGES } from '@/lib/messages';

describe('the 3D Printer shape', () => {
  it('is registered as a body that sets the hero, the navigation, the cards and the headings', () => {
    expect(BODIES.printer).toBe(PrinterBody);
    expect(SHAPE_SETS.printer).toEqual(expect.arrayContaining(['hero', 'nav', 'card', 'heading']));
  });

  it('starts on its own preset after the earlier ones, on the themed-prn style', () => {
    const preset = TEMPLATES['the-3d-printer'];
    expect(TEMPLATE_IDS).toContain('the-3d-printer');
    expect(preset.number).toBe(TEMPLATE_IDS.indexOf('the-3d-printer') + 1);
    expect(preset.number).toBe(65);
    expect(preset.business).toBe('restaurant');
    expect(bodyOf(preset.layout)).toBe('printer');
    expect(preset.layout.hero).toBe('compact');
    expect(preset.scene.mode).toBe('static');
    expect(preset.palettes.length).toBeGreaterThanOrEqual(4);
    expect(templateForStyle('themed-prn')).toBe('the-3d-printer');
  });
});

describe('the printer fills', () => {
  it('keeps every text on its fixed fill at 4.5:1: slab, chips, code, pills, price, sale chip, add', () => {
    for (const [ink, fill] of [
      [PRINTER.ink, PRINTER.bg],
      [PRINTER.ink, PRINTER.panel],
      [PRINTER.muted, PRINTER.bg],
      [PRINTER.muted, PRINTER.panel],
      [PRINTER.chipInk, PRINTER.chip],
      [PRINTER.chipInk, PRINTER.strip],
      [PRINTER.ink, PRINTER.pill],
      [PRINTER.hot, PRINTER.bg],
      [PRINTER.hot, PRINTER.panel],
      [PRINTER.hotInk, PRINTER.hot],
    ] as const) {
      expect(contrast(ink, fill), `${ink} on ${fill}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('draws the lit rail and printhead in the palette accent lifted towards white, standing out (3:1) from the panel whatever the accent is', () => {
    for (const accent of ['#000000', '#ffffff', '#ff0000', '#0000ff', '#00ff00', '#ff7a1a', '#2b4fd8', '#7a1f1f']) {
      expect(contrast(riseOf(accent), PRINTER.panel), accent).toBeGreaterThanOrEqual(3);
      expect(contrast(riseOf(accent), PRINTER.bg), accent).toBeGreaterThanOrEqual(3);
    }
  });

  it('draws the focus rings in colours that stand out (3:1) from what they sit on', () => {
    expect(contrast(PRINTER.hot, PRINTER.panel)).toBeGreaterThanOrEqual(3);
    expect(contrast(PRINTER.chipInk, PRINTER.chip)).toBeGreaterThanOrEqual(3);
    expect(contrast(PRINTER.hotInk, PRINTER.hot)).toBeGreaterThanOrEqual(3);
  });

  it('numbers the layers from 001 and keeps the index three digits wide', () => {
    expect(layerNumber(0)).toBe('001');
    expect(layerNumber(11)).toBe('012');
    expect(layerNumber(999)).toBe('1000');
  });

  it('fills the Z rail with the printed share: the whole rail when nothing is armed, the seen share otherwise, never more than full', () => {
    expect(printedShare(false, 0, 5)).toBe(1);
    expect(printedShare(true, 2, 4)).toBe(0.5);
    expect(printedShare(true, 9, 5)).toBe(1);
    expect(printedShare(true, 0, 5)).toBe(0);
    expect(printedShare(true, 0, 0)).toBe(1);
  });

  it('staggers the printhead sweeps by a capped delay so every motion ends inside five seconds', () => {
    expect(sweepDelay(0)).toBe(0);
    expect(sweepDelay(3)).toBeGreaterThan(sweepDelay(2));
    expect(sweepDelay(500)).toBe(sweepDelay(6));
    expect(sweepDelay(500) + 1400).toBeLessThan(5000);
  });

  it('keeps the stylesheet and the constants in step (every fill is written in both)', () => {
    const css = readFileSync('src/ui/template/bodies/printer.css', 'utf8').toLowerCase();
    for (const [name, value] of Object.entries(PRINTER)) if (typeof value === 'string') expect(css, name).toContain(value.toLowerCase());
  });

  it('sweeps the printhead once (no infinite animation), moves only transform and opacity, and uses no physical left/right properties', () => {
    const css = readFileSync('src/ui/template/bodies/printer.css', 'utf8');
    expect(css).not.toMatch(/infinite/);
    expect(css).toMatch(/@keyframes pr-sweep/);
    expect(css).not.toMatch(/(^|[\s;{])(padding|margin|border)-(left|right)\b|(^|[\s;{])(left|right)\s*:/m);
    for (const [, property] of css.matchAll(/transition:\s*([a-z-]+)/g)) expect(['transform', 'opacity', 'background-color', 'none']).toContain(property);
    const keyframes = css.match(/@keyframes pr-sweep\s*\{[\s\S]*?\n\}/)![0];
    for (const [, property] of keyframes.matchAll(/^\s+([a-z-]+):/gm)) expect(['transform', 'opacity']).toContain(property);
  });

  it('lays a part out as a print bed: a ruler heading, a Z rail beside a two-across gridded plate (three on a wide screen), and no meter text', () => {
    const css = readFileSync('src/ui/template/bodies/printer.css', 'utf8');
    const tsx = readFileSync('src/ui/template/bodies/PrinterBody.tsx', 'utf8');
    expect(css).toMatch(/\.pr-bed\s*\{[^}]*grid-template-columns:\s*var\(--pr-rail\) minmax\(0, 1fr\)/);
    expect(css).toMatch(/\.pr-plate\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    expect(css).toMatch(/\.pr-plate\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
    expect(css).toMatch(/\.pr-zrail i\s*\{[^}]*scaleY\(var\(--pr-done/);
    expect(tsx).toContain('data-bed');
    expect(tsx).not.toMatch(/pr-meter/);
    expect(tsx).not.toMatch(/tpl\.prn\.layers/);
  });

  it('mirrors by direction alone: no html[dir] selectors and no physical transform origins', () => {
    const css = readFileSync('src/ui/template/bodies/printer.css', 'utf8');
    expect(css).not.toMatch(/html\[dir/);
    expect(css).toMatch(/:dir\(rtl\)/);
    expect(css).not.toMatch(/transform-origin:[^;]*\b(left|right)\b/);
  });

  it('no longer carries the "n of N layers" strings in any language', () => {
    for (const locale of ['en', 'ar', 'ckb'] as const) expect(Object.keys(MESSAGES[locale]).filter((key) => key.startsWith('tpl.prn.layers'))).toEqual([]);
  });
});
