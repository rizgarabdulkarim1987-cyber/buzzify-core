import ExcelJS from 'exceljs';

/** Reads an export back the way a person's spreadsheet would: cells as text, rows as arrays. Test helper (the product has its own reader, limited to 2,000 rows). */

export type Table = string[][];

/** RFC 4180 CSV (CRLF line ends, quotes doubled) after the UTF-8 byte order mark. */
export function parseCsv(bytes: Uint8Array): Table {
  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
  if (!text.startsWith('﻿')) throw new Error('The CSV has no byte order mark');
  const rows: Table = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const body = text.slice(1);
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]!;
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' && body[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i += 1;
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export async function readXlsx(bytes: Uint8Array): Promise<Table> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0]!;
  const width = sheet.columnCount;
  const rows: Table = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    rows.push(Array.from({ length: width }, (_, i) => row.getCell(i + 1).text));
  });
  return rows;
}

/** Header-keyed rows (the header row itself is the first row of the table). */
export const records = (table: Table): Array<Record<string, string>> => {
  const [head = [], ...rest] = table;
  return rest.map((row) => Object.fromEntries(head.map((name, i) => [name, row[i] ?? ''])));
};
