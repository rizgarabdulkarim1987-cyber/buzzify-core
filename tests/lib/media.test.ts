import { describe, expect, it } from 'vitest';
import { parseMedia } from '@/lib/media';

describe('parseMedia', () => {
  it('accepts generated art', () => {
    expect(parseMedia([{ kind: 'art', art: 'cup', tone: '#6B4A2F' }])).toEqual([
      { kind: 'art', art: 'cup', tone: '#6B4A2F' },
    ]);
  });

  it('keeps a well-formed model name on art and drops a malformed one', () => {
    expect(parseMedia([{ kind: 'art', art: 'pastry', tone: '#9DB07A', model: 'millefeuille' }])).toEqual([
      { kind: 'art', art: 'pastry', tone: '#9DB07A', model: 'millefeuille' },
    ]);
    expect(parseMedia([{ kind: 'art', art: 'pastry', tone: '#9DB07A', model: '../etc/passwd' }])).toEqual([
      { kind: 'art', art: 'pastry', tone: '#9DB07A' },
    ]);
  });

  it('accepts images with safe URLs', () => {
    const image = { kind: 'image', url: '/media/atelier/espresso.jpg', alt: 'Espresso', width: 800, height: 600 };
    expect(parseMedia([image])).toEqual([image]);
    expect(parseMedia([{ ...image, url: 'https://cdn.example.com/a.jpg' }])).toHaveLength(1);
  });

  it('drops unsafe, malformed and unknown entries instead of throwing', () => {
    const bad = [
      { kind: 'image', url: 'javascript:alert(1)', alt: 'x', width: 1, height: 1 },
      { kind: 'image', url: '//evil.example/a.jpg', alt: 'x', width: 1, height: 1 },
      { kind: 'art', art: 'spaceship', tone: '#000000' },
      { kind: 'art', art: 'cup', tone: 'red' },
      { kind: 'video' },
      { kind: 'nope' },
      null,
      'text',
      42,
    ];
    expect(parseMedia(bad)).toEqual([]);
    expect(parseMedia(null)).toEqual([]);
    expect(parseMedia({})).toEqual([]);
  });
});

describe('library images (2b)', () => {
  const library = {
    kind: 'image',
    url: '/api/dev-media/r/r1/abc/webp-1080.webp',
    alt: 'Espresso',
    width: 1200,
    height: 800,
    alts: { en: 'Espresso', ar: 'إسبريسو', ckb: 'ئێسپرێسۆ' },
    srcset: {
      avif: '/api/dev-media/r/r1/abc/avif-320.avif 320w, /api/dev-media/r/r1/abc/avif-640.avif 640w',
      webp: '/api/dev-media/r/r1/abc/webp-320.webp 320w, /api/dev-media/r/r1/abc/webp-640.webp 640w',
    },
    placeholder: 'data:image/webp;base64,UklGRhIAAABXRUJQVlA4TAYAAAAvAAAAAA==',
    assetId: 'asset-1',
  };

  it('keeps the alts, srcset, placeholder and asset id of a library image', () => {
    expect(parseMedia([library])).toEqual([library]);
  });

  it('drops a draft asset entry', () => {
    expect(parseMedia([{ kind: 'asset', assetId: 'asset-1' }, library])).toEqual([library]);
  });

  it('drops a placeholder that is not a small WebP data URI', () => {
    const withoutPlaceholder: Record<string, unknown> = { ...library };
    delete withoutPlaceholder.placeholder;
    expect(parseMedia([{ ...library, placeholder: 'data:image/svg+xml,<svg onload=alert(1)>' }])).toEqual([withoutPlaceholder]);
    expect(parseMedia([{ ...library, placeholder: `data:image/webp;base64,${'A'.repeat(1100)}` }])).toEqual([withoutPlaceholder]);
  });

  it('drops a srcset that names an unsafe URL', () => {
    const withoutSrcset: Record<string, unknown> = { ...library };
    delete withoutSrcset.srcset;
    const unsafe = { avif: 'javascript:alert(1) 320w', webp: library.srcset.webp };
    expect(parseMedia([{ ...library, srcset: unsafe }])).toEqual([withoutSrcset]);
    expect(parseMedia([{ ...library, srcset: { avif: '//evil.example/a.avif 320w', webp: library.srcset.webp } }])).toEqual([withoutSrcset]);
  });

  it('keeps only alt texts of known languages', () => {
    expect(parseMedia([{ ...library, alts: { en: 'Espresso', fr: 'Expresso', ar: 7 } }])).toEqual([{ ...library, alts: { en: 'Espresso' } }]);
  });
});
