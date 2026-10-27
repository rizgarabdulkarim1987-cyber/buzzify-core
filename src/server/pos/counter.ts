import type { AnyDb } from '@/server/data/tenant-db';

/**
 * The next number of a named running count for a restaurant (the Z report number), starting at 1. One atomic upsert, so two
 * callers at the same moment never get the same number; call it inside the transaction that uses the number, so a rollback
 * gives it back.
 */
export async function nextCounterIn(db: AnyDb, restaurantId: string, name: string): Promise<number> {
  const row = await db.posCounter.upsert({
    where: { restaurantId_name: { restaurantId, name } },
    create: { restaurantId, name, value: 1 },
    update: { value: { increment: 1 } },
    select: { value: true },
  });
  return row.value;
}
