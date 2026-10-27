/**
 * The Summer Beach shape's own fills (the same on every palette: a beach is sand, sea and striped towels, not the page
 * colours). Every text in the shape sits on one of these solid fills, so each pair is a computed contrast
 * (tests/ui/beach-shape.test.ts). `beach.css` writes the same values; the test checks they stay in step. The one colour
 * that follows the palette is the lit chip's ring (`riseOf`), kept visible on the deep chip by construction.
 */
export const BEACH = {
  /** The sky behind the bands. */
  sky: '#8fdcf4',
  /** A sand band. */
  sand: '#ffe9b8',
  /** A sea band. */
  sea: '#bfeefc',
  /** The strip's backing. */
  strip: '#a9e3f6',
  /** Text on the bands, the strip, the chips and the towel label. */
  ink: '#0d3b52',
  /** A resting chip and the towel label. */
  cream: '#fffdf7',
  /** A lit chip and the number and count badges. */
  deep: '#0d3b52',
  /** Text on the deep fill. */
  deepInk: '#fff7e0',
  /** The price on the towel label. */
  priceInk: '#9a3412',
  /** The sale chip. */
  sale: '#7a0c2c',
  /** Text on the sale chip. */
  saleInk: '#ffffff',
  /** The add button. */
  add: '#0d3b52',
  /** The plus on the add button. */
  addInk: '#fffdf7',
} as const;

/** The four stripe hues a towel takes in turns (decoration only: no text sits on a stripe). */
export const TOWELS = ['#ff6b35', '#14a3b8', '#ffc233', '#ff8fb1'] as const;

/** The towel hue of the dish at `at` in its section (wraps both ways). */
export function towelOf(at: number): string {
  return TOWELS[((at % TOWELS.length) + TOWELS.length) % TOWELS.length]!;
}

/** The lit ring colour for an accent: the accent lifted 55% towards white. Mirrors the CSS `color-mix`. */
export function riseOf(accent: string): string {
  const lifted = [1, 3, 5].map((at) => Math.round(parseInt(accent.slice(at, at + 2), 16) * 0.45 + 255 * 0.55));
  return `#${lifted.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}
