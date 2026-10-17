import { LOCALES, type Locale } from '@/lib/locale';
import { formatPriceInput, parsePriceInput } from '@/lib/money-input';
import { ALLERGENS, BADGES, DIETARY_TAGS, type Allergen, type Badge, type DietaryTag } from '@/lib/product-tags';
import { SLUG_MAX } from './slug';

/**
 * The menu spreadsheet (spec 13): its columns, how a row is read, how a sheet compares with the draft, and how the draft
 * is written as rows. Pure, so the same rules read an upload and write an export, and a sheet exported and imported
 * back changes nothing.
 */

export const SHEET_COLUMNS = [
  'category_slug',
  'category_en',
  'category_ar',
  'category_ckb',
  'product_slug',
  'name_en',
  'name_ar',
  'name_ckb',
  'description_en',
  'description_ar',
  'description_ckb',
  'price',
  'available',
  'featured',
  'signature',
  'badges',
  'dietary',
  'allergens',
  'calories',
  'sort',
] as const;
export type SheetColumn = (typeof SHEET_COLUMNS)[number];

export const REQUIRED_COLUMNS = ['category_slug', 'name_en', 'price'] as const satisfies readonly SheetColumn[];

/** Why a cell cannot be read; the Studio words each one (`import.reason.<code>`). */
export type SheetReason =
  | 'REQUIRED'
  | 'INVALID_SLUG'
  | 'TOO_LONG'
  | 'NOT_A_NUMBER'
  | 'NEGATIVE'
  | 'TOO_PRECISE'
  | 'TOO_LARGE'
  | 'NOT_YES_NO'
  | 'UNKNOWN_VALUE'
  | 'NOT_AN_INTEGER'
  | 'OUT_OF_RANGE'
  | 'DUPLICATE_PRODUCT'
  | 'DUPLICATE_SLUG'
  | 'CATEGORY_NAME';

export interface SheetError {
  column: SheetColumn;
  reason: SheetReason;
  /** The value that is not allowed, for a list entry such as an unknown badge. */
  value?: string;
}

/** A row as read: only the columns the sheet has. Texts are trimmed; an empty text means none. */
export interface SheetRow {
  category_slug: string;
  category_en?: string;
  category_ar?: string;
  category_ckb?: string;
  product_slug?: string;
  name_en: string;
  name_ar?: string;
  name_ckb?: string;
  description_en?: string;
  description_ar?: string;
  description_ckb?: string;
  /** Minor units of the menu's currency. */
  price: number;
  available?: boolean;
  featured?: boolean;
  signature?: boolean;
  badges?: Badge[];
  dietary?: DietaryTag[];
  allergens?: Allergen[];
  calories?: number | null;
  sort?: number;
}

const NAME_MAX = 120;
const DESCRIPTION_MAX = 1_000;
const CALORIES_MAX = 20_000;
const SORT_LIMIT = 1_000_000;
const SLUG_SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Headers -------------------------------------------------------------------------------------------------------------

