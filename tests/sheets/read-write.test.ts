import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { MAX_SHEET_COLUMNS, MAX_SHEET_ROWS, MAX_XLSX_UNCOMPRESSED_BYTES, readSheet, SheetReadError, zipUncompressedSize } from '@/server/sheets/read';
import { writeCsv, writeXlsx } from '@/server/sheets/write';

const utf8 = (text: string) => new TextEncoder().encode(text);
const BOM = '﻿';

describe('reading a sheet', () => {
  it.each([
    ['without a byte order mark', 'category_slug,name_en,price\r\ncoffee,Espresso,3.00\r\n'],
    ['with a byte order mark', `${BOM}category_slug,name_en,price\r\ncoffee,Espresso,3.00\r\n`],
    ['with semicolons', 'category_slug;name_en;price\ncoffee;Espresso;3,00\n'],
    ['with tabs', 'category_slug\tname_en\tprice\ncoffee\tEspresso\t3.00\n'],
  ])('reads a CSV %s', async (_, text) => {
    const sheet = await readSheet(utf8(text));
    expect(sheet.headers).toEqual(['category_slug', 'name_en', 'price']);
    expect(sheet.rows).toHaveLength(1);
    expect(sheet.rows[0]!.slice(0, 2)).toEqual(['coffee', 'Espresso']);
  });

  it('keeps quoted commas, quotes and line breaks', async () => {
    const sheet = await readSheet(utf8('name_en,description_en\r\n"Tea, mint","Says ""hi""\r\non two lines"\r\n'));
    expect(sheet.rows).toEqual([['Tea, mint', 'Says "hi"\r\non two lines']]);
  });

  it('refuses a Windows-1256 CSV and says to save it as CSV UTF-8', async () => {
    // "قهوة" in Windows-1256: bytes that are not UTF-8.
    const bytes = new Uint8Array([...utf8('category_slug,name_en,name_ar,price\ncoffee,Coffee,'), 0xe2, 0xe5, 0xe6, 0xc9, ...utf8(',3\n')]);
    await expect(readSheet(bytes)).rejects.toEqual(new SheetReadError('ENCODING'));
  });

  it('refuses more than 2,000 rows', async () => {
    const rows = Array.from({ length: MAX_SHEET_ROWS + 1 }, (_, index) => `coffee,Product ${index},1`);
    await expect(readSheet(utf8(['category_slug,name_en,price', ...rows].join('\n')))).rejects.toEqual(new SheetReadError('TOO_MANY_ROWS'));
    expect((await readSheet(utf8(['category_slug,name_en,price', ...rows.slice(1)].join('\n')))).rows).toHaveLength(MAX_SHEET_ROWS);
  });

  it('refuses a file with no header row', async () => {
    await expect(readSheet(utf8(''))).rejects.toEqual(new SheetReadError('EMPTY'));
  });

  it('skips rows with nothing in them', async () => {
    const sheet = await readSheet(utf8('category_slug,name_en,price\n,,\ncoffee,Espresso,3\n\n'));
    expect(sheet.rows).toEqual([['coffee', 'Espresso', '3']]);
  });

  it('reads the first worksheet of an XLSX, numbers and text alike', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Menu');
    sheet.addRow(['category_slug', 'name_en', 'price', 'calories']);
    sheet.addRow(['coffee', 'Espresso', 4.5, 120]);
    const price = sheet.getCell('C2');
    price.numFmt = '0.00';
    workbook.addWorksheet('Notes').addRow(['ignored']);
    const read = await readSheet(new Uint8Array(await workbook.xlsx.writeBuffer()));
    expect(read.headers).toEqual(['category_slug', 'name_en', 'price', 'calories']);
    expect(read.rows).toEqual([['coffee', 'Espresso', '4.50', '120']]);
  });
});

