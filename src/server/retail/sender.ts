import type { PrismaClient } from '@/generated/prisma/client';
import type { AnyDb } from '@/server/data/tenant-db';
import type { RetailAnswer, RetailClient } from '@/server/retail/client';
import { RetailConfigError } from '@/server/retail/config';
import { ensureRetailVersion } from '@/server/retail/outbox';
import { buildRetailState, NotRetailError, type ProvisionBody, type RetailState } from '@/server/retail/snapshot';

/**
 * Delivers the outbox to Retails. A row is claimed under a lease (so two senders, a cron run and a kick, never send one
 * business at once), its snapshot is built fresh in a short transaction, sent outside any transaction, and the answer
 * recorded in another short one:
 *
 * - accepted: the link remembers what Retails has (its id, the version, the content hash) and the row is done, unless
 *   a change was queued while the call was on the wire: then the row stays, due at once, for the newer version;
 * - not ready (no owner or no subscription yet): the row waits, without spending an attempt;
 * - a retryable failure: one more attempt, backing off from a minute to an hour, failed after 20;
 * - a permanent refusal (Retails' 400, 413 or 422): failed at once, with its code;
 * - not a retail business any more: the row is removed.
 *
 * Timestamps are JavaScript dates passed in, never SQL's now(): the columns are `timestamp` without a zone holding UTC,
 * and now() would be the database server's local time. Logs carry the business id and a code, nothing else.
 */

export const MAX_ATTEMPTS = 20;
export const LEASE_MS = 120_000;
/** A row that waits for an owner or a subscription looks again after this; the change it waits for bumps it sooner. */
export const WAIT_MS = 3_600_000;
/** Per run: with the reconcile's 50 an hour it stays under Retails' 120 calls a minute. */
export const SEND_LIMIT = 40;
/** Calls at once in a run: 40 calls that each time out at 5 s still end inside the route's minute. */
const CONCURRENCY = 4;

/** After a CONFIG error (a Studio setting missing or invalid): looked at again this soon, no attempt spent. */
export const CONFIG_RETRY_MS = 5 * 60_000;

/**
 * A row failed by Retails' refusal (400, 413, 422) rather than by running out of attempts: sending the same again cannot
 * succeed, so only a change (a bump) or the admin's Resync tries it again; the reconcile does not.
 */
export function failedPermanently(row: { failedAt: Date | null; attempts: number }): boolean {
  return row.failedAt !== null && row.attempts < MAX_ATTEMPTS;
}

const BASE_DELAY_MS = 60_000;
const MAX_DELAY_MS = 3_600_000;
const JITTER = 0.1;

export type Delivery = 'sent' | 'waiting' | 'retry' | 'failed' | 'gone';

/** The wait after the n-th failed attempt: 1, 2, 4 ... minutes, at most an hour, each ±10 %. */
export function nextDelayMs(attempts: number, random: () => number = Math.random): number {
  const base = Math.min(BASE_DELAY_MS * 2 ** (Math.max(attempts, 1) - 1), MAX_DELAY_MS);
  return Math.round(base * (1 + (random() * 2 - 1) * JITTER));
}

const log = (restaurantId: string, code: string) => console.error(`[retail.sync] ${restaurantId} ${code}`);

/** Leases up to `limit` due rows (not failed, due, not leased or the lease ran out), oldest due first. One statement. */
export async function claimDue(prisma: PrismaClient, now: Date, limit: number): Promise<string[]> {
  const leasedUntil = new Date(now.getTime() + LEASE_MS);
  // eslint-disable-next-line no-restricted-properties -- the platform's outbox; SKIP LOCKED keeps two claims apart
  const rows = await prisma.$queryRaw<{ restaurantId: string }[]>`
    UPDATE "RetailOutbox" SET "leasedUntil" = ${leasedUntil}, "lastAttemptAt" = ${now}
    WHERE "restaurantId" IN (
      SELECT "restaurantId" FROM "RetailOutbox"
      WHERE "failedAt" IS NULL AND "nextAttemptAt" <= ${now} AND ("leasedUntil" IS NULL OR "leasedUntil" < ${now})
      ORDER BY "nextAttemptAt" LIMIT ${limit}
      FOR UPDATE SKIP LOCKED)
    RETURNING "restaurantId"`;
  return rows.map((row) => row.restaurantId);
}

/** The same claim for one business: true when this caller now holds its lease. */
export async function claimOne(prisma: PrismaClient, restaurantId: string, now: Date): Promise<boolean> {
  const leasedUntil = new Date(now.getTime() + LEASE_MS);
  // eslint-disable-next-line no-restricted-properties -- one business's outbox row, keyed by its id
  const rows = await prisma.$queryRaw<{ restaurantId: string }[]>`
    UPDATE "RetailOutbox" SET "leasedUntil" = ${leasedUntil}, "lastAttemptAt" = ${now}
    WHERE "restaurantId" IN (
      SELECT "restaurantId" FROM "RetailOutbox"
      WHERE "restaurantId" = ${restaurantId} AND "failedAt" IS NULL AND "nextAttemptAt" <= ${now}
        AND ("leasedUntil" IS NULL OR "leasedUntil" < ${now})
      FOR UPDATE SKIP LOCKED)
    RETURNING "restaurantId"`;
  return rows.length > 0;
}

