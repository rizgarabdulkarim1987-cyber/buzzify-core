import { DEFAULT_PALETTES, type Palette } from './brand';

/**
 * The brand kit's colour rules (spec 12): how much two colours contrast, which pairs of a palette must be readable, the
 * curated presets, and palettes suggested from the colours of a logo. Pure, so the Studio checks a palette as it is typed
 * and the server checks it again on save and on publish.
 */

// ---------------------------------------------------------------------------------------------------------------------
// Contrast
// ---------------------------------------------------------------------------------------------------------------------

type Rgb = [number, number, number];

function rgbOf(hex: string): Rgb {
  return [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)) as Rgb;
}

function hexOf([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/** WCAG 2 relative luminance of an sRGB colour, from 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const [r, g, b] = rgbOf(hex).map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG 2 contrast ratio of two `#RRGGBB` colours, from 1 to 21; the order does not matter. */
export function contrastRatio(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// ---------------------------------------------------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------------------------------------------------

export interface PaletteProblem {
  foreground: keyof Palette;
  background: keyof Palette;
  /** Rounded to two decimals. */
  ratio: number;
  /** A blocking problem stops saving and publishing; a warning is shown. */
  severity: 'block' | 'warn';
}

/** Body text and muted text on the background and on the surface: WCAG AA for normal text. */
const BLOCKING_PAIRS: ReadonlyArray<readonly [keyof Palette, keyof Palette]> = [
  ['text', 'bg'],
  ['text', 'surface'],
  ['muted', 'bg'],
  ['muted', 'surface'],
];
const BLOCK_BELOW = 4.5;

/** The accent and what is drawn on it: buttons and selected states, large or bold, so 3:1. */
const WARNING_PAIRS: ReadonlyArray<readonly [keyof Palette, keyof Palette]> = [
  ['onAccent', 'accent'],
  ['accent', 'bg'],
  ['accent', 'surface'],
];
const WARN_BELOW = 3;

const round2 = (value: number) => Math.round(value * 100) / 100;

/** What is wrong with a palette, blocking problems first, each pair in the order the rules list them. */
export function paletteProblems(palette: Palette): PaletteProblem[] {
  const problems: PaletteProblem[] = [];
  const check = (pairs: typeof BLOCKING_PAIRS, below: number, severity: PaletteProblem['severity']) => {
    for (const [foreground, background] of pairs) {
      const ratio = contrastRatio(palette[foreground], palette[background]);
      if (ratio < below) problems.push({ foreground, background, ratio: round2(ratio), severity });
    }
  };
  check(BLOCKING_PAIRS, BLOCK_BELOW, 'block');
  check(WARNING_PAIRS, WARN_BELOW, 'warn');
  return problems;
}

// ---------------------------------------------------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------------------------------------------------

export const BRAND_PRESET_IDS = ['luxury', 'coffee', 'bakery', 'fastFood', 'fineDining'] as const;
export type BrandPresetId = (typeof BRAND_PRESET_IDS)[number];

/** Curated starting points, each light and dark; every pair of every one passes the rules above. */
export const BRAND_PRESETS: Record<BrandPresetId, { light: Palette; dark: Palette }> = {
  luxury: { light: DEFAULT_PALETTES.light, dark: DEFAULT_PALETTES.dark },
  coffee: {
    light: {
      bg: '#FAF6F1',
      surface: '#FFFFFF',
      raised: '#F1E9DF',
      accent: '#6F4E37',
      text: '#2B211B',
      muted: '#6E625A',
      line: '#E2D6C8',
      onAccent: '#FFFFFF',
    },
    dark: {
      bg: '#16110E',
      surface: '#211A16',
      raised: '#2D241F',
      accent: '#C8A27A',
      text: '#F3ECE4',
      muted: '#B5A89C',
      line: '#3A2F28',
      onAccent: '#16110E',
    },
  },
  bakery: {
    light: {
      bg: '#FFF8F0',
      surface: '#FFFFFF',
      raised: '#FBEBDD',
      accent: '#A84A24',
      text: '#2E2118',
      muted: '#6F5E52',
      line: '#EBD9C8',
      onAccent: '#FFFFFF',
    },
    dark: {
      bg: '#1A1310',
      surface: '#251B16',
      raised: '#33251E',
      accent: '#E8A07A',
      text: '#FBF1E8',
      muted: '#C4B2A4',
      line: '#3F2F27',
      onAccent: '#1A1310',
    },
  },
  fastFood: {
    light: {
      bg: '#FFF9F2',
      surface: '#FFFFFF',
      raised: '#FFEBD6',
      accent: '#C8261C',
      text: '#1A1A1A',
      muted: '#5E5A55',
      line: '#F0DCC8',
      onAccent: '#FFFFFF',
    },
    dark: {
      bg: '#121212',
      surface: '#1E1E1E',
      raised: '#2A2A2A',
      accent: '#FFC727',
      text: '#FAFAFA',
      muted: '#B3B3B3',
      line: '#333333',
      onAccent: '#121212',
    },
  },
  fineDining: {
    light: {
      bg: '#F6F4EF',
      surface: '#FFFFFF',
      raised: '#ECE8DF',
      accent: '#2F4A3A',
      text: '#1C1F1D',
      muted: '#5C625E',
      line: '#D9D5CC',
      onAccent: '#FFFFFF',
    },
    dark: {
      bg: '#0F1311',
      surface: '#18201C',
      raised: '#222C27',
      accent: '#B9A27A',
      text: '#ECEAE4',
      muted: '#A3A79F',
      line: '#2E3833',
      onAccent: '#0F1311',
    },
  },
};

// ---------------------------------------------------------------------------------------------------------------------
// The colours of a logo
// ---------------------------------------------------------------------------------------------------------------------

/** How close two colours may be on every channel and still count as one. */
const SAME_COLOUR = 24;

/**
 * The main colours of an image, most frequent first, at most `count`: pixels grouped by the top four bits of each
 * channel, transparent ones (alpha below 128) left out, each group stood for by its mean colour, and a group whose mean
 * is within 24 of an earlier one on every channel left out too.
 */
export function dominantColors(pixels: Uint8Array, channels: 3 | 4, count: number): string[] {
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
  for (let at = 0; at + channels <= pixels.length; at += channels) {
    if (channels === 4 && pixels[at + 3]! < 128) continue;
    const r = pixels[at]!;
    const g = pixels[at + 1]!;
    const b = pixels[at + 2]!;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    bucket.n += 1;
    buckets.set(key, bucket);
  }

  const picked: Rgb[] = [];
  const byCount = [...buckets.values()].sort((x, y) => y.n - x.n);
  for (const bucket of byCount) {
    if (picked.length >= count) break;
    const mean: Rgb = [bucket.r / bucket.n, bucket.g / bucket.n, bucket.b / bucket.n];
    const near = picked.some((other) => other.every((channel, i) => Math.abs(channel - mean[i]!) <= SAME_COLOUR));
    if (!near) picked.push(mean);
  }
  return picked.map(hexOf);
}

// ---------------------------------------------------------------------------------------------------------------------
// Suggested palettes
// ---------------------------------------------------------------------------------------------------------------------

interface Hsl {
  h: number;
  s: number;
  l: number;
}

function hslOf(hex: string): Hsl {
  const [r, g, b] = rgbOf(hex).map((channel) => channel / 255) as Rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: s * 100, l: l * 100 };
}

function hexOfHsl({ h, s, l }: Hsl): string {
  const sat = Math.min(100, Math.max(0, s)) / 100;
  const light = Math.min(100, Math.max(0, l)) / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = light - c / 2;
  const [r, g, b]: Rgb =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return hexOf([(r + m) * 255, (g + m) * 255, (b + m) * 255]);
}

/** Lightness (percent) of bg, surface, raised, line, text and muted, per theme. */
const NEUTRALS = {
  light: { bg: 97, surface: 100, raised: 93, line: 85, text: 12, muted: 38 },
  dark: { bg: 7, surface: 11, raised: 16, line: 24, text: 92, muted: 70 },
} as const;

/** How strongly the neutrals take the accent's hue: the usual tint, then the two variants for a logo of one colour. */
const TINT = 10;
const TINT_VARIANTS = [0, 20];

const SATURATED = 15;

function paletteAround(accentHex: string, theme: 'light' | 'dark', tint: number): Palette {
  const accent = hslOf(accentHex);
  const n = NEUTRALS[theme];
  const neutral = (l: number) => hexOfHsl({ h: accent.h, s: tint, l });
  const base = {
    bg: neutral(n.bg),
    surface: neutral(n.surface),
    raised: neutral(n.raised),
    line: neutral(n.line),
    text: neutral(n.text),
    muted: neutral(n.muted),
  };

  // Darker on a light theme, lighter on a dark one, two points at a time, until it reads on both backgrounds.
  const step = theme === 'light' ? -2 : 2;
  let l = accent.l;
  let hex = hexOfHsl({ ...accent, l });
  while (Math.min(contrastRatio(hex, base.bg), contrastRatio(hex, base.surface)) < WARN_BELOW && l > 0 && l < 100) {
    l += step;
    hex = hexOfHsl({ ...accent, l });
  }

  // On the accent: white, or the palette's darkest colour (the text on a light theme, the background on a dark one),
  // whichever reads better. The accent already contrasts 3:1 with that darkest colour or with white (the surface).
  const darkest = theme === 'light' ? base.text : base.bg;
  const onAccent = contrastRatio('#FFFFFF', hex) >= contrastRatio(darkest, hex) ? '#FFFFFF' : darkest;
  return { ...base, accent: hex, onAccent };
}

/**
 * Three palettes for a theme built around the colours of a logo: one per colour, saturated colours first. With fewer
 * than three colours the rest reuse the first with plainer and with more strongly tinted neutrals; with none, the
 * default accent is used. Every pair of every palette passes `paletteProblems`.
 */
export function suggestPalettes(colors: readonly string[], theme: 'light' | 'dark'): Palette[] {
  const saturated = colors.filter((color) => hslOf(color).s >= SATURATED);
  const plain = colors.filter((color) => hslOf(color).s < SATURATED);
  const accents = [...saturated, ...plain].slice(0, 3);
  if (accents.length === 0) accents.push(DEFAULT_PALETTES[theme].accent);

  const palettes = accents.map((accent) => paletteAround(accent, theme, TINT));
  for (const tint of TINT_VARIANTS) {
    if (palettes.length >= 3) break;
    palettes.push(paletteAround(accents[0]!, theme, tint));
  }
  return palettes;
}