/** A header as people write it (`Name EN`, `name-en`, with Excel's byte order mark) as a column name. */
function columnName(header: string): string {
  return header.replace(/^﻿/, '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

const isColumn = (name: string): name is SheetColumn => (SHEET_COLUMNS as readonly string[]).includes(name);

/**
 * The sheet's columns by position, or what is wrong with its header row: names it does not know, required ones it
 * lacks and names it has twice. Empty header cells (trailing columns Excel keeps) are ignored.
 */
export function readHeaders(
  headers: string[],
): { ok: true; columns: Map<SheetColumn, number> } | { ok: false; unknown: string[]; missing: SheetColumn[]; duplicate: string[] } {
  const columns = new Map<SheetColumn, number>();
  const unknown: string[] = [];
  const duplicate: string[] = [];
  headers.forEach((header, index) => {
    const name = columnName(header);
    if (name === '') return;
    if (!isColumn(name)) unknown.push(header.replace(/^﻿/, '').trim());
    else if (columns.has(name)) {
      if (!duplicate.includes(name)) duplicate.push(name);
    } else columns.set(name, index);
  });
  const missing = REQUIRED_COLUMNS.filter((column) => !columns.has(column));
  if (unknown.length > 0 || missing.length > 0 || duplicate.length > 0) return { ok: false, unknown, missing, duplicate };
  return { ok: true, columns };
}

// Rows ----------------------------------------------------------------------------------------------------------------

/** A cell as written, without the quote an export puts before `=`, `+`, `-` or `@` so spreadsheets keep it as text. */
function unescapeCell(cell: string): string {
  return /^'[=+\-@]/.test(cell) ? cell.slice(1) : cell;
}

/** A cell an export writes, with that quote when the text would read as a formula. */
function escapeCell(text: string): string {
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

/** Latin digits for Arabic-Indic and Persian (Sorani) ones. */
function latinDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.codePointAt(0)!;
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

const YES = new Set(['true', 'yes', '1']);
const NO = new Set(['false', 'no', '0']);

/** A list cell (`a | b`) as its entries in canonical form, or the entries that are not allowed. */
function readList<T extends string>(cell: string, allowed: readonly T[], canonical: (entry: string) => string): { values: T[]; unknown: string[] } {
  const values: T[] = [];
  const unknown: string[] = [];
  for (const entry of cell.split('|').map((part) => part.trim()).filter(Boolean)) {
    const key = canonical(entry);
    if ((allowed as readonly string[]).includes(key)) {
      if (!values.includes(key as T)) values.push(key as T);
    } else unknown.push(entry);
  }
  return { values, unknown };
}

const upperKey = (entry: string) => entry.toUpperCase().replace(/[\s-]+/g, '_');
const lowerKey = (entry: string) => entry.toLowerCase().replace(/[\s-]+/g, '_');

/** One data row of the sheet, by its columns. */
export function parseSheetRow(
  cells: string[],
  columns: Map<SheetColumn, number>,
  ctx: { currency: string; rowNumber: number },
): { ok: true; row: SheetRow } | { ok: false; errors: SheetError[] } {
  const row: Record<string, unknown> = {};
  const errors: SheetError[] = [];
  const fail = (column: SheetColumn, reason: SheetReason, value?: string) => errors.push(value === undefined ? { column, reason } : { column, reason, value });

  for (const column of SHEET_COLUMNS) {
    const index = columns.get(column);
    if (index === undefined) continue;
    const cell = unescapeCell((cells[index] ?? '').trim()).trim();

    switch (column) {
      case 'category_slug':
      case 'product_slug': {
        if (cell === '') {
          if (column === 'category_slug') fail(column, 'REQUIRED');
          break;
        }
        if (cell.length > SLUG_MAX) fail(column, 'TOO_LONG');
        else if (!SLUG_SHAPE.test(cell)) fail(column, 'INVALID_SLUG');
        else row[column] = cell;
        break;
      }
      case 'name_en':
      case 'name_ar':
      case 'name_ckb':
      case 'category_en':
      case 'category_ar':
      case 'category_ckb': {
        if (cell === '' && column === 'name_en') fail(column, 'REQUIRED');
        else if (cell.length > NAME_MAX) fail(column, 'TOO_LONG');
        else row[column] = cell;
        break;
      }
      case 'description_en':
      case 'description_ar':
      case 'description_ckb': {
        if (cell.length > DESCRIPTION_MAX) fail(column, 'TOO_LONG');
        else row[column] = cell;
        break;
      }
      case 'price': {
        const price = parsePriceInput(cell, ctx.currency);
        if (price.ok) row.price = price.minor;
        else fail(column, price.reason === 'EMPTY' ? 'REQUIRED' : price.reason);
        break;
      }
      case 'available':
      case 'featured':
      case 'signature': {
        const value = cell.toLowerCase();
        if (value === '') break;
        if (YES.has(value)) row[column] = true;
        else if (NO.has(value)) row[column] = false;
        else fail(column, 'NOT_YES_NO', cell);
        break;
      }
      case 'badges':
      case 'dietary':
      case 'allergens': {
        const list =
          column === 'badges' ? readList(cell, BADGES, upperKey) : column === 'dietary' ? readList(cell, DIETARY_TAGS, upperKey) : readList(cell, ALLERGENS, lowerKey);
        if (list.unknown.length > 0) list.unknown.forEach((value) => fail(column, 'UNKNOWN_VALUE', value));
        else row[column] = list.values;
        break;
      }
      case 'calories':
      case 'sort': {
        const value = latinDigits(cell);
        if (value === '') {
          if (column === 'calories') row.calories = null;
          break;
        }
        if (!/^-?\d+$/.test(value)) {
          fail(column, 'NOT_AN_INTEGER', cell);
          break;
        }
        const number = Number(value);
        const [min, max] = column === 'calories' ? [0, CALORIES_MAX] : [-SORT_LIMIT, SORT_LIMIT];
        if (number < min || number > max) fail(column, 'OUT_OF_RANGE', cell);
        else row[column] = number;
        break;
      }
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, row: row as unknown as SheetRow };
}

// The draft and the preview --------------------------------------------------------------------------------------------

type Names = Partial<Record<Locale, string>>;

/** What an import compares with: the menu's categories and products as the draft holds them, each in its order. */
export interface ImportDraft {
  currency: string;
  categories: Array<{ id: string; slug: string; names: Names }>;
  products: Array<{
    id: string;
    categoryId: string;
    slug: string;
    names: Names;
    descriptions: Names;
    price: number;
    isAvailable: boolean;
    isHidden: boolean;
    isFeatured: boolean;
    isSignature: boolean;
    badges: string[];
    dietary: string[];
    allergens: string[];
    calories: number | null;
    sortOrder: number;
  }>;
}

/** A field an import writes: `category` (by slug), a sheet column's name otherwise. */
export interface ImportChange {
  field: string;
  before: unknown;
  after: unknown;
  /** Guests see it at once, without a publish (`available`). */
  live: boolean;
}

export interface ImportPreviewRow {
  rowNumber: number;
  status: 'new' | 'changed' | 'unchanged' | 'invalid';
  productId: string | null;
  /** The product's slug; for a new product without one, empty (made from its name when applied). */
  productSlug: string;
  name: string;
  /** Each field that changes; for a new product, each field it is given. */
  changes?: ImportChange[];
  errors?: SheetError[];
}

export interface ImportPreview {
  rows: ImportPreviewRow[];
  newCategories: Array<{ slug: string; names: Names }>;
  /** Products of the draft that no row names. */
  missing: Array<{ productId: string; slug: string; name: string }>;
  summary: { new: number; changed: number; unchanged: number; invalid: number; hidden: number };
}

export type ParsedSheetRow = { rowNumber: number; row: SheetRow } | { rowNumber: number; errors: SheetError[] };

const LOCALE_TEXT_COLUMNS = [
  ['name_en', 'names', 'en'],
  ['name_ar', 'names', 'ar'],
  ['name_ckb', 'names', 'ckb'],
  ['description_en', 'descriptions', 'en'],
  ['description_ar', 'descriptions', 'ar'],
  ['description_ckb', 'descriptions', 'ckb'],
] as const;

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const nameKey = (categorySlug: string, name: string) => `${categorySlug}\u0000${name.trim().toLowerCase()}`;

/** The fields a row gives, compared with `product` (null for a new one). */
function rowChanges(row: SheetRow, product: ImportDraft['products'][number] | null, categorySlug: string | null, matchedByName: boolean): ImportChange[] {
  const changes: ImportChange[] = [];
  const add = (field: string, before: unknown, after: unknown, live = false) => {
    if (product === null || !sameValue(before, after)) changes.push({ field, before: product === null ? null : before, after, live: product !== null && live });
  };
  add('category', categorySlug, row.category_slug);
  for (const [column, group, locale] of LOCALE_TEXT_COLUMNS) {
    const value = row[column];
    if (value === undefined) continue;
    // A row found by its English name keeps that name: case and spaces are how it was found, not an edit.
    if (column === 'name_en' && matchedByName && product !== null) continue;
    add(column, product?.[group][locale] ?? '', value);
  }
  add('price', product?.price, row.price);
  if (row.available !== undefined) add('available', product?.isAvailable, row.available, true);
  if (row.featured !== undefined) add('featured', product?.isFeatured, row.featured);
  if (row.signature !== undefined) add('signature', product?.isSignature, row.signature);
  if (row.badges !== undefined) add('badges', product?.badges, row.badges);
  if (row.dietary !== undefined) add('dietary', product?.dietary, row.dietary);
  if (row.allergens !== undefined) add('allergens', product?.allergens, row.allergens);
  if (row.calories !== undefined) add('calories', product?.calories, row.calories);
  if (row.sort !== undefined) add('sort', product?.sortOrder, row.sort);
  return changes;
}

/**
 * How a sheet compares with the draft (spec 13.2). A row finds its product by `product_slug` (a slug the menu lacks
 * makes a new product with it), else by its English name within its category, ignoring case and spaces. Each row is new,
 * changed (field by field), unchanged or invalid; a second row for one product, a new slug twice, and a new category
 * without a name are invalid. Products no row names are listed, and counted as hidden only when `hideMissing`.
 */
export function diffSheet(rows: ParsedSheetRow[], draft: ImportDraft, o: { hideMissing: boolean }): ImportPreview {
  const categoryById = new Map(draft.categories.map((category) => [category.id, category]));
  const categoryBySlug = new Map(draft.categories.map((category) => [category.slug, category]));
  const bySlug = new Map(draft.products.map((product) => [product.slug, product]));
  const byName = new Map<string, ImportDraft['products'][number]>();
  for (const product of draft.products) {
    const category = categoryById.get(product.categoryId);
    if (category && product.names.en) byName.set(nameKey(category.slug, product.names.en), product);
  }

  const seen = new Set<string>();
  const newSlugs = new Set<string>();
  const newCategories = new Map<string, Names>();
  const preview: ImportPreviewRow[] = [];

  for (const entry of rows) {
    if ('errors' in entry) {
      preview.push({ rowNumber: entry.rowNumber, status: 'invalid', productId: null, productSlug: '', name: '', errors: entry.errors });
      continue;
    }
    const { row, rowNumber } = entry;
    const matchedByName = row.product_slug === undefined;
    const product = row.product_slug !== undefined ? (bySlug.get(row.product_slug) ?? null) : (byName.get(nameKey(row.category_slug, row.name_en)) ?? null);
    const base = { rowNumber, productId: product?.id ?? null, productSlug: product?.slug ?? row.product_slug ?? '', name: row.name_en };
    const invalid = (error: SheetError) => preview.push({ ...base, status: 'invalid', errors: [error] });

    if (product && seen.has(product.id)) {
      invalid({ column: matchedByName ? 'name_en' : 'product_slug', reason: 'DUPLICATE_PRODUCT' });
      continue;
    }
    if (!product && row.product_slug !== undefined && newSlugs.has(row.product_slug)) {
      invalid({ column: 'product_slug', reason: 'DUPLICATE_SLUG' });
      continue;
    }
    if (!categoryBySlug.has(row.category_slug) && !newCategories.has(row.category_slug)) {
      const names: Names = {};
      for (const locale of LOCALES) {
        const name = row[`category_${locale}`];
        if (name) names[locale] = name;
      }
      if (Object.keys(names).length === 0) {
        invalid({ column: 'category_en', reason: 'CATEGORY_NAME' });
        continue;
      }
      newCategories.set(row.category_slug, names);
    }

    if (product) {
      seen.add(product.id);
      const changes = rowChanges(row, product, categoryById.get(product.categoryId)?.slug ?? null, matchedByName);
      preview.push(changes.length > 0 ? { ...base, status: 'changed', changes } : { ...base, status: 'unchanged' });
    } else {
      if (row.product_slug !== undefined) newSlugs.add(row.product_slug);
      preview.push({ ...base, status: 'new', changes: rowChanges(row, null, null, false) });
    }
  }

  const missing = draft.products.filter((product) => !seen.has(product.id));
  const count = (status: ImportPreviewRow['status']) => preview.filter((row) => row.status === status).length;
  return {
    rows: preview,
    newCategories: [...newCategories].map(([slug, names]) => ({ slug, names })),
    missing: missing.map((product) => ({ productId: product.id, slug: product.slug, name: product.names.en ?? product.slug })),
    summary: {
      new: count('new'),
      changed: count('changed'),
      unchanged: count('unchanged'),
      invalid: count('invalid'),
      hidden: o.hideMissing ? missing.filter((product) => !product.isHidden).length : 0,
    },
  };
}

// The export ----------------------------------------------------------------------------------------------------------

/** The header row, then a row per product in category and product order: the export, and what an import compares. */
export function sheetRowsFromDraft(draft: ImportDraft): string[][] {
  const rows: string[][] = [[...SHEET_COLUMNS]];
  for (const category of draft.categories) {
    const products = draft.products.filter((product) => product.categoryId === category.id).sort((a, b) => a.sortOrder - b.sortOrder);
    for (const product of products) {
      rows.push(
        [
          category.slug,
          category.names.en ?? '',
          category.names.ar ?? '',
          category.names.ckb ?? '',
          product.slug,
          product.names.en ?? '',
          product.names.ar ?? '',
          product.names.ckb ?? '',
          product.descriptions.en ?? '',
          product.descriptions.ar ?? '',
          product.descriptions.ckb ?? '',
          formatPriceInput(product.price, draft.currency),
          String(product.isAvailable),
          String(product.isFeatured),
          String(product.isSignature),
          product.badges.join('|'),
          product.dietary.join('|'),
          product.allergens.join('|'),
          product.calories === null ? '' : String(product.calories),
          String(product.sortOrder),
        ].map(escapeCell),
      );
    }
  }
  return rows;
}
