/**
 * The Constellations' sky chart (StarsBody, kind `space-const`): every section a constellation, its dishes stars laid
 * out from a fixed pattern per count, so the chart always reads as rows of three and two across a phone. The stars run
 * along the rows in turn (left to right, then back), and a dotted line joins each star to the next, as on a sky chart.
 */

/** Where a star's photo centre sits in its row, as a part of the row's height (the CSS sets the photo to match). */
export const STAR_ANCHOR = 0.26;

/** The across positions (percent of the chart's width, from the inline start) of a row of one, two or three stars. */
const ACROSS: Record<1 | 2 | 3, readonly number[]> = { 1: [50], 2: [30, 70], 3: [17, 50, 83] };
/** How far each star of such a row sits below the row's line (percent of the row's height), so a row never looks ruled. */
const DOWN: Record<1 | 2 | 3, readonly number[]> = { 1: [0], 2: [-3, 5], 3: [5, -4, 3] };

/** The stars per row for `count` dishes: three, then two, then three…; the last row takes what is left. */
export function starRows(count: number): number[] {
  const rows: number[] = [];
  let left = Math.max(0, Math.floor(count));
  for (let at = 0; left > 0; at += 1) {
    const take = Math.min(left, at % 2 === 0 ? 3 : 2);
    rows.push(take);
    left -= take;
  }
  return rows;
}

export interface StarSpot {
  /** Percent of the chart's width from the inline start. */
  x: number;
  /** The row (0-based). */
  row: number;
  /** Percent of a row's height below the row's line. */
  dy: number;
}

/** Every star of a constellation of `count`, in menu order: odd rows run back, so the line snakes down the chart. */
export function starChart(count: number): { stars: StarSpot[]; rows: number } {
  const sizes = starRows(count);
  const stars: StarSpot[] = [];
  sizes.forEach((size, row) => {
    const key = size as 1 | 2 | 3;
    const order = Array.from({ length: size }, (_, at) => (row % 2 === 0 ? at : size - 1 - at));
    for (const at of order) stars.push({ x: ACROSS[key][at]!, row, dy: DOWN[key][at]! });
  });
  return { stars, rows: sizes.length };
}

/** Where a star's photo centre sits down the chart, in percent of the chart's height (for the joining lines). */
export function starDown(spot: StarSpot, rows: number): number {
  return Math.round(((spot.row + spot.dy / 100 + STAR_ANCHOR) / Math.max(1, rows)) * 10000) / 100;
}

const GREEK = 'αβγδεζηθικλμνξοπρστυφχψω';

/**
 * A star's Bayer letter: α, β, γ… in menu order; past ω the letters start again with a number (α2…), written with
 * `format` (the menu's numerals).
 */
export function starLetter(at: number, format: (value: number) => string = String): string {
  const letter = GREEK[at % GREEK.length]!;
  const round = Math.floor(at / GREEK.length);
  return round === 0 ? letter : `${letter}${format(round + 1)}`;
}

/** A steady pseudo-random number in [0, 1) for a seed: the faint stars behind a constellation keep their places. */
export function starNoise(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}
