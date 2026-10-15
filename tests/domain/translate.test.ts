import { describe, expect, it } from 'vitest';
import { resolveText } from '@/server/domain/translate';

const map = {
  en: { name: 'Flat White', description: 'Silky milk' },
  ar: { name: 'فلات وايت' },
};

describe('resolveText', () => {
  it('returns the requested locale when present', () => {
    expect(resolveText(map, 'name', 'ar', 'en')).toBe('فلات وايت');
  });

  it('falls back to the restaurant default locale', () => {
    expect(resolveText(map, 'name', 'ckb', 'ar')).toBe('فلات وايت');
  });

  it('falls back to English, then to any available text', () => {
    expect(resolveText(map, 'description', 'ar', 'ar')).toBe('Silky milk');
    expect(resolveText({ ckb: { name: 'فلات' } }, 'name', 'ar', 'ar')).toBe('فلات');
  });

  it('treats blank strings as missing and never throws on empty input', () => {
    expect(resolveText({ en: { name: '   ' }, ar: { name: 'ا' } }, 'name', 'en', 'en')).toBe('ا');
    expect(resolveText(null, 'name', 'en', 'en')).toBe('');
    expect(resolveText({}, 'name', 'en', 'en')).toBe('');
  });
});
