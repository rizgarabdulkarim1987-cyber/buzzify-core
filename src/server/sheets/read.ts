import ExcelJS from 'exceljs';
import Papa from 'papaparse';

/**
 * Reading an uploaded menu sheet (spec 13.1): an Excel workbook's first worksheet, or a CSV in UTF-8 with any of the
 * delimiters spreadsheets write. Every cell comes back as the text it shows; empty rows are skipped, and each row keeps
 * its number in the file so a problem can be named where the person will look for it.
 */

/** The most data rows an import reads (spec 13.2). */
export const MAX_SHEET_ROWS = 2_000;

export type SheetReadProblem = 'ENCODING' | 'TOO_MANY_ROWS' | 'EMPTY' | 'UNREADABLE';

export class SheetReadError extends Error {
  constructor(readonly problem: SheetReadProblem) {
    super(problem);
    this.name = 'SheetReadError';
  }
}

export interface ReadSheet {
  headers: string[];
  rows: string[][];
  /** Each row's number in the file, the header being row 1 when it is the first. */
  rowNumbers: number[];
}

const isBlank = (cells: readonly string[]) => cells.every((cell) => cell.trim() === '');

/** The first row with anything in it is the header; the rows after it with anything in them are the data. */
function sheetOf(lines: string[][]): ReadSheet {
  const headerIndex = lines.findIndex((cells) => !isBlank(cells));
  if (headerIndex < 0) throw new SheetReadError('EMPTY');
  const rows: string[][] = [];
  const rowNumbers: number[] = [];
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const cells = lines[index]!;
    if (isBlank(cells)) continue;
    if (rows.length === MAX_SHEET_ROWS) throw new SheetReadError('TOO_MANY_ROWS');
    rows.push(cells);
    rowNumbers.push(index + 1);
  }
  return { headers: lines[headerIndex]!, rows, rowNumbers };
}

// CSV -----------------------------------------------------------------------------------------------------------------

function readCsv(bytes: Uint8Array): ReadSheet {
  let text: string;
  try {
    // Fatal: a sheet saved in Windows-1256 (Excel's "CSV" in Arabic Windows) is refused, never read as garbage.
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new SheetReadError('ENCODING');
  }
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ''), { delimitersToGuess: [',', ';', '\t'], skipEmptyLines: false });
  if (parsed.errors.some((error) => error.type === 'Quotes')) throw new SheetReadError('UNREADABLE');
  return sheetOf(parsed.data);
}

// XLSX ----------------------------------------------------------------------------------------------------------------

/** A number as a cell format such as `0.00` or `#,##0.0` shows it: with that many decimals, without grouping. */
function shownNumber(value: number, numFmt: string | undefined): string {
  const decimals = numFmt ? /^[#,0]*\.(0+)/.exec(numFmt.split(';')[0]!)?.[1]?.length : undefined;
  return decimals === undefined ? String(value) : value.toFixed(decimals);
}

function cellText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return shownNumber(value, cell.numFmt);
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object' && 'result' in value) {
    // A formula: what it shows is its last result.
    const result = (value as { result?: unknown }).result;
    return typeof result === 'number' ? shownNumber(result, cell.numFmt) : result === undefined || result === null ? '' : String(result);
  }
  return cell.text ?? '';
}

async function readXlsx(bytes: Uint8Array): Promise<ReadSheet> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Buffer.from(bytes) as never);
  } catch {
    throw new SheetReadError('UNREADABLE');
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new SheetReadError('EMPTY');
  // Refused before reading every cell: a sheet with many rows is not worth the work.
  if (sheet.actualRowCount > MAX_SHEET_ROWS + 1 + 50) throw new SheetReadError('TOO_MANY_ROWS');
  const width = sheet.columnCount;
  const lines: string[][] = [];
  for (let number = 1; number <= sheet.rowCount; number += 1) {
    const row = sheet.getRow(number);
    lines.push(Array.from({ length: width }, (_, index) => cellText(row.getCell(index + 1))));
  }
  return sheetOf(lines);
}

/** An XLSX file is a ZIP: it starts with `PK\x03\x04`. */
const isZip = (bytes: Uint8Array) => bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;

/** The sheet in `bytes`: an Excel workbook by its signature, a CSV otherwise. Throws `SheetReadError`. */
export async function readSheet(bytes: Uint8Array): Promise<ReadSheet> {
  return isZip(bytes) ? readXlsx(bytes) : readCsv(bytes);
}
