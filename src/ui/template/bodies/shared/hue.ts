/**
 * The hue (in degrees) of the nth entry of a shape's colour set (the stations of a metro line, the groups of a periodic
 * table): the set repeats once it is used up, and a negative index counts from its end.
 */
export function hueAt(hues: readonly number[], index: number): number {
  return hues[((index % hues.length) + hues.length) % hues.length]!;
}
