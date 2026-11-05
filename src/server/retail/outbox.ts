import { after } from 'next/server';
import { getPrisma } from '@/server/data/prisma';
import type { AnyDb } from '@/server/data/tenant-db';
import { retailConfig } from '@/server/retail/config';
import { retailShopsOwnedBy } from '@/server/retail/owners';
import { buildRetailState } from '@/server/retail/snapshot';

/**
 * Queues a linked retail business's snapshot for delivery. Every change that alters what the snapshot carries calls one
 * of these right after its write, on the same transaction: the version grows with the change and the outbox row is due
 * with it, and a change that rolls back takes both with it. There is one coalescing outbox row per business (the
 * snapshot is built at send time), so many changes before a delivery send once, at the newest version.
 *
 * Each runs on any client (the application's, a restaurant's scoped one, or the platform's): they touch only
 * `RetailLink`, `RetailOutbox`, and `Membership` / `Subscription` by the ids given, through SQL keyed by those ids.
 */

/**
 * +1 on RetailLink.stateVersion and upsert of RetailOutbox(dueVersion, attempts 0, nextAttemptAt now, failedAt/lastError/waitingFor null).
 * Returns the new version, or null when the restaurant has no RetailLink (not RETAIL): callers can call it unconditionally.
 */
export async function bumpRetailState(tx: AnyDb, restaurantId: string): Promise<number | null> {
  // The columns are `timestamp` without a zone holding UTC, as Prisma writes them: SQL's now() would store the server's
  // local time, so the instant is passed in.
  const now = new Date();
  // The update takes the link's row lock, so concurrent bumps of one business are serialised: each gets its own version,
  // and they commit in version order.
  // eslint-disable-next-line no-restricted-properties -- one business's link, keyed by its id
  const bumped = await tx.$queryRaw<{ stateVersion: number }[]>`
    UPDATE "RetailLink" SET "stateVersion" = "stateVersion" + 1, "updatedAt" = ${now}
    WHERE "restaurantId" = ${restaurantId}
    RETURNING "stateVersion"`;
  if (bumped.length === 0) return null;
  const version = bumped[0]!.stateVersion;
  // A failed or waiting row is due again at once: the change may be what it was waiting for, and the retries start over.
  // eslint-disable-next-line no-restricted-properties -- one business's outbox row, keyed by its id
  await tx.$executeRaw`
    INSERT INTO "RetailOutbox" ("restaurantId", "dueVersion", "attempts", "nextAttemptAt", "createdAt", "updatedAt")
    VALUES (${restaurantId}, ${version}, 0, ${now}, ${now}, ${now})
    ON CONFLICT ("restaurantId") DO UPDATE SET
      "dueVersion" = EXCLUDED."dueVersion",
      "attempts" = 0,
      "nextAttemptAt" = EXCLUDED."nextAttemptAt",
      "failedAt" = NULL,
      "lastError" = NULL,
      "waitingFor" = NULL,
      "updatedAt" = EXCLUDED."updatedAt"`;
  return version;
}

/**
 * Retails already has `remoteVersion` or later (Studio's database was restored from a backup older than what it sent):
 * Retails would ignore every snapshot at or under that version, so the version first jumps to it, then one bump puts
 * the next delivery above it. One jump per call; returns the new version, or null when the business is not retail.
 */
export async function jumpRetailVersion(tx: AnyDb, restaurantId: string, remoteVersion: number): Promise<number | null> {
  // eslint-disable-next-line no-restricted-properties -- one business's link, keyed by its id
  await tx.$executeRaw`
    UPDATE "RetailLink" SET "stateVersion" = GREATEST("stateVersion", ${remoteVersion}::int), "updatedAt" = ${new Date()}
    WHERE "restaurantId" = ${restaurantId}`;
  return bumpRetailState(tx, restaurantId);
}

/** Bumps each business in id order: two bumps of overlapping sets take the link locks in the same order, so never deadlock. */
async function bumpEach(tx: AnyDb, restaurantIds: readonly string[]): Promise<void> {
  for (const restaurantId of restaurantIds) await bumpRetailState(tx, restaurantId);
}

/** Every RETAIL business the user OWNs: a change to the person (name, email, deactivation) may change its snapshot's owner. */
export async function bumpRetailForUser(tx: AnyDb, userId: string): Promise<void> {
  await bumpEach(tx, await retailShopsOwnedBy(tx, userId));
}

/** Every RETAIL business with a retail subscription on the code: a change to the plan changes their snapshots' plan. */
export async function bumpRetailForPlan(tx: AnyDb, planCode: string): Promise<void> {
  // eslint-disable-next-line no-restricted-properties -- the platform's plan change reaches every business on the plan
  const on = await tx.$queryRaw<{ restaurantId: string }[]>`
    SELECT DISTINCT s."restaurantId" FROM "Subscription" s
    JOIN "RetailLink" l ON l."restaurantId" = s."restaurantId"
    WHERE s."applicationId" = 'retail' AND s."planCode" = ${planCode}
    ORDER BY s."restaurantId"`;
  await bumpEach(tx, on.map((row) => row.restaurantId));
}

/**
 * The shop's current version, first bumping it from 0 when the shop is ready to send (owner and subscription in place):
 * a snapshot is never sent at version 0, which Retails refuses. 0 while it is not ready; null when it is not retail.
 * For the reconcile, which may meet a shop whose readiness came from a change without a hook.
 */
export async function ensureRetailVersion(tx: AnyDb, restaurantId: string): Promise<number | null> {
  const link = await tx.retailLink.findUnique({ where: { restaurantId }, select: { stateVersion: true } });
  if (!link) return null;
  if (link.stateVersion > 0) return link.stateVersion;
  if (!(await buildRetailState(tx, restaurantId)).ready) return 0;
  return bumpRetailState(tx, restaurantId);
}

/**
 * Registers an immediate attempt for the business once the change has committed (`afterCommit`; without one it is
 * registered at once, for a caller whose transaction is already over). The attempt itself never runs inside the
 * request: it is handed to `after()`, which runs it once the response is out and keeps a serverless function alive until
 * it ends. Without a request scope (tests, scripts) `after()` throws and the attempt simply starts, unawaited. It
 * claims the row under the sender's lease, so it never races a cron run, and any failure is swallowed: the row stays
 * queued and the sync cron delivers it. Without RETAIL_URL it does nothing.
 */
export function kickAfterCommit(afterCommit: ((fn: () => void) => void) | undefined, restaurantId: string): void {
  const register = afterCommit ?? ((fn: () => void) => fn());
  register(() => {
    if (!retailConfig().enabled) return;
    const task = () => kick(restaurantId);
    try {
      after(task);
    } catch {
      void task();
    }
  });
}

async function kick(restaurantId: string): Promise<void> {
  try {
    // Loaded here: the sender imports this module.
    const [{ deliverNow }, { createHttpRetailClient }] = await Promise.all([import('@/server/retail/sender'), import('@/server/retail/client')]);
    await deliverNow(getPrisma(), createHttpRetailClient(), restaurantId, new Date());
  } catch (error) {
    console.error(`[retail.sync] ${restaurantId} ${error instanceof Error ? 'KICK_FAILED' : 'UNKNOWN'}`);
  }
}
