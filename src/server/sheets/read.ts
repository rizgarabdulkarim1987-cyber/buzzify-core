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
  /** Per row and cell: whether the cell held a number (an Excel number cell), not text. Always false in a CSV. */
  numericCells: boolean[][];
}

export interface ReadOptions {
  /** The most data rows read; the menu import's {@link MAX_SHEET_ROWS} when not given. */
  maxRows?: number;
}

const isBlank = (cells: readonly string[]) => cells.every((cell) => cell.trim() === '');

/** The first row with anything in it is the header; the rows after it with anything in them are the data. */
function sheetOf(lines: string[][], numeric: boolean[][] | null, maxRows: number): ReadSheet {
  const headerIndex = lines.findIndex((cells) => !isBlank(cells));
  if (headerIndex < 0) throw new SheetReadError('EMPTY');
  const rows: string[][] = [];
  const rowNumbers: number[] = [];
  const numericCells: boolean[][] = [];
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const cells = lines[index]!;
    if (isBlank(cells)) continue;
    if (rows.length === maxRows) throw new SheetReadError('TOO_MANY_ROWS');
    rows.push(cells);
    rowNumbers.push(index + 1);
    numericCells.push(numeric ? numeric[index]! : cells.map(() => false));
  }
  return { headers: lines[headerIndex]!, rows, rowNumbers, numericCells };
}

// CSV -----------------------------------------------------------------------------------------------------------------

function readCsv(bytes: Uint8Array, maxRows: number): ReadSheet {
  let text: string;
  try {
    // Fatal: a sheet saved in Windows-1256 (Excel's "CSV" in Arabic Windows) is refused, never read as garbage.
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new SheetReadError('ENCODING');
  }
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ''), { delimitersToGuess: [',', ';', '\t'], skipEmptyLines: false });
  if (parsed.errors.some((error) => error.type === 'Quotes')) throw new SheetReadError('UNREADABLE');
  return sheetOf(parsed.data, null, maxRows);
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

/** A cell that holds a number (or a formula that gives one): a spreadsheet may have shown a code in it as a number. */
function isNumberCell(cell: ExcelJS.Cell): boolean {
  const value = cell.value;
  if (typeof value === 'number') return true;
  return typeof value === 'object' && value !== null && 'result' in value && typeof (value as { result?: unknown }).result === 'number';
}

/**
 * The most bytes the files inside one workbook may hold once unpacked, as its ZIP directory states them. A real menu or
 * catalog of 10,000 rows unpacks to a few MB; a file far smaller than the upload limit that claims more (a "zip bomb")
 * is refused before anything is unpacked.
 */
export const MAX_XLSX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;

/**
 * The most columns a worksheet may span. Every row is read across the sheet's full width, so one stray cell far to the
 * right (column XFD is the 16,384th) would multiply the work by thousands; a real sheet has a few dozen columns.
 */
export const MAX_SHEET_COLUMNS = 200;

/**
 * The total unpacked size the ZIP central directory states for its entries, or null when the bytes have no readable
 * directory. An entry whose size is in a ZIP64 record (stated as 0xFFFFFFFF) counts as too large: no workbook of the
 * size we accept needs one.
 */
export function zipUncompressedSize(bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end-of-central-directory record: 22 bytes, then a comment of at most 65,535 bytes.
  const lowest = Math.max(0, bytes.length - 22 - 0xffff);
  let end = -1;
  for (let at = bytes.length - 22; at >= lowest; at -= 1) {
    if (view.getUint32(at, true) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) return null;
  const entries = view.getUint16(end + 10, true);
  const size = view.getUint32(end + 12, true);
  const offset = view.getUint32(end + 16, true);
  if (offset + size > end) return null;
  let total = 0;
  let at = offset;
  for (let index = 0; index < entries; index += 1) {
    if (at + 46 > end || view.getUint32(at, true) !== 0x02014b50) return null;
    const uncompressed = view.getUint32(at + 24, true);
    if (uncompressed === 0xffffffff) return Number.POSITIVE_INFINITY;
    total += uncompressed;
    at += 46 + view.getUint16(at + 28, true) + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return total;
}

async function readXlsx(bytes: Uint8Array, maxRows: number): Promise<ReadSheet> {
  const unpacked = zipUncompressedSize(bytes);
  if (unpacked === null || unpacked > MAX_XLSX_UNCOMPRESSED_BYTES) throw new SheetReadError('UNREADABLE');
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Buffer.from(bytes) as never);
  } catch {
    throw new SheetReadError('UNREADABLE');
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new SheetReadError('EMPTY');
  // Refused before reading every cell: a sheet with many rows is not worth the work.
  if (sheet.actualRowCount > maxRows + 1 + 50) throw new SheetReadError('TOO_MANY_ROWS');
  const width = sheet.columnCount;
  if (width > MAX_SHEET_COLUMNS) throw new SheetReadError('UNREADABLE');
  const lines: string[][] = [];
  const numeric: boolean[][] = [];
  for (let number = 1; number <= sheet.rowCount; number += 1) {
    const row = sheet.getRow(number);
    lines.push(Array.from({ length: width }, (_, index) => cellText(row.getCell(index + 1))));
    numeric.push(Array.from({ length: width }, (_, index) => isNumberCell(row.getCell(index + 1))));
  }
  return sheetOf(lines, numeric, maxRows);
}

/** An XLSX file is a ZIP: it starts with `PK\x03\x04`. */
export const isZip = (bytes: Uint8Array) => bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;

/** The sheet in `bytes`: an Excel workbook by its signature, a CSV otherwise. Throws `SheetReadError`. */
export async function readSheet(bytes: Uint8Array, options: ReadOptions = {}): Promise<ReadSheet> {
  const maxRows = options.maxRows ?? MAX_SHEET_ROWS;
  return isZip(bytes) ? readXlsx(bytes, maxRows) : readCsv(bytes, maxRows);
}
