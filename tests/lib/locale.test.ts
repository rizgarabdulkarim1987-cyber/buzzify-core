import { describe, expect, it } from 'vitest';
import { direction, isLocale, LOCALES, LOCALE_NAMES } from '@/lib/locale';

describe('locale', () => {
  it('lists the three supported locales', () => {
    expect([...LOCALES]).toEqual(['en', 'ar', 'ckb']);
  });

  it('accepts only supported locales', () => {
    expect(isLocale('en')).toBe(true);
    expect(isLocale('ckb')).toBe(true);
    expect(isLocale('xx')).toBe(false);
    expect(isLocale('')).toBe(false);
    expect(isLocale('EN')).toBe(false);
  });

  it('is right-to-left for Arabic and Sorani only', () => {
    expect(direction('en')).toBe('ltr');
    expect(direction('ar')).toBe('rtl');
    expect(direction('ckb')).toBe('rtl');
  });

  it('has a display name for every locale', () => {
    for (const locale of LOCALES) expect(LOCALE_NAMES[locale].length).toBeGreaterThan(0);
  });
});
