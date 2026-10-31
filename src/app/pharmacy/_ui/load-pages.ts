/** Most pages one "load more" chain reads: a list this long wants a filter, not another page. */
export const MAX_PAGES = 20;

/** How many pages the address asks for: a whole number from 1 to the cap, one when it is anything else. */
export function pagesOf(text: string | undefined): number {
  if (text === undefined || !/^\d{1,3}$/.test(text)) return 1;
  const n = Number(text);
  return n < 1 ? 1 : Math.min(n, MAX_PAGES);
}

/**
 * Reads `pages` keyset pages in a row and joins their rows, so "load more" adds to what is on screen instead of replacing
 * it. The cursor of each page is the one the page before returned, so a row that leaves the filter between two pages
 * cannot make the next one skip. What only the first page carries (totals) is kept; `nextCursor` is the last page's.
 */
export async function loadPages<T extends { items: unknown[]; nextCursor: string | null }>(fetchPage: (cursor?: string) => Promise<T>, pages: number): Promise<T> {
  const first = await fetchPage();
  let items = first.items;
  let nextCursor = first.nextCursor;
  for (let read = 1; read < Math.min(pages, MAX_PAGES) && nextCursor !== null; read += 1) {
    const next = await fetchPage(nextCursor);
    items = [...items, ...next.items];
    nextCursor = next.nextCursor;
  }
  return { ...first, items, nextCursor };
}
