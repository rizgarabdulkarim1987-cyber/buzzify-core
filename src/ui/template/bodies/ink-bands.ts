import { readableOn, bestOn } from '@/lib/templates/palette';

/**
 * The colours of the sections of the Section Ink shape (the motion-ink mockup). Every section has an ink colour of its own,
 * spread around the wheel so neighbours differ (the mockup's coral, amber, green, pink and blue first); a ninth section
 * starts the set again. The ink is used as text and as a fill: the section's name, the price, the chip's outline, and the
 * fill of the lit chip, the add button and the splash. `inkOf` pushes it just far enough to read (4.5:1) on the menu's
 * own background and card, so it follows the palette (the default dark palette keeps the mockup's colours as they are);
 * `inkOn` is the text colour for a fill of that ink (white or near-black, whichever reads better).
 */
export const INK_BANDS = ['#FF6B4A', '#FFC43D', '#4CD685', '#FF7EB6', '#7AA7FF', '#C08CFF', '#4FD3D8', '#FF9F5A'] as const;

const DARK_INK = '#14141A';
const LIGHT_INK = '#FFFFFF';

/** The ink of the nth section; the set repeats once it is used up. */
export function bandColour(index: number): string {
  return INK_BANDS[((index % INK_BANDS.length) + INK_BANDS.length) % INK_BANDS.length]!;
}

/** The ink as it reads on the palette's background and card (unchanged when it already does). */
export function inkOf(band: string, palette: { bg: string; raised: string }): string {
  return readableOn(band, [palette.bg, palette.raised], 4.5);
}

/** The text colour for a fill: white or near-black, whichever reads better on it (white on a tie). */
export function inkOn(fill: string): string {
  return bestOn(fill, [LIGHT_INK, DARK_INK]);
}
