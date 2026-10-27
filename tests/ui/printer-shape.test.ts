import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { registeredAs } from './body-registry';
import { counterText, PRINT_MS, PrinterBody, sweepDelay } from '@/ui/template/bodies/PrinterBody';
import { contrastRatio as contrast } from '@/lib/palette';
import { PRINTER } from '@/ui/template/bodies/printer-fills';
import { MESSAGES } from '@/lib/messages';

describe('the 3D Printer shape', () => {
  it('is registered as a body that sets the hero, the navigation, the cards and the headings', () => {
    expect(registeredAs('printer')).toBe(PrinterBody.name);
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

  it('draws the focus rings in colours that stand out (3:1) from what they sit on', () => {
    expect(contrast(PRINTER.hot, PRINTER.panel)).toBeGreaterThanOrEqual(3);
    expect(contrast(PRINTER.chipInk, PRINTER.chip)).toBeGreaterThanOrEqual(3);
    expect(contrast(PRINTER.hotInk, PRINTER.hot)).toBeGreaterThanOrEqual(3);
  });

  it('writes the counter as a percentage in the menu numerals, and a check mark when the print is done', () => {
    expect(counterText(0, 'latn')).toBe('0%');
    expect(counterText(0.456, 'latn')).toBe('46%');
    expect(counterText(0.5, 'arab')).toBe('\u0665\u0660%');
    expect(counterText(1, 'latn')).toBe('\u2713');
    expect(counterText(1.4, 'arab')).toBe('\u2713');
  });

  it('staggers the printhead sweeps by a capped delay so every motion ends inside five seconds', () => {
    expect(sweepDelay(0)).toBe(0);
    expect(sweepDelay(3)).toBeGreaterThan(sweepDelay(2));
    expect(sweepDelay(500)).toBe(sweepDelay(6));
    expect(sweepDelay(500) + PRINT_MS).toBeLessThan(5000);
  });

  it('draws every fill from the template palette: the stylesheet writes no colour literal but black, white and the nozzle grey', () => {
    const css = readFileSync('src/ui/template/bodies/printer.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').toLowerCase();
    const allowed = ['#000', '#fff', '#c9ced4'];
    for (const [literal] of css.matchAll(/#[0-9a-f]{3,8}/g)) expect(allowed, literal).toContain(literal);
  });

  it('resolves the signature palette to the fills the shape was drawn with', () => {
    const palette = TEMPLATES['the-3d-printer'].palette;
    for (const [role, fill] of [['bg', PRINTER.bg], ['surface', PRINTER.panel], ['line', PRINTER.line], ['card', PRINTER.chip], ['text', PRINTER.ink], ['muted', PRINTER.muted], ['accent', PRINTER.hot]] as const) expect(palette[role].toLowerCase(), role).toBe(fill.toLowerCase());
  });

  it('prints once (no infinite animation), moves only transforms, and uses no physical left/right properties', () => {
    const css = readFileSync('src/ui/template/bodies/printer.css', 'utf8');
    expect(css).not.toMatch(/infinite/);
    expect(css).toMatch(/@keyframes pr-nozzle/);
    expect(css).not.toMatch(/(^|[\s;{])(padding|margin|border)-(left|right)\b|(^|[\s;{])(left|right)\s*:/m);
    for (const [, property] of css.matchAll(/transition:\s*([a-z-]+)/g)) expect(['transform', 'opacity', 'background-color', 'none']).toContain(property);
    for (const name of ['pr-nozzle', 'pr-nozzle-rtl']) {
      const keyframes = css.match(new RegExp('@keyframes ' + name + '\\s*\\{[\\s\\S]*?\\n\\}'))![0];
      for (const [, property] of keyframes.matchAll(/^\s+([a-z-]+):/gm)) expect(['transform']).toContain(property);
    }
  });

  it('lays a section out as dark cards two across (three on a wide screen) with a print bed under a sliding cover, armed only by the page', () => {
    const css = readFileSync('src/ui/template/bodies/printer.css', 'utf8');
    const tsx = readFileSync('src/ui/template/bodies/PrinterBody.tsx', 'utf8');
    expect(css).toMatch(/\.pr-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    expect(css).toMatch(/\.pr-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
    expect(css).toMatch(/\[data-armed\] \.pr-card\[data-print\] \.pr-cover\s*\{[^}]*translateY\(-100%\)/);
    expect(css).toMatch(/\[data-armed\] \.pr-cover\s*\{[^}]*transition:\s*transform 1600ms linear/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\[data-body='printer'\] \.pr-cover\s*\{\s*display:\s*none/);
    expect(tsx).toContain('data-pct');
    expect(tsx).not.toMatch(/pr-meter|pr-zrail|pr-plate/);
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
