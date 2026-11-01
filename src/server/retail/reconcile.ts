import { z } from 'zod';
import type { PrismaClient } from '@/generated/prisma/client';
import type { RetailAnswer, RetailClient } from '@/server/retail/client';
import { RetailConfigError } from '@/server/retail/config';
import { bumpRetailState, ensureRetailVersion, jumpRetailVersion } from '@/server/retail/outbox';
import { failedPermanently } from '@/server/retail/sender';
import { buildRetailState, NotRetailError } from '@/server/retail/snapshot';

/**
 * The daily check of each linked shop against Retails, which catches what the hooks cannot:
 *
 * - drift: the snapshot built now differs from the last one Retails accepted (a change without a hook, such as a person
 *   renaming themselves through the sign-in pages) -> a bump, and the sender delivers it;
 * - Retails behind: it reports an older version than it accepted (restored from a backup) -> a bump;
 * - Retails lost the shop: a 404 for a shop that was provisioned -> forget its Retails id and bump, so the sender
 *   provisions it again.
 *
 * What Retails reports (its version, status and this month's AI use) is stored for display. A failed read keeps the
 * stored reading but still moves the shop to the back of the queue (reconciledAt), so shops that keep failing never
 * hold the others up; they are tried again the next day. A link on a business that is no longer retail is 'gone'. Dates are JavaScript dates, never SQL's now().
 */

/** Per run (hourly): every shop is checked about once a day, well under Retails' 120 calls a minute. */
export const RECONCILE_LIMIT = 50;
export const RECONCILE_EVERY_MS = 24 * 3_600_000;

export type Reconciled = 'same' | 'drift' | 'reprovision' | 'error' | 'gone';

/** Retails' `GET /api/core/v1/state` answer. */
const reportSchema = z.object({
  version: z.number().int().min(0),
  status: z.string().min(1).max(32),
  aiUsageMonth: z.object({ month: z.string().min(1).max(32), units: z.number().int().min(0) }),
});

const log = (restaurantId: string, code: string) => console.error(`[retail.reconcile] ${restaurantId} ${code}`);

async function read(client: RetailClient, restaurantId: string): Promise<RetailAnswer> {
  try {
    return await client.readState(restaurantId);
  } catch (error) {
    return { kind: 'retry', code: error instanceof RetailConfigError ? 'CONFIG' : 'ERROR' };
  }
}

