import type { AnyDb } from '@/server/data/tenant-db';

/**
 * The kitchen has finished the order, so an OPEN order may go READY (the table turns green): no live sent line is left to
 * cook, at least one live sent line is ready, and no live line is still waiting to be sent. Call it while holding the
 * order's row lock (after `bumpOrder`), so the counts are exact. A restaurant that never sends to a kitchen has no sent
 * line, so this stays false for it.
 */
export async function kitchenDone(db: AnyDb, restaurantId: string, orderId: string): Promise<boolean> {
  const live = { orderId, restaurantId, cancelledAt: null };
  if ((await db.posOrderLine.count({ where: { ...live, sentAt: { not: null }, readyAt: null } })) > 0) return false;
  if ((await db.posOrderLine.count({ where: { ...live, sentAt: null } })) > 0) return false;
  return (await db.posOrderLine.count({ where: { ...live, sentAt: { not: null }, readyAt: { not: null } } })) > 0;
}
