import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { registeredAs } from './body-registry';
import { contrastRatio } from '@/lib/palette';
import { themeOf } from '@/lib/templates/palette';
import { appHue, HOMESCREEN_FILLS, homescreenFill, HomescreenBody } from '@/ui/template/bodies/HomescreenBody';

describe('Phone Home Screen shape', () => {
  it('is registered as a body that sets the hero, the navigation, the cards and the headings', () => {
    expect(registeredAs('homescreen')).toBe(HomescreenBody.name);
    expect(SHAPE_SETS.homescreen).toEqual(expect.arrayContaining(['hero', 'nav', 'card', 'heading']));
  });

  it('starts on its own preset after the earlier ones, on the layout-2-hom style', () => {
    const preset = TEMPLATES['the-phone-home-screen'];
    expect(TEMPLATE_IDS).toContain('the-phone-home-screen');
    expect(preset.number).toBe(TEMPLATE_IDS.indexOf('the-phone-home-screen') + 1);
    expect(preset.business).toBe('restaurant');
    expect(bodyOf(preset.layout)).toBe('homescreen');
    expect(preset.layout.hero).toBe('compact');
    expect(preset.scene.mode).toBe('static');
    expect(preset.palettes.length).toBeGreaterThanOrEqual(4);
    expect(templateForStyle('layout-2-hom')).toBe('the-phone-home-screen');
  });

  it('gives neighbouring dock icons different colours and repeats the set', () => {
    expect(appHue(0)).not.toBe(appHue(1));
    expect(appHue(0)).toBe(appHue(6));
  });

  it('carries its white text on surfaces dark enough for every palette and for a light accent picked in Customize', () => {
    // The wallpaper, the folder band (dish names), the label tile and its count, the dock and its strip: each the accent
    // mixed into a fixed dark, so a white, yellow or mint accent cannot wash them out.
    const palettes = TEMPLATES['the-phone-home-screen'].palettes.filter(({ palette }) => themeOf(palette.bg) === 'dark').map(({ palette }) => palette);
    const accents = [...palettes.map((palette) => palette.accent), '#FFFFFF', '#FFE45C', '#7CFFB2'];
    for (const palette of palettes) {
      for (const accent of accents) {
        for (const fill of Object.keys(HOMESCREEN_FILLS) as (keyof typeof HOMESCREEN_FILLS)[]) {
          expect(contrastRatio(palette.text, homescreenFill(fill, { ...palette, accent })), `${fill} on ${accent}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
    // The pairs: the price badge (button colours), the sale chip and the lit dock tile (text colour with the background as ink).
    const own = TEMPLATES['the-phone-home-screen'].palette;
    expect(contrastRatio(own.onButton, own.button)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(own.bg, own.text)).toBeGreaterThanOrEqual(4.5);
  });
});
