import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { batchHash, PHARMACY_IMPORT_MAX_ROWS, PRODUCT_COLUMNS, suggestMapping, validateRows } from '@/server/domain/pharmacy/import-products';
import { identityKeyOf } from '@/server/domain/pharmacy/product-identity';
import { packLabelOf } from '@/server/domain/pharmacy/units';
import { readSheet, SheetReadError } from '@/server/sheets/read';

const HEADERS = ['Trade name', 'Strength', 'Form', 'Manufacturer', 'Rx level', 'Pack', 'Units per pack', 'Barcode', 'Sale price', 'Currency'];
const mapping = suggestMapping(HEADERS);

const row = (over: Partial<Record<(typeof HEADERS)[number], string>> = {}): string[] => {
  const base: Record<string, string> = {
    'Trade name': 'Panadol',
    Strength: '500 mg',
    Form: 'tablet',
    Manufacturer: 'GSK',
    'Rx level': 'OTC',
    Pack: 'box',
    'Units per pack': '24',
    Barcode: '',
    'Sale price': '1500',
    Currency: 'IQD',
    ...over,
  };
  return HEADERS.map((h) => base[h]!);
};

function validate(
  rows: string[][],
  extra: Partial<Parameters<typeof validateRows>[0]> = {},
) {
  return validateRows({
    headers: HEADERS,
    rows,
    rowNumbers: rows.map((_, i) => i + 2),
    mapping,
    existingIdentityKeys: new Set(),
    existingBarcodes: new Map(),
    enabledCurrencies: ['IQD'],
    ...extra,
  });
}

const codes = (r: { issues: { code: string }[] }) => r.issues.map((i) => i.code);

