import { describe, expect, it } from 'vitest';
import { pickLocale } from '@/server/domain/locale-negotiation';

describe('pickLocale', () => {
  it('picks the best offered language', () =>
    expect(pickLocale('ar-IQ,ar;q=0.9,en;q=0.5', ['en', 'ar'], 'en')).toBe('ar'));

  it('maps Kurdish tags to Sorani', () => {
    for (const tag of ['ku', 'ckb', 'ku-IQ', 'ckb-IQ', 'CKB-iq']) {
      expect(pickLocale(tag, ['en', 'ckb'], 'en'), tag).toBe('ckb');
    }
  });

  it('does not treat Latin-script Kurdish (Kurmanji) as Sorani', () =>
    expect(pickLocale('ku-Latn', ['en', 'ckb'], 'en')).toBe('en'));

  it('falls back when nothing matches', () => expect(pickLocale('fr', ['en', 'ar'], 'ar')).toBe('ar'));

  it('falls back without a header or with an empty one', () => {
    expect(pickLocale(null, ['en', 'ar'], 'ar')).toBe('ar');
    expect(pickLocale('', ['en', 'ar'], 'ar')).toBe('ar');
  });

  it('respects quality values over order', () =>
    expect(pickLocale('en;q=0.3,ar;q=0.8,ckb;q=0.5', ['en', 'ar', 'ckb'], 'en')).toBe('ar'));

  it('keeps header order between equal qualities', () =>
    expect(pickLocale('ar,en', ['en', 'ar'], 'en')).toBe('ar'));

  it('skips languages the menu does not offer', () =>
    expect(pickLocale('ar,ckb;q=0.9,en;q=0.1', ['en', 'ckb'], 'en')).toBe('ckb'));

  it('never picks a language with quality 0', () =>
    expect(pickLocale('ar;q=0,en;q=0.2', ['en', 'ar'], 'ar')).toBe('en'));

  it('matches a regional tag to its language', () => expect(pickLocale('en-GB,en;q=0.9', ['ar', 'en'], 'ar')).toBe('en'));

  it('ignores wildcards and malformed entries', () => {
    expect(pickLocale('*', ['en', 'ar'], 'ar')).toBe('ar');
    expect(pickLocale(';q=abc,,;;,ar;q=zzz,en', ['en', 'ar'], 'ar')).toBe('en');
  });

  it('copes with an oversized header', () => {
    const header = `${'xx-YY,'.repeat(5000)}ar`;
    expect(pickLocale(header, ['en', 'ar'], 'en')).toBe('en');
  });
});
