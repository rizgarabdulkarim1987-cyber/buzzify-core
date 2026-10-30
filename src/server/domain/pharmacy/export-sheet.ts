import { escapeCell } from '../sheet-cells';

/**
 * How a report becomes a sheet (phase 6, task 5; R6-9). Numbers are exact decimal text, never floats; every other cell is text and
 * goes through `escapeCell`, so nothing a person typed can be read as a formula. A number is made with `num`, which refuses
 * anything that is not a plain decimal, so a text value cannot slip past the escaping by being labelled a number.
 */

export interface Num {
  readonly n: string;
}
export type Cell = string | Num;

const DECIMAL = /^-?\d+(\.\d+)?$/;
export function num(text: string): Num {
  if (!DECIMAL.test(text)) throw new Error(`Not a plain decimal number: ${text.slice(0, 20)}`);
  return { n: text };
}
/** A number cell, or an empty text cell when there is no number. */
export const numOrBlank = (text: string | null | undefined): Cell => (text === null || text === undefined ? '' : num(text));

const DIGITS = { IQD: 0, USD: 2 } as const;

/** A minor-unit amount in major units as exact text: IQD has 0 digits, USD 2. Negative amounts keep their sign. */
export function decimalText(minor: bigint, currency: 'IQD' | 'USD'): string {
  const digits = DIGITS[currency];
  const negative = minor < 0n;
  const abs = (negative ? -minor : minor).toString();
  const body = digits === 0 ? abs : `${abs.padStart(digits + 1, '0').slice(0, -digits)}.${abs.padStart(digits + 1, '0').slice(-digits)}`;
  return negative ? `-${body}` : body;
}

/** Basis points as a percent with two decimals, exactly (1234 -> 12.34); blank for none. */
export function bpText(bp: number | null): string {
  if (bp === null) return '';
  const negative = bp < 0;
  const abs = Math.abs(bp).toString().padStart(3, '0');
  const body = `${abs.slice(0, -2)}.${abs.slice(-2)}`;
  return negative ? `-${body}` : body;
}

/** The rows as the writers take them: numbers as they are, every text cell escaped. */
export function exportCells(rows: ReadonlyArray<ReadonlyArray<Cell>>): string[][] {
  return rows.map((row) => row.map((cell) => (typeof cell === 'string' ? escapeCell(cell) : cell.n)));
}

/** `pharmacy-<report>-<from>_<to>.<ext>`, or `pharmacy-<report>-<day>.<ext>` for a report as of one day. No business name, no free text. */
export function exportFileName(report: string, range: { from: string; to: string } | { on: string }, ext: 'csv' | 'xlsx'): string {
  return `pharmacy-${report}-${'on' in range ? range.on : `${range.from}_${range.to}`}.${ext}`;
}
