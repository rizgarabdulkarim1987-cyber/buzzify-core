import { describe, expect, it } from 'vitest';
import { MESSAGES, getTranslator } from '@/lib/messages';

const PLURAL = /_(zero|one|two|few|many|other)$/;
const base = (key: string) => key.replace(PLURAL, '');
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('messages', () => {
  const englishKeys = Object.keys(MESSAGES.en);

  it('has every English key in Arabic and Sorani', () => {
    for (const locale of ['ar', 'ckb'] as const) {
      const missing = englishKeys.filter((key) => !(key in MESSAGES[locale]) && !PLURAL.test(key));
      expect(missing, `${locale} is missing keys`).toEqual([]);
    }
  });

  it('provides an "other" plural form wherever English has plural forms', () => {
    const pluralBases = new Set(englishKeys.filter((key) => PLURAL.test(key)).map(base));
    for (const locale of ['en', 'ar', 'ckb'] as const) {
      for (const key of pluralBases) expect(MESSAGES[locale][`${key}_other`], `${locale} ${key}`).toBeTruthy();
    }
  });

  it('uses the same placeholders as English for non-plural messages', () => {
    for (const key of englishKeys.filter((k) => !PLURAL.test(k))) {
      for (const locale of ['ar', 'ckb'] as const) {
        expect(placeholders(MESSAGES[locale][key] as string), `${locale} ${key}`).toEqual(
          placeholders(MESSAGES.en[key] as string),
        );
      }
    }
  });

  it('has no empty strings', () => {
    for (const locale of ['en', 'ar', 'ckb'] as const) {
      for (const [key, value] of Object.entries(MESSAGES[locale])) {
        expect(value.trim(), `${locale} ${key}`).not.toBe('');
      }
    }
  });

  it('writes the Book and Magazine counts in the tenant numerals ({n}), never the raw {count}', () => {
    for (const locale of ['en', 'ar', 'ckb'] as const) {
      for (const [key, value] of Object.entries(MESSAGES[locale]).filter(([k]) => /^tpl\.(book\.dishes|mag\.sections)_/.test(k))) {
        expect(placeholders(value as string), `${locale} ${key}`).not.toContain('count');
      }
    }
    expect(getTranslator('ar')('tpl.book.dishes', { count: 5, n: '٥' })).toBe('٥ أطباق');
    expect(getTranslator('en')('tpl.mag.sections', { count: 12, n: '١٢' })).toBe('١٢ sections');
  });

  it('translates with interpolation and plurals', () => {
    expect(getTranslator('en')('menu.table', { number: '04' })).toBe('Table 04');
    expect(getTranslator('en')('cart.items', { count: 1 })).toBe('1 item');
    expect(getTranslator('en')('cart.items', { count: 3 })).toBe('3 items');
    expect(getTranslator('ar')('cart.items', { count: 2 })).toBe('عنصران');
  });
});
