import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { BODIES } from '@/ui/template/bodies';
import { CarpetBody } from '@/ui/template/bodies/CarpetBody';
import { contrastRatio as contrast } from '@/lib/palette';
import { CARPET, WEAVES, weaveOf } from '@/ui/template/bodies/carpet-night';

describe('the One Thousand and One Nights shape', () => {
  it('is registered as a body that sets the hero, the navigation, the cards and the headings', () => {
    expect(BODIES.carpet).toBe(CarpetBody);
    expect(SHAPE_SETS.carpet).toEqual(expect.arrayContaining(['hero', 'nav', 'card', 'heading']));
  });

  it('starts on its own preset after the earlier ones, on the kurd-arab-lyl style', () => {
    const preset = TEMPLATES['the-thousand-and-one-nights'];
    expect(TEMPLATE_IDS).toContain('the-thousand-and-one-nights');
    expect(preset.number).toBe(TEMPLATE_IDS.indexOf('the-thousand-and-one-nights') + 1);
    expect(preset.business).toBe('restaurant');
    expect(bodyOf(preset.layout)).toBe('carpet');
    expect(preset.layout.hero).toBe('compact');
    expect(preset.scene.mode).toBe('static');
    expect(preset.palettes.length).toBeGreaterThanOrEqual(4);
    expect(templateForStyle('kurd-arab-lyl')).toBe('the-thousand-and-one-nights');
  });
});

describe('the carpets', () => {
  it('weaves each carpet from a cycle of a few colourways, the same one for the same place', () => {
    const picked = Array.from({ length: 30 }, (_, at) => weaveOf(at));
    expect(new Set(picked).size).toBeGreaterThanOrEqual(3);
    expect(weaveOf(2)).toBe(weaveOf(2 + WEAVES.length));
    expect(weaveOf(-1)).toBe(WEAVES[WEAVES.length - 1]);
  });

  it('keeps every text on its fixed fill at 4.5:1: names on each weave and its thread, the section strip, the gold tags', () => {
    for (const weave of WEAVES) {
      expect(contrast(CARPET.ink, weave.base), weave.base).toBeGreaterThanOrEqual(4.5);
      expect(contrast(CARPET.ink, weave.thread), weave.thread).toBeGreaterThanOrEqual(4.5);
      expect(contrast(CARPET.gold, weave.thread), weave.thread).toBeGreaterThanOrEqual(4.5);
      expect(contrast(CARPET.tagInk, CARPET.tagFill)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(CARPET.goldInk, CARPET.gold)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(CARPET.tagInk, CARPET.tagFill)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(CARPET.chipInk, CARPET.chipFill)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(CARPET.chipInk, CARPET.stripBacking)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(CARPET.litInk, CARPET.litFill)).toBeGreaterThanOrEqual(4.5);
  });

  it('draws the focus ring in a colour that stands out from the strip and from every weave (3:1)', () => {
    expect(contrast(CARPET.ring, CARPET.stripBacking)).toBeGreaterThanOrEqual(3);
    expect(contrast(CARPET.ring, CARPET.chipFill)).toBeGreaterThanOrEqual(3);
    for (const weave of WEAVES) expect(contrast(CARPET.ring, weave.base), weave.base).toBeGreaterThanOrEqual(3);
  });
});
