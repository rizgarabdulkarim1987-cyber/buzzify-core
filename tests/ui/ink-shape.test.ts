import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { BODIES } from '@/ui/template/bodies';
import { InkBody } from '@/ui/template/bodies/InkBody';
import { INK_BANDS, INK_ON_PAPER, INK_PAPER, bandColour, contrast, inkOn } from '@/ui/template/bodies/ink-bands';

describe('the Section Ink shape', () => {
  it('is registered as a body that sets the hero, the navigation, the cards and the headings', () => {
    expect(BODIES.ink).toBe(InkBody);
    expect(SHAPE_SETS.ink).toEqual(expect.arrayContaining(['hero', 'nav', 'card', 'heading']));
  });

  it('starts on its own preset after the earlier ones, on the motion-ink style', () => {
    const preset = TEMPLATES['the-section-ink'];
    expect(TEMPLATE_IDS).toContain('the-section-ink');
    expect(preset.number).toBe(TEMPLATE_IDS.indexOf('the-section-ink') + 1);
    expect(preset.business).toBe('restaurant');
    expect(bodyOf(preset.layout)).toBe('ink');
    expect(preset.layout.hero).toBe('compact');
    expect(preset.scene.mode).toBe('static');
    expect(preset.palettes.length).toBeGreaterThanOrEqual(4);
    expect(templateForStyle('motion-ink')).toBe('the-section-ink');
  });

  describe('the bands', () => {
    it('has eight different colours, and neighbours (also when the set repeats) differ', () => {
      expect(new Set(INK_BANDS).size).toBe(INK_BANDS.length);
      expect(INK_BANDS.length).toBeGreaterThanOrEqual(8);
      for (let at = 0; at < INK_BANDS.length * 2; at++) expect(bandColour(at)).not.toBe(bandColour(at + 1));
      expect(bandColour(INK_BANDS.length)).toBe(bandColour(0));
      expect(bandColour(-1)).toBe(INK_BANDS.at(-1));
    });

    it('picks, for every band, a text colour that reads on it at 4.5:1', () => {
      for (const band of INK_BANDS) expect(contrast(inkOn(band), band), band).toBeGreaterThanOrEqual(4.5);
    });

    it('picks the better of white and near-black', () => {
      expect(inkOn('#FFFFFF')).toBe(INK_ON_PAPER);
      expect(inkOn('#000000')).toBe('#FFFFFF');
    });

    it('keeps the dish text on paper-white at a safe ratio', () => {
      expect(contrast(INK_ON_PAPER, INK_PAPER)).toBeGreaterThanOrEqual(7);
    });
  });
});
