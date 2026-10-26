import type { PrismaClient } from '@/generated/prisma/client';
import { cached } from './cache';
import { menuDb } from './tenant-db';

/**
 * "Most ordered" (docs/superpowers/specs/2026-10-18-sales-tools-design.md, 6.3): the menu's top dishes by the guest
 * sessions that added them in the last 14 days, from real events only. A dish needs at least 5 sessions, so a quiet
 * menu shows no label rather than a meaningless one.
 */

export const MOST_ORDERED_DAYS = 14;
export const MOST_ORDERED_MIN_SESSIONS = 5;
export const MOST_ORDERED_COUNT = 3;
const DAY_MS = 86_400_000;

export async function loadMostOrdered(prisma: PrismaClient, menuId: string, now: Date): Promise<string[]> {
  const rows = await menuDb(prisma, menuId).analyticsEvent.findMany({
    where: {
      menuId,
      type: { in: ['ADD_TO_CART', 'PAIRING_ADD'] },
      productId: { not: null },
      occurredAt: { gte: new Date(now.getTime() - MOST_ORDERED_DAYS * DAY_MS) },
    },
    distinct: ['productId', 'anonymousSessionId'],
    select: { productId: true },
  });
  const sessions = new Map<string, number>();
  for (const row of rows) sessions.set(row.productId!, (sessions.get(row.productId!) ?? 0) + 1);
  return [...sessions]
    .filter(([, count]) => count >= MOST_ORDERED_MIN_SESSIONS)
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