describe('product import rules', () => {
  it('suggestMapping maps English, Arabic and Sorani headers and leaves an unknown header null', () => {
    const en = suggestMapping(['Trade Name', 'Generic name', 'Active ingredient', 'EAN', 'Selling price', 'Shelf']);
    expect(en).toEqual({
      'Trade Name': 'tradeName',
      'Generic name': 'genericName',
      'Active ingredient': 'activeIngredient',
      EAN: 'barcode',
      'Selling price': 'salePrice',
      Shelf: 'shelfLocation',
    });
    const ar = suggestMapping(['الاسم التجاري', 'المادة الفعالة', 'الشركة المصنعة', 'الباركود', 'سعر البيع', 'العملة']);
    expect(Object.values(ar)).toEqual(['tradeName', 'activeIngredient', 'manufacturer', 'barcode', 'salePrice', 'currency']);
    const ckb = suggestMapping(['ناوی بازرگانی', 'ماددەی کارا', 'کۆمپانیا', 'بارکۆد', 'نرخی فرۆشتن', 'ڕەف']);
    expect(Object.values(ckb)).toEqual(['tradeName', 'activeIngredient', 'manufacturer', 'barcode', 'salePrice', 'shelfLocation']);
    const odd = suggestMapping(['Favourite colour', 'Notes', '', 'Trade name']);
    expect(odd['Favourite colour']).toBeNull();
    expect(odd['Notes']).toBeNull();
    expect(odd['Trade name']).toBe('tradeName');
    expect(PRODUCT_COLUMNS).toHaveLength(15);
  });

  it('a barcode cell 1.23457E+12 is an error LOSSY_BARCODE naming its row', () => {
    const result = validate([row(), row({ 'Trade name': 'Brufen', Barcode: '1.23457E+12' })]);
    const bad = result.rows[1]!;
    expect(bad.status).toBe('error');
    const issue = bad.issues.find((i) => i.code === 'LOSSY_BARCODE')!;
    expect(issue.field).toBe('barcode');
    expect(issue.message).toContain('row 3');
    expect(result.summary).toEqual({ ok: 1, warnings: 0, errors: 1, duplicates: 0 });
  });

  it('a numeric barcode of 7 digits from a number cell is a warning (leading zeros may be lost)', () => {
    const rows = [row({ Barcode: '1234567' })];
    const fromNumber = validate(rows, { numericCells: [HEADERS.map((h) => h === 'Barcode')] });
    expect(fromNumber.rows[0]!.status).toBe('warning');
    expect(codes(fromNumber.rows[0]!)).toContain('LOSSY_BARCODE');
    expect(fromNumber.rows[0]!.values.barcode).toBe('1234567');
    expect(fromNumber.summary.warnings).toBe(1);
    // the same text in a text cell is just a barcode
    expect(validate(rows).rows[0]!.status).toBe('ok');
  });

  it('a barcode read as text keeps its zeros', async () => {
    const csv = 'Trade name,Rx level,Pack,Units per pack,Barcode\nPanadol,OTC,box,24,00012345\n';
    const sheet = await readSheet(new TextEncoder().encode(csv));
    const headers = sheet.headers;
    const result = validateRows({
      headers,
      rows: sheet.rows,
      rowNumbers: sheet.rowNumbers,
      numericCells: sheet.numericCells,
      mapping: suggestMapping(headers),
      existingIdentityKeys: new Set(),
      existingBarcodes: new Map(),
      enabledCurrencies: ['IQD'],
    });
    expect(result.rows[0]!.values.barcode).toBe('00012345');
    expect(codes(result.rows[0]!)).not.toContain('LOSSY_BARCODE');
    // 8 digits, wrong check digit: a warning, never an error
    expect(result.rows[0]!.status).toBe('warning');
    expect(codes(result.rows[0]!)).toEqual(['BARCODE_CHECK_DIGIT']);
  });

  it('prices with Arabic-Indic digits and thousands separators parse', () => {
    const result = validate([
      row({ 'Sale price': '١٥٠٠' }),
      row({ 'Trade name': 'B', 'Sale price': '12,500' }),
      row({ 'Trade name': 'C', 'Sale price': '١٢٬٥٠٠' }),
      row({ 'Trade name': 'D', 'Sale price': '12,50' }),
      row({ 'Trade name': 'E', 'Sale price': '' }),
    ]);
    expect(result.rows[0]!.values.salePrice).toEqual({ amount: 1500n, currency: 'IQD' });
    expect(result.rows[1]!.values.salePrice).toEqual({ amount: 12500n, currency: 'IQD' });
    expect(result.rows[2]!.values.salePrice).toEqual({ amount: 12500n, currency: 'IQD' });
    // "12,50" is refused, never read as 1250
    expect(codes(result.rows[3]!)).toContain('BAD_PRICE');
    expect(result.rows[3]!.status).toBe('error');
    // no price is allowed
    expect(result.rows[4]!.status).toBe('ok');
    expect(result.rows[4]!.values.salePrice).toBeNull();
  });

  it('a row repeated in the file is DUPLICATE_IN_FILE pointing to the first row', () => {
    const result = validate([row(), row({ 'Trade name': 'Other' }), row({ 'Trade name': 'PANADOL', Strength: '500MG' })]);
    expect(result.rows[0]!.status).toBe('ok');
    const dup = result.rows[2]!;
    expect(dup.status).toBe('error');
    const issue = dup.issues.find((i) => i.code === 'DUPLICATE_IN_FILE')!;
    expect(issue.message).toContain('row 2');
  });

  it('500 mg and 1000 mg rows with the same name are both ok', () => {
    const result = validate([row(), row({ Strength: '1000 mg' })]);
    expect(result.rows.map((r) => r.status)).toEqual(['ok', 'ok']);
  });

  it('a row that matches an existing product is duplicate and never updates it', () => {
    const key = identityKeyOf({
      tradeName: 'Panadol',
      strength: '500 mg',
      form: 'tablet',
      manufacturer: 'GSK',
      packLabel: packLabelOf([{ level: 1, label: 'box', baseQty: 24, sellable: true }]),
    });
    const result = validate([row(), row({ Strength: '1000 mg' })], { existingIdentityKeys: new Set([key]) });
    expect(result.rows[0]!.status).toBe('duplicate');
    expect(codes(result.rows[0]!)).toEqual(['DUPLICATE_PRODUCT']);
    expect(result.rows[1]!.status).toBe('ok');
    expect(result.summary).toEqual({ ok: 1, warnings: 0, errors: 0, duplicates: 1 });
  });

  it('a barcode held by another product is BARCODE_IN_USE, and a repeat in the file too', () => {
    const code = '6221031234567';
    const result = validate(
      [row({ Barcode: code }), row({ 'Trade name': 'B', Barcode: '5901234123457' }), row({ 'Trade name': 'C', Barcode: '5901234123457' })],
      { existingBarcodes: new Map([[code, 'prod-1']]) },
    );
    expect(codes(result.rows[0]!)).toContain('BARCODE_IN_USE');
    expect(result.rows[0]!.status).toBe('error');
    expect(codes(result.rows[2]!)).toContain('BARCODE_IN_USE');
    expect(result.rows[2]!.issues.find((i) => i.code === 'BARCODE_IN_USE')!.message).toContain('row 3');
    expect(result.rows[1]!.status).toBe('ok');
  });

  it('a USD price on an IQD-only business is an error', () => {
    const result = validate([row({ 'Sale price': '2.50', Currency: 'USD' }), row({ 'Trade name': 'B', 'Sale price': '2.50', Currency: 'USD' })], {
      enabledCurrencies: ['IQD', 'USD'],
    });
    expect(result.rows[0]!.status).toBe('ok');
    expect(result.rows[0]!.values.salePrice).toEqual({ amount: 250n, currency: 'USD' });
    const iqdOnly = validate([row({ 'Sale price': '2.50', Currency: 'USD' })]);
    expect(iqdOnly.rows[0]!.status).toBe('error');
    expect(codes(iqdOnly.rows[0]!)).toEqual(['CURRENCY_NOT_ENABLED']);
  });

  it('a UTF-8 BOM CSV reads the first header correctly', async () => {
    const csv = '﻿Trade name,Rx level,Pack,Units per pack\nPanadol,OTC,box,24\n';
    const sheet = await readSheet(new TextEncoder().encode(csv));
    expect(suggestMapping(sheet.headers)[sheet.headers[0]!]).toBe('tradeName');
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('الاسم التجاري,Rx\nX,OTC\n')]);
    const arabic = await readSheet(bytes);
    expect(suggestMapping(arabic.headers)[arabic.headers[0]!]).toBe('tradeName');
  });

  it('5,000 rows validate in under 2 seconds', () => {
    const rows = Array.from({ length: 5_000 }, (_, i) => row({ 'Trade name': `Product ${i}`, Barcode: String(1000000000000 + i), 'Sale price': '1,500' }));
    const started = performance.now();
    const result = validate(rows);
    const took = performance.now() - started;
    expect(result.rows).toHaveLength(5_000);
    expect(took).toBeLessThan(2_000);
    // a hostile long cell stays fast too
    const hostile = validate([row({ 'Trade name': '1'.repeat(100_000), Strength: '٠'.repeat(100_000), 'Sale price': '1,'.repeat(50_000) })]);
    expect(hostile.rows[0]!.status).toBe('error');
  });

  it('an unknown rx level is an error and is never defaulted to OTC', () => {
    const result = validate([
      row({ 'Rx level': 'sometimes' }),
      row({ 'Trade name': 'B', 'Rx level': '' }),
      row({ 'Trade name': 'C', 'Rx level': 'prescription' }),
      row({ 'Trade name': 'D', 'Rx level': 'بدون وصفة' }),
      row({ 'Trade name': 'E', 'Rx level': 'controlled' }),
    ]);
    expect(result.rows[0]!.status).toBe('error');
    expect(codes(result.rows[0]!)).toEqual(['UNKNOWN_RX_LEVEL']);
    expect(result.rows[0]!.values.rxLevel).toBeNull();
    expect(result.rows[1]!.values.rxLevel).toBeNull();
    expect(result.rows[1]!.status).toBe('error');
    expect(result.rows.slice(2).map((r) => r.values.rxLevel)).toEqual(['RX', 'OTC', 'RESTRICTED']);
  });

  it('flags a missing name and a bad pack, and the batch hash follows the rows and the mapping', () => {
    const result = validate([row({ 'Trade name': '' }), row({ 'Trade name': 'B', 'Units per pack': 'many' }), row({ 'Trade name': 'C', Pack: '' })]);
    expect(codes(result.rows[0]!)).toContain('MISSING_NAME');
    expect(codes(result.rows[1]!)).toContain('BAD_PACK');
    expect(codes(result.rows[2]!)).toContain('BAD_PACK');
    const a = batchHash(result.rows, mapping);
    expect(batchHash(result.rows, mapping)).toBe(a);
    expect(batchHash(result.rows, { ...mapping, Barcode: null })).not.toBe(a);
    expect(batchHash(result.rows.slice(1), mapping)).not.toBe(a);
  });

  it('the sheet reader tells number cells from text and takes a row cap', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('p');
    sheet.addRow(['Trade name', 'Barcode']);
    sheet.addRow(['A', 1234567]);
    sheet.addRow(['B', '0001234']);
    sheet.addRow(['C', '1']);
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
    const read = await readSheet(bytes);
    expect(read.numericCells).toEqual([
      [false, true],
      [false, false],
      [false, false],
    ]);
    await expect(readSheet(bytes, { maxRows: 2 })).rejects.toEqual(new SheetReadError('TOO_MANY_ROWS'));
    expect((await readSheet(bytes, { maxRows: 3 })).rows).toHaveLength(3);
  });
});