describe('writing a sheet', () => {
  const rows = [
    ['category_slug', 'name_en', 'name_ar', 'name_ckb', 'description_en', 'price'],
    ['coffee', "'=SUM(A1)", 'قهوة عربية', 'قاوەی کوردی', 'Strong, "dark"\non two lines', '6000'],
    ['coffee', "'+1 shot", 'شاي', 'چا', "'@home", '4.50'],
  ];

  it('writes CSV as UTF-8 with a byte order mark, CRLF and RFC 4180 quoting', () => {
    const bytes = writeCsv(rows);
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('\r\ncoffee,\'=SUM(A1),قهوة عربية,قاوەی کوردی,"Strong, ""dark""\non two lines",6000\r\n');
  });

  it.each(['csv', 'xlsx'] as const)('round-trips Arabic, Sorani and formula-like text through %s', async (format) => {
    const bytes = format === 'csv' ? writeCsv(rows) : await writeXlsx(rows);
    const read = await readSheet(bytes);
    expect([read.headers, ...read.rows]).toEqual(rows);
  });

  it('writes every XLSX cell as text with a bold header', async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await writeXlsx(rows)) as never);
    const sheet = workbook.worksheets[0]!;
    expect(sheet.getCell('A1').font?.bold).toBe(true);
    expect(sheet.getCell('F2').value).toBe('6000');
    expect(sheet.getColumn(6).numFmt).toBe('@');
  });
});

describe('reading a workbook within its caps', () => {
  /** The workbook with the first entry of its ZIP directory claiming `size` unpacked bytes (the packed data unchanged). */
  function claiming(bytes: Uint8Array, size: number): Uint8Array {
    const copy = new Uint8Array(bytes);
    const view = new DataView(copy.buffer);
    for (let at = copy.length - 22; at >= 0; at -= 1) {
      if (view.getUint32(at, true) !== 0x06054b50) continue;
      view.setUint32(view.getUint32(at + 16, true) + 24, size, true);
      return copy;
    }
    throw new Error('No ZIP directory');
  }

  it('reads the unpacked size a normal workbook states, well under the cap', async () => {
    const bytes = await writeXlsx([['name_en', 'price'], ['Espresso', '3.00']]);
    const size = zipUncompressedSize(bytes)!;
    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThan(MAX_XLSX_UNCOMPRESSED_BYTES);
    expect((await readSheet(bytes)).rows).toEqual([['Espresso', '3.00']]);
  });

  it('refuses, before unpacking, a small file that claims more than 50 MB unpacked', async () => {
    const bytes = claiming(await writeXlsx([['name_en'], ['Espresso']]), 60 * 1024 * 1024);
    expect(bytes.length).toBeLessThan(20_000);
    const started = performance.now();
    await expect(readSheet(bytes)).rejects.toEqual(new SheetReadError('UNREADABLE'));
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it('refuses an entry whose size is only in a ZIP64 record, and a ZIP with no directory', async () => {
    const bytes = await writeXlsx([['name_en'], ['Espresso']]);
    await expect(readSheet(claiming(bytes, 0xffffffff))).rejects.toEqual(new SheetReadError('UNREADABLE'));
    await expect(readSheet(bytes.slice(0, bytes.length - 30))).rejects.toEqual(new SheetReadError('UNREADABLE'));
  });

  it('refuses, fast, a sheet with a stray cell at column XFD row 10,050', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Menu');
    sheet.getCell('A1').value = 'name_en';
    sheet.getCell('A2').value = 'Espresso';
    sheet.getCell('XFD10050').value = 'x';
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
    const started = performance.now();
    await expect(readSheet(bytes, { maxRows: 10_000 })).rejects.toEqual(new SheetReadError('UNREADABLE'));
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it('reads, fast, a sheet with a stray cell at A1048576, keeping every row its real number', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Menu');
    sheet.getCell('A1').value = 'name_en';
    sheet.getCell('A2').value = 'Espresso';
    // A blank row in the middle stays skipped, and the rows after it keep their numbers.
    sheet.getCell('A4').value = 'Latte';
    sheet.getCell('A1048576').value = 'Stray';
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
    expect(bytes.length).toBeLessThan(20_000);
    const started = performance.now();
    const read = await readSheet(bytes);
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(read.headers).toEqual(['name_en']);
    expect(read.rows).toEqual([['Espresso'], ['Latte'], ['Stray']]);
    expect(read.rowNumbers).toEqual([2, 4, 1_048_576]);
  });

  it(`reads a sheet ${MAX_SHEET_COLUMNS} columns wide and refuses one column more`, async () => {
    const wide = (columns: number) => writeXlsx([Array.from({ length: columns }, (_, index) => `c${index}`), Array.from({ length: columns }, () => 'v')]);
    expect((await readSheet(await wide(MAX_SHEET_COLUMNS))).headers).toHaveLength(MAX_SHEET_COLUMNS);
    await expect(readSheet(await wide(MAX_SHEET_COLUMNS + 1))).rejects.toEqual(new SheetReadError('UNREADABLE'));
  });
});