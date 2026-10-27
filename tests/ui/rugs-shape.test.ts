import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES, TEMPLATE_IDS } from '@/lib/templates';
import { templateForStyle } from '@/studio/styles/template-map';
import { registeredAs } from './body-registry';
import { RugsBody } from '@/ui/template/bodies/RugsBody';
import { contrastRatio as contrast } from '@/lib/palette';

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
  it('keeps the palette text readable (4.5:1) on the card ivory and the page in every palette, and the fixed pairs readable', () => {
    for (const { id, palette } of TEMPLATES['the-jajim-and-nowruz'].palettes) {
      expect(contrast(palette.text, palette.raised), id).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.text, palette.bg), id).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.onAccent, palette.accent), id).toBeGreaterThanOrEqual(4.5);
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

  it('writes only the rugs own dyes and the dusk scene as hex, and no palette token of its own', () => {
    const own = ['#23306b', '#2a1810', '#2f7d4a', '#e9a51b', '#ffffff'];
    const scene = ['#2b1a3d', '#8a3b2a', '#ffdc6b', '#ff7b1c', '#c2241b', '#fff2b0', '#ffb02e', '#ff9a1f', '#ffd36b'];
    const found = [...new Set((css.match(/#[0-9a-f]{3,8}\b/gi) ?? []).map((hex) => hex.toLowerCase()))].sort();
    expect(found).toEqual([...own, ...scene].sort());
  });
});