type Prepared =
  | { kind: 'gone' }
  | { kind: 'waiting' }
  | { kind: 'send'; provision: ProvisionBody | null; state: RetailState; hash: string };

/** The snapshot to send, read in one short transaction; the row waits (lease off, attempts kept) when it is not ready. */
async function prepare(prisma: PrismaClient, restaurantId: string, now: Date): Promise<Prepared> {
  try {
    return await prisma.$transaction(async (tx) => {
      // A ready shop still at version 0 (its readiness came without a bump) is first given version 1: Retails refuses 0.
      if ((await ensureRetailVersion(tx, restaurantId)) === null) throw new NotRetailError(restaurantId);
      const built = await buildRetailState(tx, restaurantId);
      // A link left on a business that is no longer a retail shop is never sent.
      const business = await tx.restaurant.findUnique({ where: { id: restaurantId }, select: { sector: true } });
      if (business?.sector !== 'RETAIL') throw new NotRetailError(restaurantId);
      if (!built.ready || built.state.version < 1) {
        // The build holds the link's row lock (FOR SHARE), so a bump waits until this commits and then makes the row due
        // again itself. The outbox row is locked after the link, in the bump's order, and the waiting write is made only
        // while the row is still for the version this build read: a newer one stays due now.
        const link = await tx.retailLink.findUniqueOrThrow({ where: { restaurantId }, select: { stateVersion: true } });
        const row = await lockRow(tx, restaurantId);
        if (row && row.dueVersion <= link.stateVersion) {
          await tx.retailOutbox.update({
            where: { restaurantId },
            data: { waitingFor: built.ready ? null : built.waitingFor, leasedUntil: null, nextAttemptAt: new Date(now.getTime() + WAIT_MS) },
          });
        } else if (row) {
          await tx.retailOutbox.update({ where: { restaurantId }, data: { leasedUntil: null } });
        }
        return { kind: 'waiting' } as const;
      }
      const link = await tx.retailLink.findUniqueOrThrow({ where: { restaurantId }, select: { retailBusinessId: true } });
      return { kind: 'send', provision: link.retailBusinessId === null ? built.provision : null, state: built.state, hash: built.hash } as const;
    });
  } catch (error) {
    if (!(error instanceof NotRetailError)) throw error;
    await prisma.retailOutbox.deleteMany({ where: { restaurantId } });
    return { kind: 'gone' };
  }
}

/** Calls Retails; a missing setting is a retryable CONFIG, and nothing thrown escapes. */
async function send(client: RetailClient, prepared: Extract<Prepared, { kind: 'send' }>): Promise<RetailAnswer> {
  try {
    return prepared.provision ? await client.provision(prepared.provision) : await client.pushState(prepared.state);
  } catch (error) {
    return { kind: 'retry', code: error instanceof RetailConfigError ? 'CONFIG' : 'ERROR' };
  }
}

const businessIdOf = (body: unknown): string | null => {
  const id = (body as { businessId?: unknown } | null)?.businessId;
  return typeof id === 'string' && id.length > 0 && id.length <= 128 ? id : null;
};

/** The row as it is now, locked for this update; null when it was removed (the business was deleted). */
async function lockRow(tx: AnyDb, restaurantId: string): Promise<{ dueVersion: number; attempts: number } | null> {
  // eslint-disable-next-line no-restricted-properties -- one business's outbox row, keyed by its id
  const rows = await tx.$queryRaw<{ dueVersion: number; attempts: number }[]>`
    SELECT "dueVersion", "attempts" FROM "RetailOutbox" WHERE "restaurantId" = ${restaurantId} FOR UPDATE`;
  return rows[0] ?? null;
}

/**
 * Records a delivery's answer. `sent` is the version that went out; a row whose dueVersion is above it was bumped while
 * the call was on the wire: that newer version is due at once with its attempts reset (the bump did both), so the
 * answer for the older one only lifts the lease and never spends, delays or fails the newer one.
 */
