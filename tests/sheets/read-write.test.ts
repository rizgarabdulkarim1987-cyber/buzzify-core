import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { MAX_SHEET_ROWS, readSheet, SheetReadError } from '@/server/sheets/read';
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
