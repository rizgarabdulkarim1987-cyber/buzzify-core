import type { PrismaClient } from '@/generated/prisma/client';
import { cached } from './cache';
import { menuDb } from './tenant-db';

/**
 * "Most ordered" (docs/superpowers/specs/2026-10-18-sales-tools-design.md, 6.3): the menu's top dishes from real
 * demand over the last 30 days. Demand is the guest sessions that added a dish plus the portions the cashier sold of it
 * (paid, not cancelled, not refunded), so a restaurant that sells at the till gets its label even when few guests order
 * from their phones. A dish needs a little demand (3), so a quiet menu shows no label rather than a meaningless one.
 */

export const MOST_ORDERED_DAYS = 30;
export const MOST_ORDERED_MIN_DEMAND = 3;
export const MOST_ORDERED_COUNT = 3;
const DAY_MS = 86_400_000;

export async function loadMostOrdered(prisma: PrismaClient, menuId: string, now: Date): Promise<string[]> {
  const since = new Date(now.getTime() - MOST_ORDERED_DAYS * DAY_MS);
  const db = menuDb(prisma, menuId);
  const [events, products] = await Promise.all([
    db.analyticsEvent.findMany({
      where: { menuId, type: { in: ['ADD_TO_CART', 'PAIRING_ADD'] }, productId: { not: null }, occurredAt: { gte: since } },
      distinct: ['productId', 'anonymousSessionId'],
      select: { productId: true },
    }),
    db.product.findMany({ where: { menuId }, select: { id: true } }),
  ]);
  const demand = new Map<string, number>();
  for (const row of events) demand.set(row.productId!, (demand.get(row.productId!) ?? 0) + 1);
  // Till sales belong to the restaurant, not the menu, so they are read by this menu's own product ids.
  const sold = await prisma.posOrderLine.groupBy({
    by: ['productId'],
    where: {
      productId: { in: products.map((p) => p.id) },
      cancelledAt: null,
      createdAt: { gte: since },
      payment: { is: { reversal: null } },
    },
    _sum: { quantity: true },
  });
  for (const row of sold) demand.set(row.productId!, (demand.get(row.productId!) ?? 0) + (row._sum.quantity ?? 0));
  return [...demand]
    .filter(([, count]) => count >= MOST_ORDERED_MIN_DEMAND)
    .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, MOST_ORDERED_COUNT)
    .map(([productId]) => productId);
}

/** The menu's most ordered dishes from the data cache, read again at most once an hour. */
export function cachedMostOrdered(prisma: PrismaClient, menuId: string): Promise<string[]> {
  return cached(() => loadMostOrdered(prisma, menuId, new Date()), ['most-ordered', menuId], {
    revalidate: 3600,
    tags: [`menu:${menuId}:most-ordered`],
  })();
}
