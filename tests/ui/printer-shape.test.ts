import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { BODIES } from '@/ui/template/bodies';
import { layerNumber, PrinterBody, printedOf, sweepDelay } from '@/ui/template/bodies/PrinterBody';
import { contrastRatio as contrast } from '@/lib/palette';
import { riseOf } from '@/ui/template/bodies/beach-fills';
import { PRINTER } from '@/ui/template/bodies/printer-fills';
import { createTranslator } from '@/lib/i18n';
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

  it('counts the printed layers: all of them when nothing is armed, what has been seen otherwise, never more than the section holds', () => {
    expect(printedOf(null, 'a', 5)).toBe(5);
    expect(printedOf({ a: 2 }, 'a', 5)).toBe(2);
    expect(printedOf({ a: 9 }, 'a', 5)).toBe(5);
    expect(printedOf({}, 'a', 5)).toBe(0);
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

  it('says "n of N layers" in every language, with the plural forms of each', () => {
    const t = (locale: 'en' | 'ar' | 'ckb') => createTranslator(locale, MESSAGES);
    expect(t('en')('tpl.prn.layers', { count: 1, n: '1', total: '1' })).toBe('1 of 1 layer');
    expect(t('en')('tpl.prn.layers', { count: 5, n: '3', total: '5' })).toBe('3 of 5 layers');
    const ar = t('ar');
    const forms = new Set([0, 1, 2, 3, 11, 100].map((count) => ar('tpl.prn.layers', { count, n: '1', total: String(count) })));
    expect(forms.size).toBeGreaterThanOrEqual(5);
    expect(t('ckb')('tpl.prn.layers', { count: 4, n: '٢', total: '٤' })).toContain('٤');
  });
});
