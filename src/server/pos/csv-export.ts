import type { SalesBreakdown } from './report-breakdown';

type Cell = string | number;

/** A text cell a spreadsheet would run as a formula starts with one of these; it is made plain text with a leading quote. */
const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value: Cell): string {
  if (typeof value === 'number') return String(value);
  const text = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Rows as CSV: cells separated by commas, rows by CRLF, quoted where needed, text that looks like a formula made safe. */
export function toCsv(rows: readonly (readonly Cell[])[]): string {
  return rows.map((row) => `${row.map(cell).join(',')}\r\n`).join('');
}

/** The four breakdowns in one file, each under its own title and header row, with a blank row between them. */
export function breakdownCsv(breakdown: SalesBreakdown): string {
  return toCsv([
    ['By hour'],
    ['hour', 'orders', 'total'],
    ...breakdown.byHour.map((r) => [r.hour, r.orders, r.total]),
    [],
    ['By item'],
    ['name', 'quantity', 'total'],
    ...breakdown.byItem.map((r) => [r.name, r.quantity, r.total]),
    [],
    ['By staff'],
    ['staff', 'orders', 'total'],
    ...breakdown.byStaff.map((r) => [r.name, r.orders, r.total]),
    [],
    ['By payment method'],
    ['method', 'orders', 'total'],
    ...breakdown.byMethod.map((r) => [r.method, r.orders, r.total]),
  ]);
}
