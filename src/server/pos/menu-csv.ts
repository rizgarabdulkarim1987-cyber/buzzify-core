import Papa from 'papaparse';
import { SHEET_COLUMNS, type SheetColumn } from '@/server/domain/import-sheet';
import { SLUG_MAX } from '@/server/domain/slug';
import { StudioError } from '@/server/studio/framework/result';
import { slugFromNames, uniqueSlug } from '@/server/studio/services/content';

/**
 * The cashier's old product list, a CSV of `category, name_ar, name_ckb, name_en, price`, read as a pure function and
 * turned into the Studio's own menu sheet, so the Studio's importer does the preview, the draft check, the writes and the
 * audit. Nothing here touches the database. A cell that looks like a formula (starts with = + - @) is plain text.
 */

export const MAX_POS_CSV_ROWS = 2_000;
const MAX_NAME_LENGTH = 120;
const MAX_PRICE = 2_147_483_647;

export type PosCsvErrorCode = 'empty' | 'missingColumns' | 'badPrice' | 'noCategory' | 'noName' | 'tooLong' | 'tooManyRows' | 'unclosedQuote' | 'badEncoding';

export type PosCsvNames = { ar?: string; ckb?: string; en?: string };
export type PosCsvRow = { category: string; names: PosCsvNames; price: number };
export type PosCsvError = { line: number; code: PosCsvErrorCode };
export interface ParsedPosCsv {
  rows: PosCsvRow[];
  /** The file line each row came from. */
  lines: number[];
  errors: PosCsvError[];
}

interface RawRecord {
  fields: string[];
  line: number;
  unclosed: boolean;
}

/** `;` when the header line has more of them than commas (outside quotes), else `,`. */
function detectDelimiter(text: string): ',' | ';' {
  let commas = 0;
  let semicolons = 0;
  let quoted = false;
  for (const c of text) {
    if (c === '"') quoted = !quoted;
    else if (!quoted) {
      if (c === '\n' || c === '\r') {
        if (commas + semicolons > 0) break;
      } else if (c === ',') commas += 1;
      else if (c === ';') semicolons += 1;
    }
  }
  return semicolons > commas ? ';' : ',';
}

function splitRecords(text: string, delimiter: string): RawRecord[] {
  const records: RawRecord[] = [];
  let fields: string[] = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  const endRecord = () => {
    fields.push(field);
    records.push({ fields, line: recordLine, unclosed: false });
    fields = [];
    field = '';
    line += 1;
    recordLine = line;
  };
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else inQuotes = false;
      } else {
        if (c === '\n') line += 1;
        field += c;
      }
    } else if (c === '"' && field === '') {
      inQuotes = true;
    } else if (c === delimiter) {
      fields.push(field);
      field = '';
    } else if (c === '\r') {
      if (text[i + 1] === '\n') i += 1;
      endRecord();
    } else if (c === '\n') {
      endRecord();
    } else field += c;
  }
  if (inQuotes) records.push({ fields: [...fields, field], line: recordLine, unclosed: true });
  else if (field !== '' || fields.length > 0) endRecord();
  return records;
}

/** Arabic-Indic and Persian digits to 0-9. */
function latinDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/**
 * A whole, non-negative amount. Either plain digits, or groups of exactly three digits after a first group of one to
 * three, separated by , U+066C or a space: "12,500" is 12500 but "12,5" is refused (Excel in Arabic locales writes a
 * comma as the decimal mark, so it must never be read as 125). A decimal is an error, never rounded.
 */
export function parsePosPrice(raw: string): number | null {
  const text = latinDigits(raw).trim();
  const grouped = /^\d{1,3}(?:[,٬   ]\d{3})+$/.test(text);
  if (!grouped && !/^\d{1,10}$/.test(text)) return null;
  const amount = Number(text.replace(/\D/g, ''));
  return amount <= MAX_PRICE ? amount : null;
}

const NAME_COLUMNS = { name_ar: 'ar', name_ckb: 'ckb', name_en: 'en' } as const;

