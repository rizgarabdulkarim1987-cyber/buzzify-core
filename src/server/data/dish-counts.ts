import type { PrismaClient } from '@/generated/prisma/client';
import { showsCounts } from '@/server/domain/dish-counts';
import { cached } from './cache';
import { menuDb } from './tenant-db';

/**
 * The numbers on a dish card (docs/superpowers/specs/2026-10-30-menu-dish-counts-design.md). Orders: the quantity of the menu's own dishes the
 * cashier sold, paid, not cancelled and not refunded, from the first day. Views: the dish's permanent total (`countProductViews`). A dish is in
 * the result only from its first paid order. Nothing here is stored in a snapshot and nobody can edit it.
 */

export interface DishCount {
  orders: number;
  views: number;
}
export type DishCounts = Map<string, DishCount>;

export async function loadDishCounts(prisma: PrismaClient, menuId: string): Promise<DishCounts> {
  const db = menuDb(prisma, menuId);
  const [products, totals] = await Promise.all([db.product.findMany({ select: { id: true } }), db.productViewTotal.findMany({ select: { productId: true, views: true } })]);
  // Till sales belong to the restaurant, not the menu, so they are read by this menu's own product ids.
  const sold = await prisma.posOrderLine.groupBy({
    by: ['productId'],
    where: { productId: { in: products.map((product) => product.id) }, paymentId: { not: null }, cancelledAt: null, payment: { is: { reversal: null } } },
    _sum: { quantity: true },
  });
  const viewsOf = new Map(totals.map((row) => [row.productId, row.views]));
  const counts: DishCounts = new Map();
  for (const row of sold) {
    const orders = row._sum.quantity ?? 0;
    if (row.productId !== null && showsCounts(orders)) counts.set(row.productId, { orders, views: viewsOf.get(row.productId) ?? 0 });
  }
  return counts;
}

/** The menu's dish counts from the data cache, read again at most once a minute. Entries rather than a Map, so they pass through the cache. */
export function cachedDishCounts(prisma: PrismaClient, menuId: string): Promise<Array<[string, DishCount]>> {
  return cached(async () => [...(await loadDishCounts(prisma, menuId))], ['dish-counts', menuId], {
    revalidate: 60,
    tags: [`menu:${menuId}:dish-counts`],
  })();
}
