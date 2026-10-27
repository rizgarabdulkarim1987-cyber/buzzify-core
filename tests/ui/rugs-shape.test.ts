import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { registeredAs } from './body-registry';
import { RugsBody } from '@/ui/template/bodies/RugsBody';
import { contrastRatio as contrast } from '@/lib/palette';
import { WEAVES, rugWeaveOf } from '@/ui/template/bodies/rug-weave';
import { mix } from '@/lib/templates/palette';

describe('the Jajim and Nowruz shape', () => {
  it('is registered as a body that sets the hero, the navigation, the cards and the headings', () => {
    expect(registeredAs('rugs')).toBe(RugsBody.name);
    expect(SHAPE_SETS.rugs).toEqual(
      expect.arrayContaining(['hero', 'nav', 'card', 'heading']),
    );
  });

  it('starts on its own preset after the earlier ones, on the themed-kurd style', () => {
    const preset = TEMPLATES['the-jajim-and-nowruz'];
    expect(TEMPLATE_IDS).toContain('the-jajim-and-nowruz');
    expect(preset.number).toBe(
      TEMPLATE_IDS.indexOf('the-jajim-and-nowruz') + 1,
    );
    expect(preset.business).toBe('restaurant');
    expect(bodyOf(preset.layout)).toBe('rugs');
    expect(preset.layout.hero).toBe('compact');
    expect(preset.scene.mode).toBe('static');
    expect(preset.palettes.length).toBeGreaterThanOrEqual(4);
    expect(templateForStyle('themed-kurd')).toBe('the-jajim-and-nowruz');
  });
});

describe('the rugs', () => {
  it('weaves each rug from a cycle of four patterns and colourways, the same one for the same place', () => {
    expect(new Set(WEAVES.map((weave) => weave.pattern)).size).toBe(4);
    expect(rugWeaveOf(2)).toEqual(rugWeaveOf(2 + WEAVES.length));
    expect(rugWeaveOf(-1).index).toBe(WEAVES.length - 1);
  });

  it('keeps the palette text readable (4.5:1) on every field tint in every palette, and the fixed pairs readable', () => {
    for (const { id, palette } of TEMPLATES['the-jajim-and-nowruz'].palettes) {
      // The fields are tints of the raised colour (rug-weave.ts): the strongest is 25% of a dye.
      for (const dye of ['#E9A51B', palette.accent, '#9DB8F0']) expect(contrast(palette.text, mix(palette.raised, dye, 0.25)), `${id} ${dye}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.text, palette.raised), id).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.text, palette.bg), id).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast('#FFFFFF', '#2F7D4A')).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#2A1810', '#E9A51B')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the colours come from the palette', () => {
  const css = readFileSync('src/ui/template/bodies/rugs.css', 'utf8');
  it('maps ink, plate and red to palette tokens, and sets no palette token of its own', () => {
    expect(css).toMatch(/--rg-ink:\s*var\(--text\)/);
    expect(css).toMatch(/--rg-plate:\s*var\(--raised\)/);
    expect(css).toMatch(/--rg-red:\s*var\(--accent\)/);
    expect(css).not.toMatch(/^\s*--(bg|text|accent|on-accent|muted)\s*:/m);
  });

  it('writes only the rugs own dyes as hex (saffron, green, indigo and their inks)', () => {
    expect((css.match(/#[0-9a-f]{3,8}\b/gi) ?? []).map((hex) => hex.toLowerCase()).sort()).toEqual(['#23306b', '#2a1810', '#2f7d4a', '#e9a51b', '#ffffff']);
  });
});
