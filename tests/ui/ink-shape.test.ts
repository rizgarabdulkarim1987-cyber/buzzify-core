import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { registeredAs } from './body-registry';
import { InkBody } from '@/ui/template/bodies/InkBody';
import { contrastRatio as contrast } from '@/lib/palette';
import { INK_BANDS, bandColour, inkOf, inkOn } from '@/ui/template/bodies/ink-bands';

describe('the Section Ink shape', () => {
  it('is registered as a body that sets the hero, the navigation, the cards and the headings', () => {
    expect(registeredAs('ink')).toBe(InkBody.name);
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

  describe('the inks', () => {
    it('has eight different colours, the mockup coral, amber, green and pink first, and neighbours (also when the set repeats) differ', () => {
      expect(new Set(INK_BANDS).size).toBe(INK_BANDS.length);
      expect(INK_BANDS.length).toBeGreaterThanOrEqual(8);
      expect(INK_BANDS.slice(0, 4)).toEqual(['#FF6B4A', '#FFC43D', '#4CD685', '#FF7EB6']);
      for (let at = 0; at < INK_BANDS.length * 2; at++) expect(bandColour(at)).not.toBe(bandColour(at + 1));
      expect(bandColour(INK_BANDS.length)).toBe(bandColour(0));
      expect(bandColour(-1)).toBe(INK_BANDS.at(-1));
    });

    it('picks, for every ink, a text colour that reads on it at 4.5:1', () => {
      for (const band of INK_BANDS) expect(contrast(inkOn(band), band), band).toBeGreaterThanOrEqual(4.5);
    });

    it('picks the better of white and near-black', () => {
      expect(inkOn('#FFFFFF')).toBe('#14141A');
      expect(inkOn('#000000')).toBe('#FFFFFF');
    });
  });

  describe('the ink on the palette', () => {
    it('keeps the mockup colours as they are on the default dark palette', () => {
      const { palette } = TEMPLATES['the-section-ink'].palettes[0]!;
      for (const band of INK_BANDS) expect(inkOf(band, palette).toUpperCase(), band).toBe(band);
    });

    it('reads at 4.5:1 on the background and the card of every palette of the shape', () => {
      for (const { id, palette } of TEMPLATES['the-section-ink'].palettes) {
        for (const band of INK_BANDS) {
          const ink = inkOf(band, palette);
          expect(contrast(ink, palette.bg), `${id} ${band} on the background`).toBeGreaterThanOrEqual(4.5);
          expect(contrast(ink, palette.raised), `${id} ${band} on the card`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  });
});
