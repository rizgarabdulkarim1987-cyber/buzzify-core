/**
 * The pure maths of the ledger family (spec 2026-10-28-menu-styles-77-addendum.md): dense rows, one line a dish. Kept
 * apart from the component so it is unit-tested without React.
 */

/** The ledger family's styles: one body kind each, one component (`LedgerBody`) for all. */
export const LEDGER_MOTIFS = ['sheet', 'serp', 'typew', 'cassette', 'radio'] as const;
export type LedgerMotif = (typeof LEDGER_MOTIFS)[number];

/** A spreadsheet's column letter for a 0-based column: A…Z, then AA, AB… */
export function sheetColumn(index: number): string {
  let rest = Math.max(0, Math.floor(index));
  let letters = '';
  do {
    letters = String.fromCharCode(65 + (rest % 26)) + letters;
    rest = Math.floor(rest / 26) - 1;
  } while (rest >= 0);
  return letters;
}

/**
 * The rows of one sheet section cheapest first: a stable sort (dishes of one price keep the menu's order) of the list as
 * it already is (searched and filtered), never touching the list it is given.
 */
export function cheapestFirst<T>(items: readonly T[], priceOf: (item: T) => number): T[] {
  return items
    .map((item, at) => ({ item, at, price: priceOf(item) }))
    .sort((a, b) => a.price - b.price || a.at - b.at)
    .map(({ item }) => item);
}

/**
 * A dish's place on a section's cassette: the first half (rounded up) is side A, the rest side B, each numbered from 1,
 * as a J-card lists its tracks.
 */
export function tapeSide(at: number, count: number): { side: 'A' | 'B'; track: number } {
  const half = Math.ceil(count / 2);
  return at < half ? { side: 'A', track: at + 1 } : { side: 'B', track: at + 1 - half };
}

/** The medium-wave band the radio's dial spans, in kHz. */
export const DIAL_BAND = { low: 540, high: 1600 } as const;

/**
 * The frequency (kHz, a multiple of 10) printed under a section's station on the dial: the sections spread evenly over
 * the band, in the menu's full order, so a search that hides some never retunes the others.
 */
export function stationFrequency(place: number, total: number): number {
  if (total <= 1) return DIAL_BAND.low;
  const at = Math.min(Math.max(place, 0), total - 1);
  return DIAL_BAND.low + Math.round(((DIAL_BAND.high - DIAL_BAND.low) * at) / (total - 1) / 10) * 10;
}
