import { describe, expect, it } from 'vitest';
import {
  diffSheet,
  parseSheetRow,
  readHeaders,
  REQUIRED_COLUMNS,
  SHEET_COLUMNS,
  sheetRowsFromDraft,
  type ImportDraft,
  type SheetColumn,
} from '@/server/domain/import-sheet';

const DRAFT: ImportDraft = {
  currency: 'USD',
  categories: [
    { id: 'c-coffee', slug: 'coffee', names: { en: 'Coffee', ar: 'قهوة' } },
    { id: 'c-cakes', slug: 'cakes', names: { en: 'Cakes' } },
  ],
  products: [
    {
      id: 'p-espresso',
      categoryId: 'c-coffee',
      slug: 'espresso',
      names: { en: 'Espresso', ar: 'إسبريسو', ckb: 'ئێسپرێسۆ' },
      descriptions: { en: 'Short and strong' },
      price: 300,
      isAvailable: true,
      isHidden: false,
      isFeatured: false,
      isSignature: true,
      badges: ['POPULAR'],
      dietary: ['VEGAN'],
      allergens: [],
      calories: 5,
      sortOrder: 0,
    },
    {
      id: 'p-latte',
      categoryId: 'c-coffee',
      slug: 'latte',
      names: { en: 'Latte' },
      descriptions: {},
      price: 450,
      isAvailable: true,
      isHidden: false,
      isFeatured: false,
      isSignature: false,
      badges: [],
      dietary: [],
      allergens: ['milk'],
      calories: null,
      sortOrder: 1,
    },
    {
      id: 'p-cheesecake',
      categoryId: 'c-cakes',
      slug: 'cheesecake',
      names: { en: 'Cheesecake' },
      descriptions: {},
      price: 600,
      isAvailable: true,
      isHidden: false,
      isFeatured: true,
      isSignature: false,
      badges: [],
      dietary: [],
      allergens: ['milk', 'egg', 'gluten'],
      calories: 420,
      sortOrder: 0,
    },
  ],
};

/** The draft's own rows, read back as an import would read them. */
function parsedDraft(draft: ImportDraft = DRAFT) {
  const [headers, ...rows] = sheetRowsFromDraft(draft);
  const read = readHeaders(headers!);
  if (!read.ok) throw new Error('headers');
  return rows.map((cells, index) => {
    const rowNumber = index + 2;
    const parsed = parseSheetRow(cells, read.columns, { currency: draft.currency, rowNumber });
    return parsed.ok ? { rowNumber, row: parsed.row } : { rowNumber, errors: parsed.errors };
  });
}

/** One row from a few columns, the rest absent. */
function row(values: Partial<Record<SheetColumn, string>>, currency = 'USD', rowNumber = 2) {
  const columns = Object.keys(values) as SheetColumn[];
  const read = readHeaders(columns);
  if (!read.ok) throw new Error(`headers: ${JSON.stringify(read)}`);
  return parseSheetRow(
    columns.map((column) => values[column]!),
    read.columns,
    { currency, rowNumber },
  );
}

const ok = (result: ReturnType<typeof row>) => {
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.row;
};

describe('the sheet format', () => {
  it('has the spec’s twenty columns in order, three of them required', () => {
    expect(SHEET_COLUMNS).toEqual([
      'category_slug', 'category_en', 'category_ar', 'category_ckb', 'product_slug', 'name_en', 'name_ar', 'name_ckb',
      'description_en', 'description_ar', 'description_ckb', 'price', 'available', 'featured', 'signature', 'badges',
      'dietary', 'allergens', 'calories', 'sort',
    ]);
    expect(REQUIRED_COLUMNS).toEqual(['category_slug', 'name_en', 'price']);
  });

  it('accepts headers in any case and with spaces, and names unknown and missing ones', () => {
    const read = readHeaders(['﻿ Category Slug ', 'NAME-EN', 'Price', 'Description AR']);
    expect(read.ok).toBe(true);
    if (read.ok) expect([...read.columns.entries()]).toEqual([['category_slug', 0], ['name_en', 1], ['price', 2], ['description_ar', 3]]);
    expect(readHeaders(['category_slug', 'name_en', 'colour', 'name_en'])).toEqual({ ok: false, unknown: ['colour'], missing: ['price'], duplicate: ['name_en'] });
  });
});

