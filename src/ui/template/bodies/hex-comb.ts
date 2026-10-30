/**
 * Mountain Honey's comb (HexBody, kind `honey`): flat-topped hexagonal cells that interlock as real comb does. With
 * `cols` columns the comb is a grid of `3 * cols + 1` equal tracks across: a cell spans four, so two neighbouring
 * columns share one track (the slanted walls fit together); down, a cell spans two half-cell rows, and every odd column
 * starts half a cell lower.
 */

/** The comb's columns on a phone, a wider phone or tablet, and a wide screen. */
export const COMB_COLUMNS = [2, 3, 4] as const;

/** The grid tracks across a comb of `cols` columns. */
export function combTracks(cols: number): number {
  return 3 * cols + 1;
}

/** Where the `at`th cell starts in a comb of `cols` columns: its first grid column and first half-cell row (1-based). */
export function combCell(at: number, cols: number): { column: number; row: number } {
  const col = at % cols;
  const line = Math.floor(at / cols);
  return { column: 3 * col + 1, row: 2 * line + 1 + (col % 2) };
}

/** A cell's height as percent of the comb's width (a regular hexagon: √3/2 of its width, which is 4 of the tracks). */
export function combCellHeight(cols: number): number {
  return Math.round(((Math.sqrt(3) / 2) * (4 / combTracks(cols))) * 10000) / 100;
}

/** A steady pseudo-random number in [0, 1) for a seed: each frame's bees keep their own flight. */
export function combNoise(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** A bee's flight round a frame: where it starts (percent), how far it swings (px), how long a loop takes and its phase (s). */
export function beeFlight(seed: number): { x: number; y: number; swing: number; time: number; delay: number } {
  return {
    x: Math.round(8 + combNoise(seed) * 80),
    y: Math.round(10 + combNoise(seed + 3) * 70),
    swing: Math.round((combNoise(seed + 5) - 0.5) * 100),
    time: Number((4 + combNoise(seed + 7) * 3).toFixed(2)),
    delay: -Number((combNoise(seed + 11) * 4).toFixed(2)),
  };
}