export function parsePosCsv(input: string): ParsedPosCsv {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  if (text.includes('�')) return { rows: [], lines: [], errors: [{ line: 1, code: 'badEncoding' }] };
  const records = splitRecords(text, detectDelimiter(text)).filter((record) => record.unclosed || record.fields.some((field) => field.trim() !== ''));
  if (records.length === 0) return { rows: [], lines: [], errors: [{ line: 1, code: 'empty' }] };

  const [header, ...data] = records as [RawRecord, ...RawRecord[]];
  const column = new Map<string, number>();
  header.fields.forEach((field, index) => {
    const key = field.trim().toLowerCase();
    if (!column.has(key)) column.set(key, index);
  });
  const nameColumns = (Object.keys(NAME_COLUMNS) as (keyof typeof NAME_COLUMNS)[]).filter((key) => column.has(key));
  if (header.unclosed || !column.has('category') || !column.has('price') || nameColumns.length === 0) {
    return { rows: [], lines: [], errors: [{ line: header.line, code: header.unclosed ? 'unclosedQuote' : 'missingColumns' }] };
  }

  const rows: PosCsvRow[] = [];
  const lines: number[] = [];
  const errors: PosCsvError[] = [];
  for (const [index, record] of data.entries()) {
    // Nothing past the cap is read: one error names the first row over it.
    if (index === MAX_POS_CSV_ROWS) {
      errors.push({ line: record.line, code: 'tooManyRows' });
      break;
    }
    if (record.unclosed) {
      errors.push({ line: record.line, code: 'unclosedQuote' });
      continue;
    }
    const cell = (key: string) => (record.fields[column.get(key) as number] ?? '').trim();
    const category = cell('category');
    const names: PosCsvNames = {};
    for (const key of nameColumns) {
      const value = cell(key);
      if (value !== '') names[NAME_COLUMNS[key]] = value;
    }
    const price = parsePosPrice(cell('price'));
    let code: PosCsvErrorCode | null = null;
    if (category === '') code = 'noCategory';
    else if (Object.keys(names).length === 0) code = 'noName';
    else if (category.length > MAX_NAME_LENGTH || Object.values(names).some((name) => name.length > MAX_NAME_LENGTH)) code = 'tooLong';
    else if (price === null) code = 'badPrice';
    if (code || price === null) {
      errors.push({ line: record.line, code: code ?? 'badPrice' });
      continue;
    }
    rows.push({ category, names, price });
    lines.push(record.line);
  }
  return { rows, lines, errors };
}

// Into the Studio's sheet ---------------------------------------------------------------------------------------------

/** Letters only Sorani uses; Arabic script without them is Arabic. */
const SORANI = /[ەۆێڕڵڤ]/;
const ARABIC_SCRIPT = /[؀-ۿݐ-ݿ]/;

/** The language a category's name is written in: Sorani, else Arabic script, else English. */
export function categoryLocale(name: string): 'ar' | 'ckb' | 'en' {
  if (SORANI.test(name)) return 'ckb';
  return ARABIC_SCRIPT.test(name) ? 'ar' : 'en';
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export interface ExistingCategory {
  slug: string;
  names: PosCsvNames;
}

/**
 * The file as the Studio's menu sheet (its own columns), ready for the Studio's importer. A category the menu already
 * has, under any of its names, keeps its slug; a new one gets a slug of its own. The Studio matches a product by its
 * English name inside its category, so a product with no English name carries its Arabic (else Sorani) name there too: a
 * second import of the same file then matches, instead of adding the products again.
 */
export function toStudioSheet(rows: readonly PosCsvRow[], existing: readonly ExistingCategory[]): string {
  const taken = new Set(existing.map((category) => category.slug));
  const slugs = new Map<string, string>();
  const categoryNames = new Map<string, string>();
  for (const row of rows) {
    const key = row.category.trim().toLowerCase();
    if (slugs.has(key)) continue;
    const known = existing.find((category) => Object.values(category.names).some((name) => name !== undefined && sameName(name, row.category)));
    let slug = known?.slug;
    if (!slug) {
      const locale = categoryLocale(row.category);
      slug = uniqueSlug(slugFromNames({ [locale]: row.category }, 'category').slice(0, SLUG_MAX), taken);
      taken.add(slug);
    }
    slugs.set(key, slug);
    categoryNames.set(key, row.category);
  }

  const index = (column: SheetColumn) => SHEET_COLUMNS.indexOf(column);
  const data = rows.map((row) => {
    const key = row.category.trim().toLowerCase();
    const cells: string[] = SHEET_COLUMNS.map(() => '');
    cells[index('category_slug')] = slugs.get(key)!;
    cells[index(`category_${categoryLocale(row.category)}` as SheetColumn)] = row.category;
    cells[index('name_en')] = row.names.en ?? row.names.ar ?? row.names.ckb ?? '';
    if (row.names.ar !== undefined) cells[index('name_ar')] = row.names.ar;
    if (row.names.ckb !== undefined) cells[index('name_ckb')] = row.names.ckb;
    cells[index('price')] = String(row.price);
    return cells;
  });
  return Papa.unparse({ fields: [...SHEET_COLUMNS], data });
}

/** Why a file was refused, as the Studio's sentences. Every row problem names its lines; none is silently dropped. */
export function refuseCsv(errors: readonly PosCsvError[]): StudioError {
  const first = errors[0]!;
  if (first.code === 'tooManyRows') return new StudioError('INVALID', 'Use at most 2,000 rows');
  if (first.code === 'empty') return new StudioError('INVALID', 'This sheet is empty');
  if (first.code === 'badEncoding') return new StudioError('INVALID', 'Save the sheet as CSV UTF-8 and upload it again');
  if (first.code === 'missingColumns') return new StudioError('INVALID', 'Some columns of this sheet are not right', { missingColumns: 'category, price, name_ar / name_ckb / name_en' });
  return new StudioError('INVALID', 'Some rows of this file are not right', { rows: errors.map((error) => error.line).join(', ') });
}