describe('product import defaults and fix-round rules', () => {
  const SHORT = ['Trade name', 'Sale price', 'Barcode'];
  const shortRows = [
    ['Panadol', '1500', '6221031234569'],
    ['Brufen', '2000', '5901234123457'],
  ];
  const run = (extra: Partial<Parameters<typeof validateRows>[0]> = {}, rows = shortRows, headers = SHORT) =>
    validateRows({
      headers,
      rows,
      rowNumbers: rows.map((_, i) => i + 2),
      mapping: suggestMapping(headers),
      existingIdentityKeys: new Set(),
      existingBarcodes: new Map(),
      enabledCurrencies: ['IQD'],
      ...extra,
    });
  const DEFAULTS = { rxLevel: 'OTC', packLabel: 'box', unitsPerPack: 1 } as const;

  it('without defaults a sheet with only name, price and barcode errors on every row', () => {
    const result = run();
    expect(result.rows.map((r) => r.status)).toEqual(['error', 'error']);
    expect(codes(result.rows[0]!).sort()).toEqual(['BAD_PACK', 'UNKNOWN_RX_LEVEL']);
  });

  it('defaults fill empty cells, each row says so with DEFAULT_APPLIED, and the identity matches the service', () => {
    const result = run({ defaults: DEFAULTS });
    expect(result.rows.map((r) => r.status)).toEqual(['ok', 'ok']);
    const first = result.rows[0]!;
    expect(first.values).toMatchObject({ rxLevel: 'OTC', packLabel: 'box', unitsPerPack: 1 });
    expect(first.issues.filter((i) => i.code === 'DEFAULT_APPLIED').map((i) => i.field).sort()).toEqual(['packLabel', 'rxLevel', 'unitsPerPack']);
    const serviceKey = identityKeyOf({
      tradeName: 'Panadol',
      strength: '',
      form: '',
      manufacturer: '',
      packLabel: packLabelOf([{ level: 0, label: 'box', baseQty: 1, sellable: true }]),
    });
    expect(first.identityKey).toBe(serviceKey);
  });

  it('a default never overwrites a cell with content, and an unknown rx value still errors', () => {
    const headers = [...SHORT, 'Rx level', 'Pack', 'Units per pack'];
    const result = run(
      { defaults: DEFAULTS },
      [
        ['A', '1', '', 'RX', 'strip', '10'],
        ['B', '1', '', 'whatever', 'strip', '10'],
      ],
      headers,
    );
    expect(result.rows[0]!.values).toMatchObject({ rxLevel: 'RX', packLabel: 'strip', unitsPerPack: 10 });
    expect(codes(result.rows[0]!)).not.toContain('DEFAULT_APPLIED');
    expect(codes(result.rows[1]!)).toEqual(['UNKNOWN_RX_LEVEL']);
    expect(result.rows[1]!.status).toBe('error');
  });

  it('the batch hash changes with the defaults', () => {
    const m = suggestMapping(SHORT);
    const a = run({ defaults: DEFAULTS });
    expect(batchHash(a.rows, m, DEFAULTS)).not.toBe(batchHash(a.rows, m, { ...DEFAULTS, unitsPerPack: 2 }));
    expect(batchHash(a.rows, m, DEFAULTS)).toBe(batchHash(a.rows, m, { ...DEFAULTS }));
  });

  it('an invalid default is refused with defaultsError and no rows', () => {
    for (const [bad, field] of [
      [{ rxLevel: 'MAYBE' }, 'rxLevel'],
      [{ packLabel: '  ' }, 'packLabel'],
      [{ packLabel: 'x'.repeat(61) }, 'packLabel'],
      [{ unitsPerPack: 0 }, 'unitsPerPack'],
      [{ unitsPerPack: 1.5 }, 'unitsPerPack'],
    ] as const) {
      const result = run({ defaults: bad as never });
      expect(result.defaultsError?.field).toBe(field);
      expect(result.rows).toEqual([]);
    }
  });

  it('a price of 0 is a warning ZERO_PRICE and a negative price is BAD_PRICE', () => {
    const result = validate([row({ 'Sale price': '0' }), row({ 'Trade name': 'B', 'Sale price': '-5' })]);
    expect(result.rows[0]!.status).toBe('warning');
    expect(codes(result.rows[0]!)).toEqual(['ZERO_PRICE']);
    expect(result.rows[1]!.status).toBe('error');
    expect(codes(result.rows[1]!)).toEqual(['BAD_PRICE']);
  });

  it('a ladder tablet / 24-tablet box has the same identity as an import row box / 24', () => {
    const levels = [
      { level: 0, label: 'tablet', baseQty: 1, sellable: true },
      { level: 1, label: 'box', baseQty: 24, sellable: true },
    ];
    const serviceKey = identityKeyOf({ tradeName: 'Panadol', strength: '500 mg', form: 'tablet', manufacturer: 'GSK', packLabel: packLabelOf(levels) });
    expect(validate([row()]).rows[0]!.identityKey).toBe(serviceKey);
  });

  it('an XLSX text cell 0001234 keeps its zeros and is not flagged lossy', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('p');
    sheet.addRow(['Trade name', 'Rx level', 'Pack', 'Units per pack', 'Barcode']);
    sheet.addRow(['A', 'OTC', 'box', '1', '0001234']);
    const read = await readSheet(new Uint8Array(await workbook.xlsx.writeBuffer()));
    expect(read.rows[0]![4]).toBe('0001234');
    const result = validateRows({
      headers: read.headers,
      rows: read.rows,
      rowNumbers: read.rowNumbers,
      numericCells: read.numericCells,
      mapping: suggestMapping(read.headers),
      existingIdentityKeys: new Set(),
      existingBarcodes: new Map(),
      enabledCurrencies: ['IQD'],
    });
    expect(result.rows[0]!.values.barcode).toBe('0001234');
    expect(result.rows[0]!.status).toBe('ok');
  });

  it('the pharmacy import row cap is 10,000', () => {
    expect(PHARMACY_IMPORT_MAX_ROWS).toBe(10_000);
  });
});
