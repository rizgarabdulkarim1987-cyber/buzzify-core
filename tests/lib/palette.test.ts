import { describe, expect, it } from 'vitest';
import { DEFAULT_PALETTES, type Palette } from '@/lib/brand';
import { BRAND_PRESET_IDS, BRAND_PRESETS, contrastRatio, dominantColors, paletteProblems, suggestPalettes } from '@/lib/palette';

/** A picture as raw RGBA pixels: `share` of the pixels in each colour, in order. */
function pixels(parts: Array<[string, number]>, total = 1000): Uint8Array {
  const out = new Uint8Array(total * 4);
  let index = 0;
  for (const [hex, share] of parts) {
    const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
    for (let n = 0; n < Math.round(total * share); n++, index++) out.set([r!, g!, b!, 255], index * 4);
  }
  return out;
}

const hue = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};

describe('contrastRatio', () => {
  it('measures WCAG contrast', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
    expect(contrastRatio('#FFFFFF', '#777777')).toBeCloseTo(4.48, 2);
    expect(contrastRatio('#123456', '#123456')).toBe(1);
  });
});

describe('paletteProblems', () => {
  it('finds nothing wrong with the default palettes', () => {
    expect(paletteProblems(DEFAULT_PALETTES.light)).toEqual([]);
    expect(paletteProblems(DEFAULT_PALETTES.dark)).toEqual([]);
  });

  it('blocks muted text below 4.5:1 on the surface and names the pair', () => {
    const problems = paletteProblems({ ...DEFAULT_PALETTES.light, muted: '#999999' });
    expect(problems).toContainEqual({ foreground: 'muted', background: 'surface', ratio: 2.85, severity: 'block' });
    expect(problems).toContainEqual(expect.objectContaining({ foreground: 'muted', background: 'bg', severity: 'block' }));
  });

  it('blocks body text below 4.5:1 on the background', () => {
    expect(paletteProblems({ ...DEFAULT_PALETTES.light, bg: '#FFFFFF', text: '#777777' })).toContainEqual({
      foreground: 'text',
      background: 'bg',
      ratio: 4.48,
      severity: 'block',
    });
  });

  it('only warns for a weak accent', () => {
    const problems = paletteProblems({ ...DEFAULT_PALETTES.light, accent: '#E8D9B0' });
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.every((problem) => problem.severity === 'warn')).toBe(true);
    expect(problems.map((p) => `${p.foreground}/${p.background}`)).toEqual(['onAccent/accent', 'accent/bg', 'accent/surface']);
  });
});

describe('BRAND_PRESETS', () => {
  it.each(BRAND_PRESET_IDS.flatMap((id) => [[id, 'light'], [id, 'dark']] as const))('preset %s %s has no problem at all', (id, theme) => {
    expect(paletteProblems(BRAND_PRESETS[id][theme])).toEqual([]);
  });

  it('has a light and a dark palette for each of the five presets', () => {
    expect(BRAND_PRESET_IDS).toEqual(['luxury', 'coffee', 'bakery', 'fastFood', 'fineDining']);
  });
});

describe('dominantColors', () => {
  it('finds the two colours of a red and blue logo, red first', () => {
    expect(dominantColors(pixels([['#D32F2F', 0.7], ['#1565C0', 0.3]]), 4, 5)).toEqual(['#D32F2F', '#1565C0']);
  });

  it('ignores transparent pixels', () => {
    const image = pixels([['#1565C0', 0.4], ['#D32F2F', 0.6]]);
    for (let i = 400; i < 1000; i++) image[i * 4 + 3] = 0;
    expect(dominantColors(image, 4, 3)).toEqual(['#1565C0']);
  });

  it('merges colours too close to tell apart', () => {
    expect(dominantColors(pixels([['#D32F2F', 0.5], ['#D0302C', 0.3], ['#1565C0', 0.2]]), 4, 3)).toHaveLength(2);
  });

  it('reads three-channel pixels', () => {
    const rgb = new Uint8Array([10, 120, 200, 10, 120, 200]);
    expect(dominantColors(rgb, 3, 2)).toEqual(['#0A78C8']);
  });
});

describe('suggestPalettes', () => {
  const passes = (palette: Palette) => expect(paletteProblems(palette)).toEqual([]);

  it.each(['light', 'dark'] as const)('suggests three %s palettes that pass every pair', (theme) => {
    for (const colors of [['#808080'], ['#D32F2F'], ['#D32F2F', '#1565C0', '#2E7D32'], []]) {
      const palettes = suggestPalettes(colors, theme);
      expect(palettes).toHaveLength(3);
      palettes.forEach(passes);
    }
  });

  it('builds each palette around a different colour of the logo', () => {
    const [red, blue, green] = suggestPalettes(['#D32F2F', '#1565C0', '#2E7D32'], 'light');
    expect(Math.abs(hue(red!.accent) - hue('#D32F2F'))).toBeLessThan(15);
    expect(Math.abs(hue(blue!.accent) - hue('#1565C0'))).toBeLessThan(15);
    expect(Math.abs(hue(green!.accent) - hue('#2E7D32'))).toBeLessThan(15);
  });

  it('puts a saturated colour before a grey one', () => {
    const [first] = suggestPalettes(['#9E9E9E', '#D32F2F'], 'dark');
    expect(Math.abs(hue(first!.accent) - hue('#D32F2F'))).toBeLessThan(15);
  });

  it('gives three different palettes from a single colour', () => {
    const palettes = suggestPalettes(['#D32F2F'], 'light');
    expect(new Set(palettes.map((p) => JSON.stringify(p))).size).toBe(3);
  });
});
