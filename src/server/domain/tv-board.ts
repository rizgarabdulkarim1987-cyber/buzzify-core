/**
 * The TV menu board's pages (plan feature `display.tvBoard`, spec 2026-11-01-project-6-tv-board-design.md): the dishes the
 * menu can serve now, a category at a time, split into even pages that fit one screen.
 */

export const TV = { perPage: 6, defaultSeconds: 12, minSeconds: 5, maxSeconds: 60 } as const;

export interface TvSlide<P> {
  categoryId: string;
  name: string;
  /** 1-based, of `pages` for this category. */
  page: number;
  pages: number;
  products: P[];
}

export function tvSlides<P extends { categoryId: string; orderState: string }>(
  categories: ReadonlyArray<{ id: string; name: string }>,
  products: readonly P[],
  perPage: number = TV.perPage,
): TvSlide<P>[] {
  return categories.flatMap((category) => {
    const shown = products.filter((product) => product.categoryId === category.id && product.orderState === 'OK');
    if (shown.length === 0) return [];
    // Even pages: seven dishes make 4 and 3, not 6 and 1.
    const pages = Math.ceil(shown.length / perPage);
    const size = Math.ceil(shown.length / pages);
    return Array.from({ length: pages }, (_, index) => ({
      categoryId: category.id,
      name: category.name,
      page: index + 1,
      pages,
      products: shown.slice(index * size, (index + 1) * size),
    }));
  });
}

/** The seconds a page stays, from the address's `seconds`; the default when it is missing or outside the allowed range. */
export function tvSeconds(raw: string | undefined): number {
  if (raw === undefined || !/^\d{1,2}$/.test(raw)) return TV.defaultSeconds;
  const seconds = Number(raw);
  return seconds >= TV.minSeconds && seconds <= TV.maxSeconds ? seconds : TV.defaultSeconds;
}
