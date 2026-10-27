import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bodyOf, SHAPE_SETS, TEMPLATES } from '@/lib/templates';
import { contrastRatio as contrast } from '@/lib/palette';
import { layoutBook, splitPages } from '@/ui/template/bodies/book-pages';
import { BookBody } from '@/ui/template/bodies/BookBody';
import { registeredAs } from './body-registry';

describe('the Book shape', () => {
  it('is a registered body that sets the hero and the navigation', () => {
    expect(registeredAs('book')).toBe(BookBody.name);
    expect(SHAPE_SETS.book).toEqual(expect.arrayContaining(['hero', 'nav']));
    expect(bodyOf(TEMPLATES['the-book'].layout)).toBe('book');
  });

  it('starts on the mockup palette: dark stage, red leather, gold, cream paper', () => {
    expect(TEMPLATES['the-book'].palette).toMatchObject({ bg: '#1C140D', card: '#5A1E14', accent: '#E7C873', text: '#F7EFDC', button: '#6B1D12' });
  });

  it('keeps every palette readable: gold on the leather, red on the paper', () => {
    for (const { id, palette } of TEMPLATES['the-book'].palettes) {
      expect(contrast(palette.accent, palette.card), `${id} gold on leather`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.button, palette.text), `${id} red on paper`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.bg, palette.text), `${id} ink on paper`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('takes its colours from the palette tokens', () => {
    const css = readFileSync('src/ui/template/bodies/book.css', 'utf8');
    expect(css).toMatch(/--bk-leather:\s*var\(--card\)/);
    expect(css).toMatch(/--bk-gold:\s*var\(--accent\)/);
    expect(css).toMatch(/--bk-paper:\s*var\(--text\)/);
    expect([...new Set(css.replace(/#(000|fff)\b/gi, '').match(/#[0-9a-f]{3,8}\b/gi) ?? [])]).toEqual([]);
  });
});

describe('the pages', () => {
  it('puts four dishes on a page and folds a lonely last dish into the page before', () => {
    expect(splitPages([1, 2, 3])).toEqual([[1, 2, 3]]);
    expect(splitPages([1, 2, 3, 4, 5])).toEqual([[1, 2, 3, 4, 5]]);
    expect(splitPages([1, 2, 3, 4, 5, 6])).toEqual([[1, 2, 3, 4], [5, 6]]);
    expect(splitPages([1, 2, 3, 4, 5, 6, 7, 8, 9])).toEqual([[1, 2, 3, 4], [5, 6, 7, 8, 9]]);
    expect(splitPages([])).toEqual([]);
  });

  it('lays the book out as cover, index, then each section from its first page', () => {
    const { pages, firstPage } = layoutBook([{ id: 'a' }, { id: 'b' }], (c) => (c.id === 'a' ? [1, 2, 3, 4, 5, 6] : [7]));
    expect(pages.map((p) => p.kind)).toEqual(['cover', 'index', 'spread', 'spread', 'spread']);
    expect(firstPage.get('a')).toBe(2);
    expect(firstPage.get('b')).toBe(4);
  });
});
