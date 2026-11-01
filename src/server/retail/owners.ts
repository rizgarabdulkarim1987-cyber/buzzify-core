import type { AnyDb } from '@/server/data/tenant-db';
import { StudioError } from '@/server/studio/framework/result';

/**
 * A linked retail shop always keeps an active owner. Retails' snapshot requires one, and without one no snapshot can be
 * sent: Retails would keep the last owner it was told about, with their access. So removing, deactivating or deleting a
 * shop's last active OWNER is refused; to hand a shop over, invite the new owner first, then remove the old one.
 */

/** The refusal's code, in `fields.refusalCode` (as `limitRefusal` carries `limitCode`). */
export const RETAIL_LAST_OWNER = 'RETAIL_LAST_OWNER';
export const RETAIL_LAST_OWNER_TEXT = 'A retail shop must keep an owner. Add another owner first.';

/** The linked retail shops the person holds the OWNER role in, by id. Read it before a write that removes the memberships. */
export async function retailShopsOwnedBy(tx: AnyDb, userId: string): Promise<string[]> {
  // eslint-disable-next-line no-restricted-properties -- the person's own memberships, keyed by the id the caller trusts
  const rows = await tx.$queryRaw<{ restaurantId: string }[]>`
    SELECT m."restaurantId" FROM "Membership" m
    JOIN "RetailLink" l ON l."restaurantId" = m."restaurantId"
    WHERE m."userId" = ${userId} AND m."role" = 'OWNER'
    ORDER BY m."restaurantId"`;
  return rows.map((row) => row.restaurantId);
}

/**
 * Refuses (`CONFLICT`, `RETAIL_LAST_OWNER`) when any of these businesses is a linked retail shop left without an active
 * OWNER. Call it after the write that removed an owner, on its transaction, so the refusal undoes the write. It locks each
 * shop's link first (in id order): two removals of a shop's two owners at once then count one after the other, and the
 * second sees the first's and is refused.
 */
export async function assertRetailOwnersKept(tx: AnyDb, restaurantIds: readonly string[]): Promise<void> {
  for (const restaurantId of [...new Set(restaurantIds)].sort()) {
    // eslint-disable-next-line no-restricted-properties -- a row lock on this one business's link, keyed by its id
    const linked = await tx.$queryRaw<{ restaurantId: string }[]>`SELECT "restaurantId" FROM "RetailLink" WHERE "restaurantId" = ${restaurantId} FOR UPDATE`;
    if (linked.length === 0) continue;
    const owners = await tx.membership.count({ where: { restaurantId, role: 'OWNER', user: { deactivatedAt: null } } });
    if (owners === 0) throw new StudioError('CONFLICT', RETAIL_LAST_OWNER_TEXT, { refusalCode: RETAIL_LAST_OWNER });
  }
}
