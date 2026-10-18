import { HEX } from '@/lib/brand';
import { contrastRatio, luminance } from '@/lib/palette';
import { DESIGN_PALETTE_KEYS, type DesignPalette } from './types';

/**
 * A template palette's colours: derived from the three colours a preset is described with, checked against the
 * readability rules (spec 4.1), and the extra shades the renderer draws with.
 */

type Rgb = [number, number, number];

function rgbOf(hex: string): Rgb {
  return [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)) as Rgb;
}

function hexOf([r, g, b]: Rgb): string {
  const channel = (value: number) => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`.toUpperCase();
}

/** `a` moved `amount` (0 to 1) of the way toward `b`, in sRGB. */
export function mix(a: string, b: string, amount: number): string {
  const from = rgbOf(a);
  const to = rgbOf(b);
  return hexOf(from.map((channel, i) => channel + (to[i]! - channel) * amount) as Rgb);
}

/** Dark when the background is darker than a mid grey reads. */
export function themeOf(background: string): 'dark' | 'light' {
  return luminance(background) < 0.2 ? 'dark' : 'light';
}

/**
 * `colour`, moved toward black or white (whichever the darkest background calls for) only as far as needed to reach
 * `min`:1 against every background. Unchanged when it already does.
 */
export function readableOn(colour: string, backgrounds: readonly string[], min: number): string {
  // A colour lighter than its grounds (on average) goes lighter; a darker one goes darker.
  const grounds = backgrounds.reduce((sum, ground) => sum + luminance(ground), 0) / backgrounds.length;
  const target = luminance(colour) >= grounds ? '#FFFFFF' : '#000000';
  for (let step = 0; step <= 50; step++) {
    const candidate = mix(colour, target, step / 50);
    if (backgrounds.every((ground) => contrastRatio(candidate, ground) >= min)) return candidate;
  }
  return target;
}

/** Which of `candidates` reads best on `background`. */
export function bestOn(background: string, candidates: readonly string[]): string {
  return candidates.reduce((best, next) => (contrastRatio(next, background) > contrastRatio(best, background) ? next : best));
}

/** The colours a preset is described with; anything left out is derived. */
export interface PaletteSeed {
  bg: string;
  text: string;
  accent: string;
  surface?: string;
  raised?: string;
  card?: string;
  line?: string;
  muted?: string;
  button?: string;
  onButton?: string;
}

/**
 * A full palette from a seed. Surfaces sit a little toward the text on a dark ground and toward white on a light one;
 * text and muted text are pushed only as far as they need to read on every surface; the button keeps the accent unless
 * its label would read below 4.5:1, when it is darkened or lightened just enough. The accent itself is kept exactly:
 * a weak accent is a warning, never a block.
 */
export function derivePalette(seed: PaletteSeed): DesignPalette {
  const dark = themeOf(seed.bg) === 'dark';
  const surface = seed.surface ?? (dark ? mix(seed.bg, seed.text, 0.06) : mix(seed.bg, '#FFFFFF', 0.6));
  const raised = seed.raised ?? (dark ? mix(seed.bg, seed.text, 0.12) : mix(seed.bg, seed.text, 0.07));
  const card = seed.card ?? surface;
  const line = seed.line ?? mix(seed.bg, seed.text, dark ? 0.2 : 0.17);
  const grounds = [seed.bg, surface, card];
  const text = readableOn(seed.text, grounds, 7);
  const muted = readableOn(seed.muted ?? mix(text, seed.bg, 0.4), grounds, 4.6);
  const onAccent = bestOn(seed.accent, [seed.bg, text, '#FFFFFF', '#111111']);

  let button = seed.button ?? seed.accent;
  let onButton = seed.onButton ?? bestOn(button, [seed.bg, text, '#FFFFFF', '#111111']);
  if (contrastRatio(onButton, button) < 4.5) {
    // Move the button away from its label until the label reads.
    const away = luminance(onButton) > luminance(button) ? '#000000' : '#FFFFFF';
    for (let step = 1; step <= 50 && contrastRatio(onButton, button) < 4.5; step++) button = mix(seed.button ?? seed.accent, away, step / 50);
    onButton = seed.onButton ?? onButton;
  }
  return { bg: seed.bg.toUpperCase(), surface, raised, card, line, text, muted, accent: seed.accent.toUpperCase(), onAccent, button, onButton };
}

// ---------------------------------------------------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------------------------------------------------

export interface DesignPaletteProblem {
  foreground: keyof DesignPalette;
  background: keyof DesignPalette;
  ratio: number;
  severity: 'block' | 'warn';
}

type Pair = readonly [keyof DesignPalette, keyof DesignPalette];

const TEXT_PAIRS: readonly Pair[] = [
  ['text', 'bg'],
  ['text', 'surface'],
  ['text', 'card'],
  ['muted', 'bg'],
  ['muted', 'surface'],
  ['muted', 'card'],
];
const ACCENT_PAIRS: readonly Pair[] = [
  ['onAccent', 'accent'],
  ['accent', 'bg'],
  ['accent', 'card'],
];

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * What is wrong with a template palette, blocking problems first: text and muted text below 4.5:1 on the background,
 * surface or card, or the button's label below 3:1, block. The button's label below 4.5:1 and a weak accent warn.
 */
export function designPaletteProblems(palette: DesignPalette): DesignPaletteProblem[] {
  const problems: DesignPaletteProblem[] = [];
  const check = (pairs: readonly Pair[], below: number, severity: 'block' | 'warn') => {
    for (const [foreground, background] of pairs) {
      const ratio = contrastRatio(palette[foreground], palette[background]);
      if (ratio < below) problems.push({ foreground, background, ratio: round2(ratio), severity });
    }
  };
  check(TEXT_PAIRS, 4.5, 'block');
  check([['onButton', 'button']], 3, 'block');
  const button = contrastRatio(palette.onButton, palette.button);
  if (button >= 3 && button < 4.5) problems.push({ foreground: 'onButton', background: 'button', ratio: round2(button), severity: 'warn' });
  check(ACCENT_PAIRS, 3, 'warn');
  return problems;
}

/** A palette from stored data: each colour that is a valid `#RRGGBB` replaces the fallback's. */
export function sanitizeDesignPalette(input: unknown, fallback: DesignPalette): DesignPalette {
  const source = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const result = { ...fallback };
  for (const key of DESIGN_PALETTE_KEYS) {
    const value = source[key];
    if (typeof value === 'string' && HEX.test(value)) result[key] = value.toUpperCase();
  }
  return result;
}

/** The accent where it is used for text (prices, links): pushed just far enough to read on the background and card. */
export function accentInk(palette: DesignPalette): string {
  return readableOn(palette.accent, [palette.bg, palette.card], 4.5);
}
