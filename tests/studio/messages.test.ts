import { describe, expect, it } from 'vitest';
import { STUDIO_MESSAGES, getStudioTranslator } from '@/studio/messages';

const PLURAL = /_(zero|one|two|few|many|other)$/;
const base = (key: string) => key.replace(PLURAL, '');
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('studio messages', () => {
  const englishKeys = Object.keys(STUDIO_MESSAGES.en);

  it('has every English key in Arabic and Sorani', () => {
    for (const locale of ['ar', 'ckb'] as const) {
      const missing = englishKeys.filter((key) => !(key in STUDIO_MESSAGES[locale]) && !PLURAL.test(key));
      expect(missing, `${locale} is missing keys`).toEqual([]);
    }
  });

  it('provides an "other" plural form wherever English has plural forms', () => {
    const pluralBases = new Set(englishKeys.filter((key) => PLURAL.test(key)).map(base));
    for (const locale of ['en', 'ar', 'ckb'] as const) {
      for (const key of pluralBases) expect(STUDIO_MESSAGES[locale][`${key}_other`], `${locale} ${key}`).toBeTruthy();
    }
  });

  it('uses the same placeholders as English for non-plural messages', () => {
    for (const key of englishKeys.filter((k) => !PLURAL.test(k))) {
      for (const locale of ['ar', 'ckb'] as const) {
        expect(placeholders(STUDIO_MESSAGES[locale][key] as string), `${locale} ${key}`).toEqual(
          placeholders(STUDIO_MESSAGES.en[key] as string),
        );
      }
    }
  });

  it('has no empty strings', () => {
    for (const locale of ['en', 'ar', 'ckb'] as const) {
      for (const [key, value] of Object.entries(STUDIO_MESSAGES[locale])) {
        expect(value.trim(), `${locale} ${key}`).not.toBe('');
      }
    }
  });

  it('translates with interpolation in every language', () => {
    expect(getStudioTranslator('en')('email.greeting', { name: 'Lina' })).toBe('Hello Lina,');
    expect(getStudioTranslator('ar')('email.greeting', { name: 'Lina' })).toContain('Lina');
    expect(getStudioTranslator('ckb')('email.greeting', { name: 'Lina' })).toContain('Lina');
  });
});