describe('reading a row', () => {
  it.each([
    ['6,000', 'IQD', 6000],
    ['٦٠٠٠', 'IQD', 6000],
    ['4,50', 'USD', 450],
    ['4.5', 'USD', 450],
  ])('reads the price %s %s', (price, currency, minor) => {
    expect(ok(row({ category_slug: 'coffee', name_en: 'Espresso', price }, currency)).price).toBe(minor);
  });

  it('removes the export escape from a name that starts with =', () => {
    expect(ok(row({ category_slug: 'coffee', name_en: "'=SUM(A1)", price: '1' })).name_en).toBe('=SUM(A1)');
    expect(ok(row({ category_slug: 'coffee', name_en: "'Tis the season", price: '1' })).name_en).toBe("'Tis the season");
  });

  it('reads yes and no in any case, lists split on |, and tags in any case', () => {
    const read = ok(row({ category_slug: 'coffee', name_en: 'Mocha', price: '5', available: 'YES', featured: '0', signature: 'True', badges: ' new | Popular ', dietary: 'gluten free|vegan', allergens: 'Milk | nuts' }));
    expect(read).toMatchObject({ available: true, featured: false, signature: true, badges: ['NEW', 'POPULAR'], dietary: ['GLUTEN_FREE', 'VEGAN'], allergens: ['milk', 'nuts'] });
  });

  it('refuses an unknown badge with its value and row', () => {
    const read = row({ category_slug: 'coffee', name_en: 'Mocha', price: '5', badges: 'NEW|SPARKLY' }, 'USD', 7);
    expect(read).toEqual({ ok: false, errors: [{ column: 'badges', reason: 'UNKNOWN_VALUE', value: 'SPARKLY' }] });
  });

  it('names every bad cell of a row', () => {
    const read = row({ category_slug: 'Hot Drinks', name_en: '', price: '4.555', available: 'maybe', calories: '30000', sort: '1.5' });
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.errors.map((error) => [error.column, error.reason])).toEqual([
        ['category_slug', 'INVALID_SLUG'],
        ['name_en', 'REQUIRED'],
        ['price', 'TOO_PRECISE'],
        ['available', 'NOT_YES_NO'],
        ['calories', 'OUT_OF_RANGE'],
        ['sort', 'NOT_AN_INTEGER'],
      ]);
    }
  });

  it('holds only the columns the sheet has', () => {
    expect(Object.keys(ok(row({ category_slug: 'coffee', name_en: 'Espresso', price: '3' })))).toEqual(['category_slug', 'name_en', 'price']);
  });
});

