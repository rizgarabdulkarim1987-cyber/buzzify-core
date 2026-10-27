import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { registeredAs } from './body-registry';
import { MorphBody } from '@/ui/template/bodies/MorphBody';
import { MORPH_MS, morphCounter, morphStart, tileSpan } from '@/ui/template/bodies/morph-open';

describe('the Photo to Details shape', () => {
  it('is registered as a body that sets the hero, the navigation, the cards and the headings', () => {
    expect(registeredAs('morph')).toBe(MorphBody.name);
    expect(SHAPE_SETS.morph).toEqual(expect.arrayContaining(['hero', 'nav', 'card', 'heading']));
  });

  it('starts on its own preset after the earlier ones, on the motion-mor style', () => {
    const preset = TEMPLATES['the-photo-to-details'];
    expect(TEMPLATE_IDS).toContain('the-photo-to-details');
    expect(preset.number).toBe(TEMPLATE_IDS.indexOf('the-photo-to-details') + 1);
    expect(preset.business).toBe('restaurant');
    expect(bodyOf(preset.layout)).toBe('morph');
    expect(preset.layout.hero).toBe('compact');
    expect(preset.scene.mode).toBe('static');
    expect(preset.palettes.length).toBeGreaterThanOrEqual(4);
    expect(templateForStyle('motion-mor')).toBe('the-photo-to-details');
  });

  it('starts the grown photo as the tile: moved to it and scaled down to its size, from the top start corner', () => {
    const tile = { left: 20, top: 300, width: 160, height: 200 };
    const sheet = { left: 0, top: 40, width: 390, height: 244 };
    expect(morphStart(tile, sheet)).toBe(`translate(20px, 260px) scale(${160 / 390}, ${200 / 244})`);
    // Already in place: no move and no scaling.
    expect(morphStart(sheet, sheet)).toBe('translate(0px, 0px) scale(1, 1)');
    // A target with no size cannot be grown into.
    expect(morphStart(tile, { left: 0, top: 0, width: 0, height: 10 })).toBeNull();
  });

  it('keeps the picture unsquashed: the counter-scale inside makes its scale the same across and down, covering the tile', () => {
    // A short tile (2:1) grown into a 4:3 details photo.
    const tile = { left: 10, top: 300, width: 120, height: 60 };
    const sheet = { left: 0, top: 40, width: 390, height: 292 };
    const outer = { x: 120 / 390, y: 60 / 292 };
    const inner = morphCounter(tile, sheet)!.match(/scale\(([\d.]+), ([\d.]+)\)/)!.slice(1).map(Number) as [number, number];
    expect(outer.x * inner[0]).toBeCloseTo(outer.y * inner[1], 6);
    // The picture covers the tile: its scale is the larger of the two.
    expect(outer.x * inner[0]).toBeCloseTo(Math.max(outer.x, outer.y), 6);
    expect(morphCounter(sheet, sheet)).toBe('scale(1, 1)');
    expect(morphCounter(tile, { left: 0, top: 0, width: 0, height: 10 })).toBeNull();
  });

  it('grows the photo in well under half a second', () => {
    expect(MORPH_MS).toBeGreaterThanOrEqual(200);
    expect(MORPH_MS).toBeLessThanOrEqual(320);
  });

  it('alternates tall and short tiles so a row is never flat, short first', () => {
    const spans = Array.from({ length: 9 }, (_, at) => tileSpan(at));
    expect(new Set(spans).size).toBe(2);
    expect(spans[1]).toBeGreaterThan(spans[0]!);
    expect(spans[1]).toBeGreaterThan(spans[2]!);
    expect(spans[3]).toBe(spans[0]);
    expect(spans[4]).toBe(spans[1]);
  });
});
