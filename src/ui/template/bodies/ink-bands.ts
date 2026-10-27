import { luminance } from '@/lib/palette';
import { bestOn } from '@/lib/templates/palette';

/**
 * The colours of the bands of the Section Ink shape. Every section is a band in a saturated colour of its own, spread
 * around the wheel so neighbours differ; a ninth band starts the set again. The text on a band (and on its chip, and on
 * the add buttons that wear its colour) is whichever of white and near-black reads better on it, found by `inkOn`, so no
 * band ever carries a pair that was only assumed to read. The dishes sit on paper-white cards (`INK_PAPER`), whose text
 * is `INK_ON_PAPER`, so a dish reads the same whatever the band or the menu's palette.
 */
export const INK_BANDS = ['#D32F24', '#F2A116', '#13804A', '#2563EB', '#7E3AD0', '#D01E7C', '#0A7886', '#F26B1D'] as const;

export const INK_PAPER = '#FFFFFF';
export const INK_ON_PAPER = '#14141A';
const LIGHT_INK = '#FFFFFF';

/**
 * The paper the dishes sit on and its text colour, from the palette: the lighter of the background and the text colour is
 * the paper, the darker one its text. They are a palette's own text/background pair, so they read (7:1) whatever the
 * palette is; on the default dark palette that is white paper with near-black text.
 */
export function paperOf(palette: { bg: string; text: string }): { paper: string; onPaper: string } {
  return luminance(palette.text) >= luminance(palette.bg) ? { paper: palette.text, onPaper: palette.bg } : { paper: palette.bg, onPaper: palette.text };
}

/** The band colour of the nth section; the set repeats once it is used up. */
export function bandColour(index: number): string {
  return INK_BANDS[((index % INK_BANDS.length) + INK_BANDS.length) % INK_BANDS.length]!;
}

/** The text colour for a fill: white or near-black, whichever reads better on it (white on a tie). */
export function inkOn(fill: string): string {
  return bestOn(fill, [LIGHT_INK, INK_ON_PAPER]);
}
