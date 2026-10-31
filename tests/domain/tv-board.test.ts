import { describe, expect, it } from 'vitest';
import { tvSeconds, tvSlides } from '@/server/domain/tv-board';

const categories = [
  { id: 'c1', name: 'Coffee' },
  { id: 'c2', name: 'Cakes' },
  { id: 'c3', name: 'Empty' },
];
const dish = (id: string, categoryId: string, orderState = 'OK') => ({ id, categoryId, orderState });

describe('tvSlides', () => {
  it('makes one slide per category that has dishes to show, in the menu’s order', () => {
    const slides = tvSlides(categories, [dish('a', 'c2'), dish('b', 'c1')]);
    expect(slides.map((slide) => [slide.name, slide.products.map((p) => p.id)])).toEqual([['Coffee', ['b']], ['Cakes', ['a']]]);
  });

  it('leaves out what cannot be served now, and a category left with nothing', () => {
    const slides = tvSlides(categories, [dish('a', 'c1', 'OUT_OF_STOCK'), dish('b', 'c1', 'UNAVAILABLE'), dish('c', 'c2', 'OUT_OF_DAYPART'), dish('d', 'c2')]);
    expect(slides.map((slide) => slide.products.map((p) => p.id))).toEqual([['d']]);
  });

  it('splits a long category into even pages, numbered', () => {
    const products = Array.from({ length: 7 }, (_, n) => dish(`p${n}`, 'c1'));
    const slides = tvSlides(categories, products, 6);
    expect(slides.map((slide) => [slide.page, slide.pages, slide.products.length])).toEqual([[1, 2, 4], [2, 2, 3]]);
    expect(tvSlides(categories, products.slice(0, 6), 6)).toHaveLength(1);
  });

  it('is empty for a menu with nothing to show', () => {
    expect(tvSlides(categories, [])).toEqual([]);
  });
});

describe('tvSeconds', () => {
  it('reads the asked seconds within 5 to 60, else the default', () => {
    expect(tvSeconds(undefined)).toBe(12);
    expect(tvSeconds('20')).toBe(20);
    expect(tvSeconds('3')).toBe(12);
    expect(tvSeconds('61')).toBe(12);
    expect(tvSeconds('abc')).toBe(12);
    expect(tvSeconds('7.5')).toBe(12);
  });
});
