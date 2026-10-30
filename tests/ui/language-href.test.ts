import { describe, expect, it } from 'vitest';
import { introTable, languageHref } from '@/ui/intro/language-href';

describe('the intro’s language links', () => {
  it('lead to the menu in the language, keeping the query', () => {
    expect(languageHref('zhamitos', 'ar', null, '')).toBe('/zhamitos/ar');
    expect(languageHref('zhamitos', 'en', null, '?qr=abc')).toBe('/zhamitos/en?qr=abc');
  });

  it('lead on to the table the scan came from', () => {
    expect(languageHref('zhamitos', 'ckb', '4', '')).toBe('/zhamitos/ckb/t/4');
    expect(languageHref('zhamitos', 'en', '04', '?qr=abc')).toBe('/zhamitos/en/t/04?qr=abc');
  });
});

describe('the table an intro was opened for', () => {
  it('is a table number or nothing', () => {
    expect(introTable('4')).toBe('4');
    expect(introTable('04')).toBe('04');
    expect(introTable('0')).toBeNull();
    expect(introTable('abc')).toBeNull();
    expect(introTable('1234')).toBeNull();
    expect(introTable(['4', '5'])).toBeNull();
    expect(introTable(undefined)).toBeNull();
  });
});
