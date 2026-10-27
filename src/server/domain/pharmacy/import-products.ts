import { createHash } from 'node:crypto';
import type { Currency } from '@/server/domain/billing/money';
import { checkDigitStatus, looksNumericLossy, normalizeScan } from './barcode';
import { assertEnabledCurrency, CurrencyNotEnabledError, parseMoney, type PhMoney } from './money';
import { identityKeyOf } from './product-identity';
import { packLabelOf } from './units';

/**
 * The product spreadsheet of a pharmacy (spec: catalog import): which column is which, and what is wrong with each row.
 * Pure: the sheet reader, the existing catalog and the enabled currencies come in as arguments. Each problem has a stable
 * `code` (the Studio words it in en, ar and ckb by code); `message` is plain English for logs and as a fallback.
 * Every per-row pattern is linear, and every cell is cut to a fixed length before it is read.
 */

/** The most data rows a pharmacy product import reads, unless the caller passes another `maxRows` to `readSheet`. */
export const PHARMACY_IMPORT_MAX_ROWS = 20_000;

export const PRODUCT_COLUMNS = [
  'tradeName',
  'genericName',
  'activeIngredient',
  'strength',
  'form',
  'manufacturer',
  'category',
  'rxLevel',
  'packLabel',
  'unitsPerPack',
  'barcode',
  'salePrice',
  'currency',
  'minQty',
  'shelfLocation',
] as const;
export type ProductColumn = (typeof PRODUCT_COLUMNS)[number];

export type ImportIssueCode =
  | 'MISSING_NAME'
  | 'TOO_LONG'
  | 'UNKNOWN_RX_LEVEL'
  | 'BAD_PACK'
  | 'BAD_PRICE'
  | 'CURRENCY_NOT_ENABLED'
  | 'BAD_MIN_QTY'
  | 'LOSSY_BARCODE'
  | 'BARCODE_CHECK_DIGIT'
  | 'BARCODE_IN_USE'
  | 'DUPLICATE_IN_FILE'
  | 'DUPLICATE_PRODUCT';

export type ImportIssue = { code: ImportIssueCode; field: ProductColumn; severity: 'error' | 'warning' | 'info'; message: string };

export type RxLevel = 'OTC' | 'RX' | 'RESTRICTED';

/** A row as read. A field that could not be read is empty (text), null (number, price, rx level). */
export type ParsedProduct = {
  tradeName: string;
  genericName: string;
  activeIngredient: string;
  strength: string;
  form: string;
  manufacturer: string;
  category: string;
  rxLevel: RxLevel | null;
  /** The pack's unit name (`box`). */
  packLabel: string;
  unitsPerPack: number | null;
  barcode: string;
  salePrice: PhMoney | null;
  minQty: number | null;
  shelfLocation: string;
};

export type ParsedRow = {
  rowNumber: number;
  /** `duplicate`: the product is already in the catalog (never updated by an import). */
  status: 'ok' | 'warning' | 'error' | 'duplicate';
  issues: ImportIssue[];
  values: ParsedProduct;
  /** The catalog's identity key for this row, when its name and pack are readable. */
  identityKey: string | null;
};

// Folding -------------------------------------------------------------------------------------------------------------

const LETTERS: Record<string, string> = {
  أ: 'ا', إ: 'ا', آ: 'ا', ٱ: 'ا',
  ى: 'ي', ی: 'ي', ێ: 'ي', ئ: 'ي',
  ک: 'ك',
  ة: 'ه', ە: 'ه', ھ: 'ه',
  ۆ: 'و', ؤ: 'و',
  ڵ: 'ل', ڕ: 'ر', ڤ: 'ف',
};
const MARKS = /[ـً-ٰٟۖ-ۭ]/g; // tatweel, harakat, superscript alef, Quranic marks
const HEADER_MAX = 120;

