import { describe, expect, it } from 'vitest';
import { categoryLocale, parsePosCsv, parsePosPrice, toStudioSheet } from '@/server/pos/menu-csv';

describe('parsePosPrice', () => {
  it('reads Latin, Arabic-Indic and Persian digits with thousands separators', () => {
    expect(parsePosPrice('12500')).toBe(12500);
    expect(parsePosPrice('١٢٬٥٠٠')).toBe(12500);
    expect(parsePosPrice('۱۲,۵۰۰')).toBe(12500);
    expect(parsePosPrice('12 500')).toBe(12500);
    expect(parsePosPrice('0')).toBe(0);
  });

  it('refuses decimals, negatives, blanks, words and amounts beyond 32 bits', () => {
    for (const bad of ['12.5', '12٫5', '-5', '', 'abc', '1e3', '2147483648', '99999999999', '12,5', '12٬5', '1,2345', ',500', '12,,500', '12,50', '500,'])
      expect(parsePosPrice(bad), bad).toBeNull();
  });
});

describe('parsePosCsv', () => {
  it('reads a semicolon file with a BOM and CRLF, Arabic names and an Arabic-Indic price', () => {
    const parsed = parsePosCsv('﻿category;name_ar;price\r\nمشروبات;شاي;١٢٬٥٠٠\r\nمشروبات;قهوة;2000\r\n');
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toEqual([
      { category: 'مشروبات', names: { ar: 'شاي' }, price: 12500 },
      { category: 'مشروبات', names: { ar: 'قهوة' }, price: 2000 },
    ]);
  });

  it('reads any column order, case-insensitive headers, ignores unknown columns and blank lines', () => {
    const parsed = parsePosCsv('Price,Notes,NAME_EN,Category\n1000,x,Tea,Drinks\n\n,,,\n2000,y,Cola,Drinks\n');
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows.map((row) => [row.category, row.names, row.price])).toEqual([
      ['Drinks', { en: 'Tea' }, 1000],
      ['Drinks', { en: 'Cola' }, 2000],
    ]);
  });

  it('keeps commas, doubled quotes and newlines inside quotes, and counts physical lines', () => {
    const parsed = parsePosCsv('category,name_en,price\n"Food, hot","Chef ""special""\nplate","1,500"\nFood,Bad,12.5\n');
    expect(parsed.rows).toEqual([{ category: 'Food, hot', names: { en: 'Chef "special"\nplate' }, price: 1500 }]);
    expect(parsed.errors).toEqual([{ line: 4, code: 'badPrice' }]);
  });

  it('reports a missing header, an empty file and a file that is not UTF-8', () => {
    expect(parsePosCsv('name_en,price\nTea,1000').errors).toEqual([{ line: 1, code: 'missingColumns' }]);
    expect(parsePosCsv('').errors).toEqual([{ line: 1, code: 'empty' }]);
    expect(parsePosCsv('category,name_en,price\n�,Tea,1').errors).toEqual([{ line: 1, code: 'badEncoding' }]);
  });

  it('reports a missing category, a missing name, an over-long name and an unclosed quote, each with its line', () => {
    const parsed = parsePosCsv(`category,name_en,price\n,Tea,1\nA,,1\nA,${'x'.repeat(121)},1\nA,"open,1`);
    expect(parsed.rows).toEqual([]);
    expect(parsed.errors).toEqual([
      { line: 2, code: 'noCategory' },
      { line: 3, code: 'noName' },
      { line: 4, code: 'tooLong' },
      { line: 5, code: 'unclosedQuote' },
    ]);
  });

  it('accepts 2,000 rows and refuses the 2,001st with one error', () => {
    const body = (count: number) => Array.from({ length: count }, (_, i) => `Food,Item ${i},${1000 + i}`).join('\n');
    expect(parsePosCsv(`category,name_en,price\n${body(2000)}`)).toMatchObject({ errors: [] });
    const over = parsePosCsv(`category,name_en,price\n${body(2001)}`);
    expect(over.rows).toHaveLength(2000);
    expect(over.errors).toEqual([{ line: 2002, code: 'tooManyRows' }]);
  });

  it('keeps a formula-looking cell as plain text', () => {
    expect(parsePosCsv('category,name_en,price\nA,=SUM(A1),5').rows[0]!.names.en).toBe('=SUM(A1)');
  });
});

describe('toStudioSheet', () => {
  const header = 'category_slug,category_en,category_ar,category_ckb,product_slug,name_en,name_ar,name_ckb,description_en,description_ar,description_ckb,price';

  it('detects a category’s language from its script', () => {
    expect(categoryLocale('مشروبات')).toBe('ar');
    expect(categoryLocale('خواردنەوە')).toBe('ckb');
    expect(categoryLocale('Drinks')).toBe('en');
  });

  it('gives each distinct category one slug, however many rows name it', () => {
    const sheet = toStudioSheet(
      [
        { category: 'Drinks', names: { en: 'Tea' }, price: 1000 },
        { category: 'drinks ', names: { en: 'Coffee' }, price: 2000 },
        { category: 'Food', names: { en: 'Kebab' }, price: 9000 },
      ],
      [],
    );
    const lines = sheet.split('\r\n');
    expect(lines[0]!.startsWith(header)).toBe(true);
    expect(lines.slice(1).map((line) => line.split(',')[0])).toEqual(['drinks', 'drinks', 'food']);
  });

  it('reuses the slug of a category the menu already has, under any of its names', () => {
    const sheet = toStudioSheet([{ category: 'مشروبات', names: { ar: 'شاي' }, price: 1000 }], [{ slug: 'drinks', names: { en: 'Drinks', ar: 'مشروبات' } }]);
    expect(sheet.split('\r\n')[1]!.startsWith('drinks,')).toBe(true);
  });

  it('does not collide an Arabic-only category with a slug the menu has', () => {
    const sheet = toStudioSheet([{ category: 'مشروبات', names: { ar: 'شاي' }, price: 1000 }], [{ slug: 'category', names: { en: 'Other' } }]);
    expect(sheet.split('\r\n')[1]!.startsWith('category-2,')).toBe(true);
  });

  it('writes an Arabic-only product’s name in the English column too, so a second import matches it', () => {
    const line = toStudioSheet([{ category: 'مشروبات', names: { ar: 'شاي' }, price: 1500 }], []).split('\r\n')[1]!;
    expect(line).toContain(',شاي,شاي,');
    expect(line.split(',')[11]).toBe('1500');
  });
});
