import { describe, expect, it } from 'vitest';
import { chooseStudioLocale, STUDIO_LOCALE_COOKIE } from '@/studio/locale';

describe('chooseStudioLocale', () => {
  it('uses the signed-in person’s own language first', () => {
    expect(chooseStudioLocale({ actorLocale: 'ckb', cookie: 'ar', acceptLanguage: 'en' })).toBe('ckb');
  });

  it('uses the language switch’s cookie for someone signed out', () => {
    expect(chooseStudioLocale({ actorLocale: null, cookie: 'ar', acceptLanguage: 'en-US,en' })).toBe('ar');
  });

  it('falls back to the browser’s languages, then English', () => {
    expect(chooseStudioLocale({ cookie: null, acceptLanguage: 'ku-IQ,ar;q=0.8' })).toBe('ckb');
    expect(chooseStudioLocale({ cookie: 'fr', acceptLanguage: 'ar-IQ' })).toBe('ar');
    expect(chooseStudioLocale({ cookie: undefined, acceptLanguage: 'de-DE' })).toBe('en');
    expect(chooseStudioLocale({})).toBe('en');
  });

  it('names the cookie the language switch writes', () => {
    expect(STUDIO_LOCALE_COOKIE).toBe('studio-locale');
  });
});