/** A header or a cell word in one form: case, digit script, tatweel, diacritics, Arabic and Kurdish letter variants and punctuation ignored. */
function fold(raw: string): string {
  return normalizeScan(raw.slice(0, HEADER_MAX).replace(/^﻿/, '').normalize('NFKC'))
    .toLowerCase()
    .replace(MARKS, '')
    .replace(/[أإآٱىیێئکةەھۆؤڵڕڤ]/g, (c) => LETTERS[c] ?? c)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const compact = (folded: string) => folded.replace(/ /g, '');

// Headers -------------------------------------------------------------------------------------------------------------

/**
 * What each column is called, in English, Arabic and Sorani. The Arabic and Sorani lists are a first drafting: a native
 * speaker must review them. A word that two columns could both claim is left out; a header not found maps to null.
 */
const SYNONYMS: Record<ProductColumn, string[]> = {
  tradeName: [
    'trade name', 'brand name', 'brand', 'product name', 'product', 'name', 'item name', 'item', 'medicine', 'medicine name', 'drug name', 'drug',
    'الاسم التجاري', 'اسم تجاري', 'اسم الدواء', 'الدواء', 'اسم المنتج', 'المنتج', 'الاسم', 'اسم الصنف', 'الصنف',
    'ناوی بازرگانی', 'ناوی دەرمان', 'دەرمان', 'ناوی بەرهەم', 'بەرهەم', 'ناو', 'ناوی کاڵا', 'کاڵا',
  ],
  genericName: [
    'generic name', 'generic', 'scientific name',
    'الاسم العلمي', 'الاسم الجنسي', 'الاسم العام', 'الاسم الدوائي',
    'ناوی زانستی', 'ناوی گشتی',
  ],
  activeIngredient: [
    'active ingredient', 'active ingredients', 'ingredient', 'active substance',
    'المادة الفعالة', 'المادة الفاعلة', 'مادة فعالة',
    'ماددەی کارا', 'ماددەی چالاک', 'پێکهاتە',
  ],
  strength: ['strength', 'dose', 'dosage', 'concentration', 'potency', 'التركيز', 'تركيز', 'الجرعة', 'القوة', 'دۆز', 'خەستی', 'هێز'],
  form: [
    'form', 'dosage form', 'drug form',
    'الشكل الدوائي', 'الشكل', 'الشكل الصيدلاني', 'شكل الدواء',
    'شێواز', 'شێوە', 'شێوەی دەرمان', 'فۆرم',
  ],
  manufacturer: [
    'manufacturer', 'maker', 'company', 'producer', 'mfr',
    'الشركة المصنعة', 'الشركة', 'المصنع',
    'کۆمپانیا', 'کۆمپانیای بەرهەمهێنەر', 'بەرهەمهێنەر', 'کارگە',
  ],
  category: [
    'category', 'group', 'class', 'department',
    'التصنيف', 'الفئة', 'القسم', 'المجموعة',
    'پۆل', 'پۆلێن', 'بەش', 'گرووپ', 'کەتەگۆری',
  ],
  rxLevel: [
    'rx level', 'rx', 'prescription', 'prescription status', 'otc', 'dispensing', 'legal status',
    'بوصفة', 'الوصفة', 'وصفة طبية', 'نوع الصرف', 'مستوى الوصفة',
    'ڕەچەتە', 'ئاستی ڕەچەتە',
  ],
  packLabel: [
    'pack', 'pack type', 'pack label', 'pack unit', 'package', 'packaging', 'unit',
    'العبوة', 'نوع العبوة', 'الوحدة', 'وحدة العبوة',
    'پاکەت', 'پاکێج', 'جۆری پاکەت',
  ],
  unitsPerPack: [
    'units per pack', 'pack size', 'qty per pack', 'quantity per pack', 'pieces per pack', 'units pack',
    'حجم العبوة', 'عدد القطع', 'عدد الوحدات في العبوة', 'عدد في العبوة', 'القطع في العبوة',
    'ژمارەی دانە لە پاکەت', 'ژمارەی دانە', 'دانە لە پاکەت',
  ],
  barcode: [
    'barcode', 'bar code', 'ean', 'ean13', 'upc', 'gtin',
    'الباركود', 'باركود', 'الرمز الشريطي',
    'بارکۆد',
  ],
  salePrice: [
    'sale price', 'selling price', 'price', 'retail price', 'unit price',
    'سعر البيع', 'السعر', 'سعر المفرد', 'سعر',
    'نرخی فرۆشتن', 'نرخ', 'نرخی فرۆش',
  ],
  currency: ['currency', 'curr', 'العملة', 'عملة', 'دراو', 'جۆری دراو'],
  minQty: [
    'min qty', 'minimum quantity', 'min stock', 'reorder level', 'reorder point', 'minimum',
    'الحد الأدنى', 'الحد الادنى للمخزون', 'حد الطلب', 'حد إعادة الطلب',
    'کەمترین بڕ', 'کەمترین', 'سنووری داواکردن',
  ],
  shelfLocation: [
    'shelf', 'shelf location', 'location', 'rack', 'bin',
    'الرف', 'موقع الرف', 'مكان الرف', 'الموقع', 'رف',
    'ڕەف', 'شوێنی ڕەف', 'شوێن',
  ],
};

/** Folded word -> column; a word two columns claim maps to `null` (never guessed). */
function dictionary(keyOf: (folded: string) => string): Map<string, ProductColumn | null> {
  const map = new Map<string, ProductColumn | null>();
  for (const column of PRODUCT_COLUMNS) {
    for (const word of [...SYNONYMS[column], column]) {
      const key = keyOf(fold(word));
      const known = map.get(key);
      map.set(key, known === undefined || known === column ? column : null);
    }
  }
  return map;
}
const EXACT = dictionary((folded) => folded);
const COMPACT = dictionary(compact);

/** The column a header names, or null when it is not a confident match. */
function columnOf(header: string): ProductColumn | null {
  const folded = fold(header);
  if (folded === '') return null;
  return EXACT.get(folded) ?? COMPACT.get(compact(folded)) ?? null;
}

/**
 * Each header (as written) to the product column it names, or null. A header with no confident match is null, and a
 * column named by two headers goes to the first; the person can change any of it before importing.
 */
export function suggestMapping(headers: string[]): Record<string, string | null> {
  const mapping: Record<string, string | null> = {};
  const taken = new Set<string>();
  for (const header of headers) {
    if (header in mapping) continue;
    const column = columnOf(header);
    if (column && !taken.has(column)) {
      taken.add(column);
      mapping[header] = column;
    } else mapping[header] = null;
  }
  return mapping;
}

// Cells ---------------------------------------------------------------------------------------------------------------

const TEXT_MAX = 200;
const BARCODE_MAX = 48;
const PACK_LABEL_MAX = 40;
const COUNT_MAX = 1_000_000;

const RX_WORDS: Record<RxLevel, string[]> = {
  OTC: ['otc', 'over the counter', 'no prescription', 'بدون وصفة', 'بلا وصفة', 'بدون وصفه', 'بێ ڕەچەتە', 'بەبێ ڕەچەتە'],
  RX: ['rx', 'prescription', 'prescription only', 'pom', 'بوصفة', 'بوصفة طبية', 'وصفة طبية', 'يحتاج وصفة', 'بە ڕەچەتە', 'ڕەچەتە'],
  RESTRICTED: ['restricted', 'controlled', 'controlled substance', 'خاضع للرقابة', 'مراقب', 'مقيد', 'کۆنترۆڵکراو', 'سنووردار'],
};
const RX_LOOKUP = new Map<string, RxLevel>();
for (const level of ['OTC', 'RX', 'RESTRICTED'] as const) for (const word of RX_WORDS[level]) RX_LOOKUP.set(fold(word), level);

const CURRENCY_WORDS: Record<Currency, string[]> = {
  IQD: ['iqd', 'id', 'iraqi dinar', 'dinar', 'د ع', 'دينار', 'دينار عراقي', 'دینار', 'دیناری عێراقی'],
  USD: ['usd', 'us', 'dollar', 'us dollar', 'دولار', 'دولار امريكي', 'دۆلار', 'دۆلاری ئەمریکی'],
};
const CURRENCY_LOOKUP = new Map<string, Currency>();
for (const currency of ['IQD', 'USD'] as const) for (const word of CURRENCY_WORDS[currency]) CURRENCY_LOOKUP.set(fold(word), currency);

function currencyOf(raw: string): Currency | null {
  const text = raw.trim();
  if (text === '$') return 'USD';
  return CURRENCY_LOOKUP.get(fold(text)) ?? null;
}

/** Whole numbers only: digits in Latin or Arabic-Indic, no separators or signs. */
function wholeNumber(raw: string, min: number): number | null {
  const text = normalizeScan(raw.slice(0, 20));
  if (!/^\d{1,8}$/.test(text)) return null;
  const n = Number(text);
  return n >= min && n <= COUNT_MAX ? n : null;
}

// Rows ----------------------------------------------------------------------------------------------------------------

export type ValidateInput = {
  /** The sheet's header row: `mapping` is keyed by it. */
  headers: string[];
  rows: string[][];
  /** Each row's number in the file (what the person sees in the spreadsheet). */
  rowNumbers: number[];
  /** Per row and cell: whether the cell held a number (`ReadSheet.numericCells`). Omitted means no cell did. */
  numericCells?: boolean[][];
  /** Header -> product column or null (a header left out of the import), as `suggestMapping` returns and the person edits. */
  mapping: Record<string, string | null>;
  /** `identityKeyOf` of every product already in the catalog, archived ones too. */
  existingIdentityKeys: ReadonlySet<string>;
  /** Barcode -> id of the product holding it. */
  existingBarcodes: ReadonlyMap<string, string>;
  enabledCurrencies: readonly Currency[];
};

export type ValidateResult = {
  rows: ParsedRow[];
  summary: { ok: number; warnings: number; errors: number; duplicates: number };
};

/** The cell index of each product column: the first header mapped to it. */
function columnIndexes(headers: string[], mapping: Record<string, string | null>): Map<ProductColumn, number> {
  const indexes = new Map<ProductColumn, number>();
  headers.forEach((header, index) => {
    const column = mapping[header];
    if (column && (PRODUCT_COLUMNS as readonly string[]).includes(column) && !indexes.has(column as ProductColumn)) {
      indexes.set(column as ProductColumn, index);
    }
  });
  return indexes;
}

const emptyValues = (): ParsedProduct => ({
  tradeName: '', genericName: '', activeIngredient: '', strength: '', form: '', manufacturer: '', category: '',
  rxLevel: null, packLabel: '', unitsPerPack: null, barcode: '', salePrice: null, minQty: null, shelfLocation: '',
});

/** Every row of the sheet read and checked; nothing is written. Rows come back in the order given. */
export function validateRows(input: ValidateInput): ValidateResult {
  const indexes = columnIndexes(input.headers, input.mapping);
  const firstRowOfKey = new Map<string, number>();
  const firstRowOfBarcode = new Map<string, number>();
  const result: ValidateResult = { rows: [], summary: { ok: 0, warnings: 0, errors: 0, duplicates: 0 } };

  input.rows.forEach((cells, position) => {
    const rowNumber = input.rowNumbers[position] ?? position + 2;
    const numeric = input.numericCells?.[position];
    const issues: ImportIssue[] = [];
    const add = (code: ImportIssueCode, field: ProductColumn, severity: ImportIssue['severity'], message: string) =>
      issues.push({ code, field, severity, message });
    const cell = (column: ProductColumn) => {
      const index = indexes.get(column);
      return index === undefined ? '' : (cells[index] ?? '').slice(0, 5_000).trim();
    };
    const values = emptyValues();

    const text = (column: 'tradeName' | 'genericName' | 'activeIngredient' | 'strength' | 'form' | 'manufacturer' | 'category' | 'shelfLocation') => {
      const value = cell(column);
      if (value.length > TEXT_MAX) {
        add('TOO_LONG', column, 'error', `${column} is longer than ${TEXT_MAX} characters`);
        return '';
      }
      values[column] = value;
      return value;
    };
    for (const column of ['tradeName', 'genericName', 'activeIngredient', 'strength', 'form', 'manufacturer', 'category', 'shelfLocation'] as const) text(column);
    if (values.tradeName === '' && cell('tradeName') === '') add('MISSING_NAME', 'tradeName', 'error', 'The trade name is empty');

    // Rx level: only a known word; empty or unknown is an error, never OTC by default.
    const rx = cell('rxLevel');
    const level = rx === '' ? undefined : RX_LOOKUP.get(fold(rx));
    if (level) values.rxLevel = level;
    else add('UNKNOWN_RX_LEVEL', 'rxLevel', 'error', rx === '' ? 'The prescription level is empty' : `"${rx.slice(0, 40)}" is not a prescription level this import knows (OTC, Rx or restricted)`);

    // Pack: both the unit name and how many units it holds.
    const label = cell('packLabel');
    const perPack = wholeNumber(cell('unitsPerPack'), 1);
    if (label === '' || label.length > PACK_LABEL_MAX || perPack === null) {
      add('BAD_PACK', 'packLabel', 'error', 'Give the pack as a unit name (such as box) and the number of units in it (a whole number, 1 or more)');
    } else {
      values.packLabel = label;
      values.unitsPerPack = perPack;
    }

    // Barcode.
    const rawCode = cell('barcode');
    const barcodeIndex = indexes.get('barcode');
    if (rawCode !== '') {
      const code = normalizeScan(rawCode);
      const lossy = looksNumericLossy(code, barcodeIndex !== undefined && numeric?.[barcodeIndex] === true);
      if (code.length > BARCODE_MAX) add('TOO_LONG', 'barcode', 'error', `The barcode is longer than ${BARCODE_MAX} characters`);
      else if (lossy && !/^\d{7,11}$/.test(code)) {
        add('LOSSY_BARCODE', 'barcode', 'error', `The barcode "${code}" on row ${rowNumber} was turned into a number by the spreadsheet and its digits are lost; format the column as text and enter it again`);
      } else {
        values.barcode = code;
        if (lossy) add('LOSSY_BARCODE', 'barcode', 'warning', `The barcode "${code}" on row ${rowNumber} came from a number cell, so leading zeros may have been lost; check it`);
        if (checkDigitStatus(code) === 'invalid') add('BARCODE_CHECK_DIGIT', 'barcode', 'warning', `The barcode "${code}" does not pass its check digit; check it for a typing mistake`);
      }
    }

    // Price and currency.
    const rawPrice = cell('salePrice');
    if (rawPrice !== '') {
      const rawCurrency = cell('currency');
      const currency = rawCurrency === '' ? (input.enabledCurrencies.length === 1 ? input.enabledCurrencies[0]! : null) : currencyOf(rawCurrency);
      if (!currency) add('BAD_PRICE', 'currency', 'error', rawCurrency === '' ? 'Say which currency the price is in (IQD or USD)' : `"${rawCurrency.slice(0, 20)}" is not a currency this import knows (IQD or USD)`);
      else {
        try {
          assertEnabledCurrency(currency, input.enabledCurrencies);
          const money = parseMoney(rawPrice.slice(0, 40), currency);
          if (!money || money.amount > BigInt(Number.MAX_SAFE_INTEGER)) {
            add('BAD_PRICE', 'salePrice', 'error', `"${rawPrice.slice(0, 40)}" is not a price in ${currency}: use digits with a point for decimals (and commas only for thousands)`);
          } else values.salePrice = money;
        } catch (error) {
          if (!(error instanceof CurrencyNotEnabledError)) throw error;
          add('CURRENCY_NOT_ENABLED', 'currency', 'error', `${currency} is not enabled for this business`);
        }
      }
    }

    // Minimum quantity.
    const rawMin = cell('minQty');
    if (rawMin !== '') {
      const min = wholeNumber(rawMin, 0);
      if (min === null) add('BAD_MIN_QTY', 'minQty', 'error', 'The minimum quantity must be a whole number, 0 or more');
      else values.minQty = min;
    }

    // Duplicates: the same identity as a catalog product, or as an earlier row.
    let identityKey: string | null = null;
    let duplicateOfCatalog = false;
    if (values.tradeName !== '' && values.packLabel !== '' && values.unitsPerPack !== null) {
      identityKey = identityKeyOf({
        tradeName: values.tradeName,
        strength: values.strength,
        form: values.form,
        manufacturer: values.manufacturer,
        packLabel: packLabelOf([{ level: 1, label: values.packLabel, baseQty: values.unitsPerPack, sellable: true }]),
      });
      const first = firstRowOfKey.get(identityKey);
      if (first !== undefined) add('DUPLICATE_IN_FILE', 'tradeName', 'error', `Same product as row ${first}`);
      else {
        firstRowOfKey.set(identityKey, rowNumber);
        if (input.existingIdentityKeys.has(identityKey)) {
          duplicateOfCatalog = true;
          add('DUPLICATE_PRODUCT', 'tradeName', 'info', 'This product is already in the catalog; it is skipped, never updated');
        }
      }
    }

    // A barcode held by another product (the catalog's, or an earlier row's). A catalog duplicate is skipped whole.
    if (values.barcode !== '' && !duplicateOfCatalog) {
      const holder = input.existingBarcodes.get(values.barcode);
      const earlier = firstRowOfBarcode.get(values.barcode);
      if (holder !== undefined) add('BARCODE_IN_USE', 'barcode', 'error', `The barcode ${values.barcode} already belongs to another product in the catalog`);
      else if (earlier !== undefined) add('BARCODE_IN_USE', 'barcode', 'error', `The barcode ${values.barcode} is already used on row ${earlier}`);
      else firstRowOfBarcode.set(values.barcode, rowNumber);
    }

    const status: ParsedRow['status'] = issues.some((i) => i.severity === 'error')
      ? 'error'
      : duplicateOfCatalog
        ? 'duplicate'
        : issues.some((i) => i.severity === 'warning')
          ? 'warning'
          : 'ok';
    if (status === 'error') result.summary.errors += 1;
    else if (status === 'duplicate') result.summary.duplicates += 1;
    else if (status === 'warning') result.summary.warnings += 1;
    else result.summary.ok += 1;
    result.rows.push({ rowNumber, status, issues, values, identityKey });
  });
  return result;
}

/**
 * A fingerprint of what a batch would do: the checked rows and the mapping they were read with. Stored with a preview
 * and compared when it is applied, as the menu import compares the draft hash, so a changed file or mapping is refused.
 */
export function batchHash(rows: readonly ParsedRow[], mapping: Record<string, string | null>): string {
  const payload = {
    mapping: Object.entries(mapping).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    rows: rows.map((r) => [r.rowNumber, r.status, r.values, r.issues.map((i) => [i.code, i.field])]),
  };
  return createHash('sha256')
    .update(JSON.stringify(payload, (_, value: unknown) => (typeof value === 'bigint' ? `${value}n` : value)))
    .digest('hex');
}
