/**
 * Menu engineering (Kasavana and Smith, 1982; docs/superpowers/specs/2026-10-18-sales-tools-design.md, 6.2): every dish
 * by how popular it is with guests and how much it earns. A dish is popular when its share of guest sessions is at least
 * 70% of an equal share; profitable when its margin (price minus cost) is at least the popularity-weighted average margin
 * of the dishes with a cost. A dish without a cost cannot be judged: it is `NEEDS_COST`.
 */

export const DISH_CLASSES = ['STAR', 'PLOWHORSE', 'PUZZLE', 'DOG', 'NEEDS_COST'] as const;
export type DishClass = (typeof DISH_CLASSES)[number];

export interface DishPerformance {
  productId: string;
  /** Distinct guest sessions that added the dish. */
  sessions: number;
  price: number;
  cost: number | null;
  /** Price minus cost, in minor units; null without a cost. */
  margin: number | null;
  dishClass: DishClass;
}

const POPULAR_SHARE = 0.7;

export function classifyDishes(rows: ReadonlyArray<{ productId: string; price: number; cost: number | null; sessions: number }>): DishPerformance[] {
  if (rows.length === 0) return [];
  const totalSessions = rows.reduce((sum, row) => sum + row.sessions, 0);
  const equalShare = 1 / rows.length;

  const costed = rows.filter((row) => row.cost !== null);
  const marginOf = (row: { price: number; cost: number | null }) => (row.cost === null ? null : row.price - row.cost);
  const costedSessions = costed.reduce((sum, row) => sum + row.sessions, 0);
  const averageMargin =
    costed.length === 0
      ? 0
      : costedSessions > 0
        ? costed.reduce((sum, row) => sum + (marginOf(row) ?? 0) * row.sessions, 0) / costedSessions
        : costed.reduce((sum, row) => sum + (marginOf(row) ?? 0), 0) / costed.length;

  const classified = rows.map<DishPerformance>((row) => {
    const margin = marginOf(row);
    const popular = totalSessions > 0 && row.sessions / totalSessions >= POPULAR_SHARE * equalShare;
    const dishClass: DishClass =
      margin === null
        ? 'NEEDS_COST'
        : margin >= averageMargin
          ? popular
            ? 'STAR'
            : 'PUZZLE'
          : popular
            ? 'PLOWHORSE'
            : 'DOG';
    return { productId: row.productId, sessions: row.sessions, price: row.price, cost: row.cost, margin, dishClass };
  });

  const rank = (dishClass: DishClass) => DISH_CLASSES.indexOf(dishClass);
  return classified.sort(
    (a, b) => rank(a.dishClass) - rank(b.dishClass) || b.sessions - a.sessions || (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0),
  );
}
