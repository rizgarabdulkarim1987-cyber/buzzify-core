import { z } from 'zod';
import type { PrismaClient } from '@/generated/prisma/client';
import type { RetailAnswer, RetailClient } from '@/server/retail/client';
import { RetailConfigError } from '@/server/retail/config';
import { bumpRetailState, ensureRetailVersion } from '@/server/retail/outbox';
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
 * What Retails reports (its version, status and this month's AI use) is stored for display. A failed read changes none
 * of that, and the shop is picked again on the next run. Dates are JavaScript dates, never SQL's now().
 */

/** Per run (hourly): every shop is checked about once a day, well under Retails' 120 calls a minute. */
export const RECONCILE_LIMIT = 50;
export const RECONCILE_EVERY_MS = 24 * 3_600_000;

export type Reconciled = 'same' | 'drift' | 'reprovision' | 'error';

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
  let checked: { drift: boolean; known: boolean; acceptedVersion: number };
  try {
    checked = await prisma.$transaction(async (tx) => {
      // A ready shop still at version 0 is queued at version 1 (its readiness came without a bump).
      const before = await tx.retailLink.findUnique({ where: { restaurantId }, select: { stateVersion: true } });
      if (!before) throw new NotRetailError(restaurantId);
      const version = await ensureRetailVersion(tx, restaurantId);
      const link = await tx.retailLink.findUniqueOrThrow({
        where: { restaurantId },
        select: { sentHash: true, acceptedVersion: true, retailBusinessId: true, provisionedAt: true },
      });
      const known = link.retailBusinessId !== null || link.provisionedAt !== null;
      let drift = before.stateVersion === 0 && (version ?? 0) > 0;
      const built = await buildRetailState(tx, restaurantId);
      if (!drift && built.ready && built.hash !== link.sentHash) {
        // A delivery already queued builds the snapshot fresh when it goes: nothing to add.
        const queued = await tx.retailOutbox.findUnique({ where: { restaurantId }, select: { failedAt: true } });
        if (!queued || queued.failedAt !== null) await bumpRetailState(tx, restaurantId);
        drift = true;
      }
      if (!known) await tx.retailLink.update({ where: { restaurantId }, data: { reconciledAt: now } });
      return { drift, known, acceptedVersion: link.acceptedVersion };
    });
  } catch (error) {
    log(restaurantId, error instanceof NotRetailError ? 'NOT_RETAIL' : 'INTERNAL');
    return 'error';
  }
  // Never provisioned: Retails has nothing to report yet.
  if (!checked.known) return checked.drift ? 'drift' : 'same';

  const answer = await read(client, restaurantId);
  if (answer.kind === 'notFound') {
    await prisma.$transaction(async (tx) => {
      await tx.retailLink.update({ where: { restaurantId }, data: { retailBusinessId: null, reconciledAt: now } });
      await bumpRetailState(tx, restaurantId);
    });
    return 'reprovision';
  }
  if (answer.kind !== 'ok') {
    log(restaurantId, answer.code);
    return 'error';
  }
  const report = reportSchema.safeParse(answer.body);
  if (!report.success) {
    log(restaurantId, 'BAD_RESPONSE');
    return 'error';
  }
  const behind = report.data.version < checked.acceptedVersion;
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
    if (behind && !checked.drift) await bumpRetailState(tx, restaurantId);
  });
  return behind || checked.drift ? 'drift' : 'same';
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
    // One shop that throws (its write refused) must not stop the rest: it is picked again on the next run.
    let outcome: Reconciled;
    try {
      outcome = await reconcileOne(prisma, client, restaurantId, now);
    } catch (error) {
      log(restaurantId, error instanceof Error ? 'INTERNAL' : 'UNKNOWN');
      outcome = 'error';
    }
    if (outcome === 'drift' || outcome === 'reprovision') counts.drifted += 1;
    else if (outcome === 'error') counts.errors += 1;
  }
  return counts;
}
