/**
 * The Ramadan Nights shape's lanterns (LanternsBody). The strip's colours are the template's palette (lanterns.css, so
 * Customize reaches them): the night is `--bg`, a lantern's rope and its lit window the accent, its names `--text`.
 */

/** The strings the lanterns hang on, in rem: a few lengths in a cycle, so the row is not a ruler. */
export const DROPS = [0.25, 0.625, 0.375, 0.5, 0.125] as const;

/** The string of the lantern at `index`: a place in the cycle of lengths. */
export function dropOf(index: number): number {
  return DROPS[((index % DROPS.length) + DROPS.length) % DROPS.length]!;
}
