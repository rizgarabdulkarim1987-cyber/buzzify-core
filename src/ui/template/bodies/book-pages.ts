/** How many dishes a page of the Book holds before the section carries on to the next page. */
export const DISHES_PER_PAGE = 4;

/**
 * A section's dishes split over consecutive pages, four to a page like the printed mockup. A last page left with a single
 * dish is folded into the one before it (a page of five), so no page is left almost empty. No dishes, no pages.
 */
export function splitPages<T>(items: readonly T[], per: number = DISHES_PER_PAGE): T[][] {
  const pages: T[][] = [];
  for (let at = 0; at < items.length; at += per) pages.push(items.slice(at, at + per));
  if (pages.length > 1 && pages[pages.length - 1]!.length === 1) {
    const last = pages.pop()!;
    pages[pages.length - 1]!.push(...last);
  }
  return pages;
}

/** One page of the book, in reading order: the cover, the index, then each section's pages. */
export type BookPage<C, P> = { kind: 'cover' } | { kind: 'index' } | { kind: 'spread'; category: C; products: P[]; first: boolean };

/** The pages of a menu: cover (0), index (1), then every section's dish pages, and where each section's first page is. */
export function layoutBook<C extends { id: string }, P>(categories: readonly C[], dishesOf: (category: C) => readonly P[]): { pages: BookPage<C, P>[]; firstPage: Map<string, number> } {
  const pages: BookPage<C, P>[] = [{ kind: 'cover' }, { kind: 'index' }];
  const firstPage = new Map<string, number>();
  for (const category of categories) {
    splitPages(dishesOf(category)).forEach((products, at) => {
      if (at === 0) firstPage.set(category.id, pages.length);
      pages.push({ kind: 'spread', category, products, first: at === 0 });
    });
  }
  return { pages, firstPage };
}
