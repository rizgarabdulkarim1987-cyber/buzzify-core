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