export async function reconcileOne(prisma: PrismaClient, client: RetailClient, restaurantId: string, now: Date): Promise<Reconciled> {
  let checked: { drift: boolean; known: boolean; queued: boolean; acceptedVersion: number } | 'gone';
  try {
    checked = await prisma.$transaction(async (tx) => {
      const before = await tx.retailLink.findUnique({ where: { restaurantId }, select: { stateVersion: true, restaurant: { select: { sector: true } } } });
      if (!before) throw new NotRetailError(restaurantId);
      // A link left on a business that is no longer a retail shop: nothing to compare or send; its queue is cleared.
      if (before.restaurant.sector !== 'RETAIL') {
        await tx.retailOutbox.deleteMany({ where: { restaurantId } });
        await tx.retailLink.update({ where: { restaurantId }, data: { reconciledAt: now } });
        return 'gone' as const;
      }
      // A ready shop still at version 0 is queued at version 1 (its readiness came without a bump).
      const version = await ensureRetailVersion(tx, restaurantId);
      const link = await tx.retailLink.findUniqueOrThrow({
        where: { restaurantId },
        select: { sentHash: true, acceptedVersion: true, retailBusinessId: true, provisionedAt: true },
      });
      const known = link.retailBusinessId !== null || link.provisionedAt !== null;
      let drift = before.stateVersion === 0 && (version ?? 0) > 0;
      const built = await buildRetailState(tx, restaurantId);
      const row = await tx.retailOutbox.findUnique({ where: { restaurantId }, select: { failedAt: true, attempts: true } });
      if (!drift && built.ready && built.hash !== link.sentHash) {
        // No bump when a delivery is already queued (it builds the snapshot fresh when it goes, so it carries this content),
        // nor when Retails refused the last one outright (the same again would be refused: the admin's Resync retries it).
        // A row that ran out of attempts (Retails was down) is queued again.
        if (!row || (row.failedAt !== null && !failedPermanently(row))) await bumpRetailState(tx, restaurantId);
        drift = true;
      }
      if (!known) await tx.retailLink.update({ where: { restaurantId }, data: { reconciledAt: now } });
      const queued = (await tx.retailOutbox.findUnique({ where: { restaurantId }, select: { failedAt: true } }))?.failedAt === null;
      return { drift, known, queued, acceptedVersion: link.acceptedVersion };
    });
  } catch (error) {
    log(restaurantId, error instanceof NotRetailError ? 'NOT_RETAIL' : 'INTERNAL');
    // Moved to the back of the queue, so a shop that keeps failing never holds the others up.
    await prisma.retailLink.updateMany({ where: { restaurantId }, data: { reconciledAt: now } }).catch(() => undefined);
    return 'error';
  }
  if (checked === 'gone') return 'gone';
  // Never provisioned: Retails has nothing to report yet.
  if (!checked.known) return checked.drift ? 'drift' : 'same';

  /** A failed read keeps the stored reading (it is what Retails last said) but moves the shop to the back of the queue. */
  const failed = async (code: string): Promise<Reconciled> => {
    log(restaurantId, code);
    await prisma.retailLink.update({ where: { restaurantId }, data: { reconciledAt: now } });
    return 'error';
  };

  const answer = await read(client, restaurantId);
  if (answer.kind === 'notFound') {
    await prisma.$transaction(async (tx) => {
      await tx.retailLink.update({ where: { restaurantId }, data: { retailBusinessId: null, reconciledAt: now } });
      await bumpRetailState(tx, restaurantId);
    });
    return 'reprovision';
  }
  if (answer.kind !== 'ok') return failed(answer.code);
  const report = reportSchema.safeParse(answer.body);
  if (!report.success) return failed('BAD_RESPONSE');
  const behind = report.data.version < checked.acceptedVersion;
  const queued = checked.queued;
  let ahead = false;
  await prisma.$transaction(async (tx) => {
    await tx.retailLink.update({
      where: { restaurantId },
      data: {
        remoteVersion: report.data.version,
        remoteStatus: report.data.status,
        aiUsageMonth: report.data.aiUsageMonth.month,
        aiUsageHalfUnits: report.data.aiUsageMonth.units,
        reconciledAt: now,
      },
    });
    // Retails was restored from a backup older than what it accepted: send the current snapshot again, at a new version.
    // Not when a delivery is already queued (a drift bump above, or a pending change): that row's version is above what
    // Retails accepted, so above what it has now, and Retails applies it; another bump would only add a version.
    // Retails is ahead of Studio (Studio's database was restored from an older backup): it would ignore every snapshot up
    // to its version, so Studio's version jumps above it and the current snapshot is queued.
    const { stateVersion } = await tx.retailLink.findUniqueOrThrow({ where: { restaurantId }, select: { stateVersion: true } });
    if (report.data.version > stateVersion) {
      ahead = true;
      await jumpRetailVersion(tx, restaurantId, report.data.version);
    } else if (behind && !queued) await bumpRetailState(tx, restaurantId);
  });
  return ahead || behind || checked.drift ? 'drift' : 'same';
}

/** One run: the links never reconciled or not in the last 24 hours, oldest first, at most `limit`. */
export async function runReconcile(
  prisma: PrismaClient,
  client: RetailClient,
  now: Date,
  limit = RECONCILE_LIMIT,
): Promise<{ checked: number; drifted: number; errors: number }> {
  const due = await prisma.retailLink.findMany({
    where: { OR: [{ reconciledAt: null }, { reconciledAt: { lt: new Date(now.getTime() - RECONCILE_EVERY_MS) } }] },
    orderBy: [{ reconciledAt: { sort: 'asc', nulls: 'first' } }, { restaurantId: 'asc' }],
    take: limit,
    select: { restaurantId: true },
  });
  const counts = { checked: 0, drifted: 0, errors: 0 };
  for (const { restaurantId } of due) {
    counts.checked += 1;
    // One shop that throws (its write refused) must not stop the rest; it goes to the back of the queue when it can.
    let outcome: Reconciled;
    try {
      outcome = await reconcileOne(prisma, client, restaurantId, now);
    } catch (error) {
      log(restaurantId, error instanceof Error ? 'INTERNAL' : 'UNKNOWN');
      await prisma.retailLink.updateMany({ where: { restaurantId }, data: { reconciledAt: now } }).catch(() => undefined);
      outcome = 'error';
    }
    if (outcome === 'drift' || outcome === 'reprovision') counts.drifted += 1;
    else if (outcome === 'error') counts.errors += 1;
  }
  return counts;
}
