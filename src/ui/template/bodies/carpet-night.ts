import { contrastRatio } from '@/lib/palette';

/**
 * The One Thousand and One Nights shape's carpets (CarpetBody). Every colour of the shape's chrome is the template's palette
 * (carpet.css, so Customize reaches it): the night is `--bg`, gold thread the accent, the rolled carpets `--raised`,
 * the parchment tag `--text` with `--bg`. Only the weaves below are the carpets' own dyes (crimson, indigo, teal and
 * plum, a decoration per section); the text on a weave is computed to read on it (`carpetInks`).
 */

export interface Weave {
  /** The carpet's solid ground, which every text on it is measured against. */
  base: string;
  /** The lighter thread woven over the ground (still dark enough for the ink). */
  thread: string;
}

/** The colourways the carpets take in turn: crimson, indigo, teal and plum. */
export const WEAVES: readonly Weave[] = [
  { base: '#5A1530', thread: '#7A2142' },
  { base: '#2B1B6B', thread: '#43309A' },
  { base: '#0F4048', thread: '#17606B' },
  { base: '#4A1560', thread: '#69258A' },
];

/** The weave of the carpet at `index`: a place in the cycle, wrapping both ways. */
export function carpetWeaveOf(index: number): Weave {
  return WEAVES[((index % WEAVES.length) + WEAVES.length) % WEAVES.length]!;
}

const LIGHT = '#FFFFFF';
const DARK = '#111111';

/** `preferred` when it reads at `min`:1 on every ground, else whichever of white and near-black reads better on all of them. */
function readable(preferred: string, grounds: readonly string[], min: number): string {
  const worst = (colour: string) => Math.min(...grounds.map((ground) => contrastRatio(colour, ground)));
  if (worst(preferred) >= min) return preferred;
  return worst(LIGHT) >= worst(DARK) ? LIGHT : DARK;
}

/**
 * The text colours on a carpet: `ink` for the names and rings (the palette's text colour when it reads on the weave, else
 * white or near-black) and `stitch` for the embroidered title (the palette's accent when it reads on the thread, else `ink`).
 */
export function carpetInks(weave: Weave, palette: { text: string; accent: string }): { ink: string; stitch: string } {
  const ink = readable(palette.text, [weave.base, weave.thread], 4.5);
  const stitch = readable(palette.accent, [weave.thread], 4.5);
  return { ink, stitch: stitch === palette.accent ? stitch : ink };
}
