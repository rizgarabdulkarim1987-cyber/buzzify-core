import ExcelJS from 'exceljs';

/**
 * Writing the menu sheet (spec 13.3) as CSV or XLSX. The cells arrive as text, already guarded against being read as
 * formulas (`sheetRowsFromDraft`); here they are only encoded.
 */

/** A CSV cell, quoted when it holds a comma, a quote or a line break (RFC 4180). */
const csvCell = (cell: string) => (/[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);

/** UTF-8 with a byte order mark, so Excel opens Arabic and Sorani as they are; CRLF line ends. */
export function writeCsv(rows: string[][]): Uint8Array {
  const text = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  return new TextEncoder().encode(`﻿${text}\r\n`);
}

/** One worksheet, every column formatted as text (so `0012` and `4.50` stay as written), the header row bold and frozen. */
export async function writeXlsx(rows: string[][], sheetName = 'Menu'): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1 }] });
  const width = Math.max(0, ...rows.map((row) => row.length));
  sheet.columns = Array.from({ length: width }, (_, index) => ({ width: Math.min(40, Math.max(10, ...rows.slice(0, 50).map((row) => (row[index] ?? '').length + 2))), style: { numFmt: '@' } }));
  sheet.addRows(rows);
  sheet.getRow(1).font = { bold: true };
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
