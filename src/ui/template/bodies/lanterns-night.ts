/**
 * The Ramadan Nights shape's night (LanternsBody): the colours of the sticky strip of lanterns, which are the shape's
 * own and the same on every palette (a navy night with gold lanterns). Each pair is unit-tested for contrast.
 */
export const NIGHT = {
  sky: '#0B1430',
  /** The rope and the lantern's cap and base. */
  rope: '#C9A24A',
  /** A lantern that is not the one in view: a dim indigo window. */
  dimPane: '#27336E',
  dimInk: '#F6E6B8',
  /** The lantern in view: a warm lit window. */
  litPane: '#FFD36B',
  litInk: '#1A1033',
  /** The name under a lantern. */
  label: '#F3E3B5',
  labelLit: '#FFE7A0',
  /** A keyboard focus ring round a lantern, on the night. */
  ring: '#FFF4DC',
} as const;

/** The strings the lanterns hang on, in rem: a few lengths in a cycle, so the row is not a ruler. */
export const DROPS = [0.25, 0.625, 0.375, 0.5, 0.125] as const;

/** The string of the lantern at `index`: a place in the cycle of lengths. */
export function dropOf(index: number): number {
  return DROPS[((index % DROPS.length) + DROPS.length) % DROPS.length]!;
}
