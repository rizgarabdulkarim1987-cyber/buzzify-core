import { describe, expect, it } from 'vitest';
import { menuAlternates, menuCanonical, menuOpenGraph } from '@/server/seo';

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

describe('menuCanonical', () => {
  it('names the menu’s home in the language, and no translations', () => {
    expect(menuCanonical('https://menu.buzzify.me', { slug: 'atelier' }, 'ckb')).toEqual({
      canonical: 'https://menu.buzzify.me/atelier/ckb',
    });
  });
});

describe('menuOpenGraph', () => {
  const image = { assetId: 'a1', url: '/api/dev-media/r/x/1080.webp', width: 1200, height: 630 };

  it('gives the image of the page’s language, at an absolute address', () => {
    expect(menuOpenGraph('http://127.0.0.1:3100', { title: 'Menu', description: '', image })).toEqual({
      images: [{ url: 'http://127.0.0.1:3100/api/dev-media/r/x/1080.webp', width: 1200, height: 630 }],
    });
  });

  it('keeps an image already on another host as it is', () => {
    const r2 = { ...image, url: 'https://media.buzzify.me/r/x/1080.webp' };
    expect(menuOpenGraph('https://menu.buzzify.me', { title: '', description: '', image: r2 })?.images[0]!.url).toBe('https://media.buzzify.me/r/x/1080.webp');
  });

  it('gives nothing without an image', () => {
    expect(menuOpenGraph('https://menu.buzzify.me', { title: 'Menu', description: '' })).toBeUndefined();
    expect(menuOpenGraph('https://menu.buzzify.me', undefined)).toBeUndefined();
  });
});
