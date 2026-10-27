import type { AnyDb } from '@/server/data/tenant-db';

/**
 * The next number of a named running count for a restaurant (the Z report number), starting at 1. One atomic
 * `INSERT ... ON CONFLICT DO UPDATE`, so two callers at the same moment never get the same number and neither fails on the
 * first insert (a Prisma upsert would). Call it inside the transaction that uses the number, so a rollback gives it back.
 */
export async function nextCounterIn(db: AnyDb, restaurantId: string, name: string): Promise<number> {
  const rows = await db.$queryRaw<{ value: number }[]>`
    INSERT INTO "PosCounter" ("restaurantId", "name", "value") VALUES (${restaurantId}, ${name}, 1)
    ON CONFLICT ("restaurantId", "name") DO UPDATE SET "value" = "PosCounter"."value" + 1
    RETURNING "value"`;
  return Number(rows[0]!.value);
}
