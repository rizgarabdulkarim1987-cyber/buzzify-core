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

/** The band colour of the nth section; the set repeats once it is used up. */
export function bandColour(index: number): string {
  return INK_BANDS[((index % INK_BANDS.length) + INK_BANDS.length) % INK_BANDS.length]!;
}

/** Relative luminance (WCAG) of a `#RRGGBB` colour. */
export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const c = parseInt(hex.slice(at, at + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** The WCAG contrast ratio of two `#RRGGBB` colours. */
export function contrast(one: string, two: string): number {
  const [light, dark] = [luminance(one), luminance(two)].sort((a, b) => b - a);
  return (light! + 0.05) / (dark! + 0.05);
}

/** The text colour for a fill: white or near-black, whichever reads better on it. */
export function inkOn(fill: string): string {
  return contrast(LIGHT_INK, fill) >= contrast(INK_ON_PAPER, fill) ? LIGHT_INK : INK_ON_PAPER;
}
