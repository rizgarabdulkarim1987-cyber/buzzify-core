/**
 * The Summer Beach shape's default fills: what the preset's signature palette resolves them to (sand, sea and striped
 * towels). `beach.css` draws every one of them from the template's palette variables, so Customize recolours the beach;
 * these are the values the signature palette gives them, and each pair is a computed contrast (tests/ui/beach-shape.test.ts).
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

/**
 * The four stripe hues a towel takes in turns (decoration only: no text sits on a stripe), as the stylesheet's palette-turned
 * variables: the first is the accent, the others its hue turned (beach.css `--bc-towel-N`). With the signature palette they
 * come out as coral, teal, sun yellow and pink.
 */
export const TOWELS = ['var(--bc-towel-0)', 'var(--bc-towel-1)', 'var(--bc-towel-2)', 'var(--bc-towel-3)'] as const;

/** The towel hue of the dish at `at` in its section (wraps both ways). */
export function towelOf(at: number): string {
  return TOWELS[((at % TOWELS.length) + TOWELS.length) % TOWELS.length]!;
}

/** The lit ring colour for an accent (shared/rise.ts: the accent lifted 55% towards white, as the CSS draws it). */
export { riseOf } from './shared/rise';
