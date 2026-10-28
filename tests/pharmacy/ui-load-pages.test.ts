import { describe, expect, it } from 'vitest';
import { loadPages, MAX_PAGES, pagesOf } from '@/app/pharmacy/_ui/load-pages';

/** A keyset list of `total` rows, `size` to a page: the cursor is the last id of the page before. */
function source(total: number, size: number) {
  const calls: Array<string | undefined> = [];
  const fetchPage = async (cursor?: string) => {
    calls.push(cursor);
    const from = cursor === undefined ? 0 : Number(cursor);
    const items = Array.from({ length: Math.min(size, total - from) }, (_, i) => ({ id: from + i + 1 }));
    const last = from + items.length;
    return { items, nextCursor: last < total ? String(last) : null, totals: { count: total } };
  };
  return { fetchPage, calls };
}

describe('loadPages, "load more" that adds rows', () => {
  it('returns the first page for one page', async () => {
    const { fetchPage, calls } = source(120, 50);
    const page = await loadPages(fetchPage, 1);
    expect(page.items).toHaveLength(50);
    expect(page.nextCursor).toBe('50');
    expect(calls).toEqual([undefined]);
  });
  it('appends the next pages after the rows already shown, in order and without a repeat', async () => {
    const { fetchPage, calls } = source(120, 50);
    const page = await loadPages(fetchPage, 2);
    expect(page.items.map((r) => r.id)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(page.nextCursor).toBe('100');
    expect(calls).toEqual([undefined, '50']);
    const all = await loadPages(fetchPage, 3);
    expect(all.items).toHaveLength(120);
    expect(all.nextCursor).toBeNull();
  });
  it('stops at the end of the list however many pages are asked for, and keeps what only the first page carries', async () => {
    const { fetchPage, calls } = source(60, 50);
    const page = await loadPages(fetchPage, 9);
    expect(page.items).toHaveLength(60);
    expect(page.nextCursor).toBeNull();
    expect(page.totals).toEqual({ count: 60 });
    expect(calls).toHaveLength(2);
  });
  it('never asks for more than the cap', async () => {
    const { fetchPage, calls } = source(100_000, 10);
    const page = await loadPages(fetchPage, 10_000);
    expect(calls).toHaveLength(MAX_PAGES);
    expect(page.nextCursor).not.toBeNull();
  });
});

describe('pagesOf', () => {
  it('reads the pages count from the address: one by default, a whole number from 1 to the cap', () => {
    expect(pagesOf(undefined)).toBe(1);
    expect(pagesOf('3')).toBe(3);
    expect(pagesOf('0')).toBe(1);
    expect(pagesOf('-2')).toBe(1);
    expect(pagesOf('2.5')).toBe(1);
    expect(pagesOf('abc')).toBe(1);
    expect(pagesOf(String(MAX_PAGES + 50))).toBe(MAX_PAGES);
  });
});