describe('the preview', () => {
  it('finds nothing to change in the draft’s own export', () => {
    const preview = diffSheet(parsedDraft(), DRAFT, { hideMissing: true });
    expect(preview.summary).toEqual({ new: 0, changed: 0, unchanged: 3, invalid: 0, hidden: 0 });
    expect(preview.missing).toEqual([]);
  });

  it('matches by product_slug, then by English name within the category', () => {
    const rows = [
      { rowNumber: 2, row: ok(row({ category_slug: 'cakes', product_slug: 'espresso', name_en: 'Espresso', price: '3.00' })) },
      { rowNumber: 3, row: ok(row({ category_slug: 'coffee', name_en: '  LATTE ', price: '4.50' })) },
      { rowNumber: 4, row: ok(row({ category_slug: 'cakes', name_en: 'Latte', price: '4.50' })) },
    ];
    const preview = diffSheet(rows, DRAFT, { hideMissing: false });
    expect(preview.rows.map((entry) => [entry.rowNumber, entry.status, entry.productId])).toEqual([
      [2, 'changed', 'p-espresso'],
      [3, 'unchanged', 'p-latte'],
      [4, 'new', null],
    ]);
    expect(preview.rows[0]!.changes).toEqual([{ field: 'category', before: 'coffee', after: 'cakes', live: false }]);
  });

  it('classifies new, changed (field by field), unchanged and invalid rows', () => {
    const rows = [
      { rowNumber: 2, row: ok(row({ category_slug: 'coffee', product_slug: 'espresso', name_en: 'Espresso', name_ar: 'اسبريسو', price: '3.50', available: 'no' })) },
      { rowNumber: 3, row: ok(row({ category_slug: 'coffee', product_slug: 'latte', name_en: 'Latte', price: '4.50' })) },
      { rowNumber: 4, row: ok(row({ category_slug: 'tea', category_en: 'Tea', category_ar: 'شاي', product_slug: 'mint-tea', name_en: 'Mint tea', price: '2' })) },
      { rowNumber: 5, errors: [{ column: 'price' as const, reason: 'NOT_A_NUMBER' as const }] },
    ];
    const preview = diffSheet(rows, DRAFT, { hideMissing: false });
    expect(preview.rows.map((entry) => entry.status)).toEqual(['changed', 'unchanged', 'new', 'invalid']);
    expect(preview.rows[0]!.changes).toEqual([
      { field: 'name_ar', before: 'إسبريسو', after: 'اسبريسو', live: false },
      { field: 'price', before: 300, after: 350, live: false },
      { field: 'available', before: true, after: false, live: true },
    ]);
    expect(preview.newCategories).toEqual([{ slug: 'tea', names: { en: 'Tea', ar: 'شاي' } }]);
    expect(preview.rows[3]!.errors).toEqual([{ column: 'price', reason: 'NOT_A_NUMBER' }]);
    expect(preview.summary).toEqual({ new: 1, changed: 1, unchanged: 1, invalid: 1, hidden: 0 });
  });

  it('leaves a column the sheet lacks unchanged', () => {
    const rows = [{ rowNumber: 2, row: ok(row({ category_slug: 'coffee', product_slug: 'espresso', name_en: 'Espresso', price: '3' })) }];
    expect(diffSheet(rows, DRAFT, { hideMissing: false }).rows[0]!.status).toBe('unchanged');
  });

  it('refuses a second row for one product, a new slug twice, and a new category without a name', () => {
    const rows = [
      { rowNumber: 2, row: ok(row({ category_slug: 'coffee', product_slug: 'espresso', name_en: 'Espresso', price: '3' })) },
      { rowNumber: 3, row: ok(row({ category_slug: 'coffee', name_en: 'espresso', price: '3' })) },
      { rowNumber: 4, row: ok(row({ category_slug: 'coffee', product_slug: 'flat-white', name_en: 'Flat white', price: '4' })) },
      { rowNumber: 5, row: ok(row({ category_slug: 'coffee', product_slug: 'flat-white', name_en: 'Flat white 2', price: '4' })) },
      { rowNumber: 6, row: ok(row({ category_slug: 'juices', name_en: 'Orange', price: '4' })) },
    ];
    const preview = diffSheet(rows, DRAFT, { hideMissing: false });
    expect(preview.rows.map((entry) => [entry.status, entry.errors?.[0]?.reason])).toEqual([
      ['unchanged', undefined],
      ['invalid', 'DUPLICATE_PRODUCT'],
      ['new', undefined],
      ['invalid', 'DUPLICATE_SLUG'],
      ['invalid', 'CATEGORY_NAME'],
    ]);
  });

  it('lists products missing from the sheet and hides them only when asked', () => {
    const rows = [{ rowNumber: 2, row: ok(row({ category_slug: 'coffee', product_slug: 'espresso', name_en: 'Espresso', price: '3' })) }];
    const kept = diffSheet(rows, DRAFT, { hideMissing: false });
    expect(kept.missing.map((product) => product.slug)).toEqual(['latte', 'cheesecake']);
    expect(kept.summary.hidden).toBe(0);
    expect(diffSheet(rows, DRAFT, { hideMissing: true }).summary.hidden).toBe(2);
  });
});

describe('the export', () => {
  it('writes a header row, then each product in category and product order, escaping formula-like text', () => {
    const draft: ImportDraft = { ...DRAFT, products: DRAFT.products.map((product) => (product.id === 'p-latte' ? { ...product, names: { en: '=Latte' } } : product)) };
    const [headers, first, second] = sheetRowsFromDraft(draft);
    expect(headers).toEqual([...SHEET_COLUMNS]);
    expect(first).toEqual([
      'coffee', 'Coffee', 'قهوة', '', 'espresso', 'Espresso', 'إسبريسو', 'ئێسپرێسۆ', 'Short and strong', '', '', '3.00', 'true', 'false',
      'true', 'POPULAR', 'VEGAN', '', '5', '0',
    ]);
    expect(second![5]).toBe("'=Latte");
  });
});
