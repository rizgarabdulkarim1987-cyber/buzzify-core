/**
 * The hue (in degrees) of the nth entry of a shape's colour set (the stations of a metro line, the groups of a periodic
 * table): the set repeats once it is used up, and a negative index counts from its end.
 */
export function hueAt(hues: readonly number[], index: number): number {
  return hues[((index % hues.length) + hues.length) % hues.length]!;
}

/** The colour set several shapes share (a home screen's app tiles, a game's worlds): spread around the wheel so neighbours differ. */
export const SHAPE_HUES = [340, 28, 150, 205, 265, 48] as const;