async function record(prisma: PrismaClient, restaurantId: string, prepared: Extract<Prepared, { kind: 'send' }>, answer: RetailAnswer, now: Date): Promise<Delivery> {
  const sent = prepared.state.version;
  let outcome: RetailAnswer = answer;
  if (answer.kind === 'ok' && prepared.provision && businessIdOf(answer.body) === null) outcome = { kind: 'retry', code: 'BAD_RESPONSE' };
  if (answer.kind === 'notFound' && prepared.provision) outcome = { kind: 'retry', code: 'HTTP_404' };

  return prisma.$transaction(async (tx) => {
    if (outcome.kind === 'ok') {
      const link = await tx.retailLink.findUnique({ where: { restaurantId }, select: { acceptedVersion: true } });
      if (link) {
        const businessId = prepared.provision ? businessIdOf(outcome.body) : null;
        await tx.retailLink.update({
          where: { restaurantId },
          data: {
            acceptedVersion: Math.max(link.acceptedVersion, sent),
            sentHash: prepared.hash,
            ...(businessId ? { retailBusinessId: businessId, provisionedAt: now } : {}),
          },
        });
      }
      // A newer bump keeps the row (dueVersion > sent); its lease is lifted so it goes out now, not when the lease ends.
      // eslint-disable-next-line no-restricted-properties -- one business's outbox row, keyed by its id
      const done = await tx.$executeRaw`DELETE FROM "RetailOutbox" WHERE "restaurantId" = ${restaurantId} AND "dueVersion" <= ${sent}`;
      if (done === 0) await tx.retailOutbox.updateMany({ where: { restaurantId }, data: { leasedUntil: null, waitingFor: null } });
      return 'sent';
    }

    // Retails has no such business (it was restored from an older backup): the next attempt provisions again.
    if (outcome.kind === 'notFound') {
      await tx.retailLink.updateMany({ where: { restaurantId }, data: { retailBusinessId: null } });
      outcome = { kind: 'retry', code: 'NOT_FOUND' };
    }
    log(restaurantId, outcome.code);

    const row = await lockRow(tx, restaurantId);
    if (!row) return 'gone';
    if (row.dueVersion > sent) {
      await tx.retailOutbox.update({ where: { restaurantId }, data: { leasedUntil: null } });
      return 'retry';
    }
    // A missing or invalid setting is Studio's, not Retails': it waits for the fix without spending attempts.
    if (outcome.kind === 'retry' && outcome.code === 'CONFIG') {
      await tx.retailOutbox.update({
        where: { restaurantId },
        data: { lastError: 'CONFIG', nextAttemptAt: new Date(now.getTime() + CONFIG_RETRY_MS), leasedUntil: null, waitingFor: null },
      });
      return 'retry';
    }
    if (outcome.kind === 'permanent') {
      await tx.retailOutbox.update({ where: { restaurantId }, data: { failedAt: now, lastError: outcome.code, leasedUntil: null, waitingFor: null } });
      return 'failed';
    }
    const attempts = row.attempts + 1;
    const failed = attempts >= MAX_ATTEMPTS;
    await tx.retailOutbox.update({
      where: { restaurantId },
      data: {
        attempts,
        lastError: outcome.code,
        nextAttemptAt: new Date(now.getTime() + nextDelayMs(attempts)),
        failedAt: failed ? now : null,
        leasedUntil: null,
        waitingFor: null,
      },
    });
    return failed ? 'failed' : 'retry';
  });
}

/** Delivers one claimed row (the caller holds its lease). */
export async function deliverOne(prisma: PrismaClient, client: RetailClient, restaurantId: string, now: Date): Promise<Delivery> {
  const prepared = await prepare(prisma, restaurantId, now);
  if (prepared.kind !== 'send') return prepared.kind;
  // Outside any transaction: a slow Retails holds no lock and no connection.
  const answer = await send(client, prepared);
  return record(prisma, restaurantId, prepared, answer, now);
}

/** A kick's delivery: claims the business's row when it is due and free, then delivers it; 'busy' when it is not. */
export async function deliverNow(prisma: PrismaClient, client: RetailClient, restaurantId: string, now: Date): Promise<Delivery | 'busy'> {
  if (!(await claimOne(prisma, restaurantId, now))) return 'busy';
  return deliverOne(prisma, client, restaurantId, now);
}

/** One sync run: claims what is due and delivers it, a few calls at a time. A row that throws is retried once its lease ends. */
export async function runSender(
  prisma: PrismaClient,
  client: RetailClient,
  now: Date,
  limit = SEND_LIMIT,
): Promise<{ sent: number; waiting: number; retried: number; failed: number }> {
  const counts = { sent: 0, waiting: 0, retried: 0, failed: 0 };
  const queue = await claimDue(prisma, now, limit);
  const worker = async () => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      let outcome: Delivery;
      try {
        outcome = await deliverOne(prisma, client, id, now);
      } catch (error) {
        log(id, error instanceof Error ? 'INTERNAL' : 'UNKNOWN');
        outcome = 'retry';
      }
      if (outcome === 'sent') counts.sent += 1;
      else if (outcome === 'waiting') counts.waiting += 1;
      else if (outcome === 'retry') counts.retried += 1;
      else if (outcome === 'failed') counts.failed += 1;
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return counts;
}
