import { describe, expect, it } from 'vitest';
import { menuAlternates } from '@/server/seo';

describe('menuAlternates', () => {
  const tenant = { slug: 'atelier', locales: ['en', 'ar', 'ckb'] as const };

  it('names the page itself as canonical and every language of it as an alternate', () => {
    expect(menuAlternates('https://menu.buzzify.me', { ...tenant, locales: [...tenant.locales] }, 'ar')).toEqual({
      canonical: 'https://menu.buzzify.me/atelier/ar',
      languages: {
        en: 'https://menu.buzzify.me/atelier/en',
        ar: 'https://menu.buzzify.me/atelier/ar',
        ckb: 'https://menu.buzzify.me/atelier/ckb',
      },
    });
  });

  it('keeps the path below the language for inner pages', () => {
    const { canonical, languages } = menuAlternates(
      'http://127.0.0.1:3100',
      { slug: 'atelier', locales: ['en', 'ar'] },
      'en',
      '/p/atelier-burger',
    );
    expect(canonical).toBe('http://127.0.0.1:3100/atelier/en/p/atelier-burger');
    expect(languages).toEqual({
      en: 'http://127.0.0.1:3100/atelier/en/p/atelier-burger',
      ar: 'http://127.0.0.1:3100/atelier/ar/p/atelier-burger',
    });
  });

  it('only lists the languages the menu offers', () => {
    expect(Object.keys(menuAlternates('https://x.me', { slug: 'cafe', locales: ['ar'] }, 'ar').languages)).toEqual(['ar']);
  });
});
