import type { PrismaClient } from '@/generated/prisma/client';
import { globalDb } from '@/server/data/tenant-db';
import { lifecycleSteps, type LifecycleView, type SubscriptionStatus } from '@/server/domain/billing/subscriptions';

type SweepRow = LifecycleView & { id: string; version: number };

/**
 * Applies the lifecycle to one subscription in its own transaction and returns where it ended, or null when nothing
 * was due or the row moved on since it was read (an owner's payment or change wins; the next run looks again).
 */
export async function sweepOne(prisma: PrismaClient, sub: SweepRow, now: Date): Promise<SubscriptionStatus | null> {
  const steps = lifecycleSteps(sub, now);
  if (steps.length === 0) return null;
  const to = steps.at(-1)!.to;
  return globalDb(prisma).$transaction(async (tx) => {
    const { count } = await tx.subscription.updateMany({ where: { id: sub.id, version: sub.version }, data: { status: to, version: { increment: 1 } } });
    if (count === 0) return null;
    await tx.subscriptionEvent.createMany({
      data: steps.map((step) => ({ subscriptionId: sub.id, type: step.type, fromStatus: step.from, toStatus: step.to, actorId: null, occurredAt: now })),
    });
    return to;
  });
}

/**
 * The scheduled lifecycle job: every TRIAL, ACTIVE or GRACE subscription whose date has passed moves to GRACE or
 * EXPIRED, one transaction each, with a system event per step. It writes no audit rows: the events are its record.
 * A row lost to a concurrent change is skipped; a row that throws is counted in `failed` and the rest go on.
 */
export async function sweepSubscriptions(prisma: PrismaClient, now: Date): Promise<{ graced: number; expired: number; failed: number }> {
  const candidates = await globalDb(prisma).subscription.findMany({
    where: {
      OR: [
        { status: 'TRIAL', trialEndsAt: { lt: now } },
        { status: { in: ['ACTIVE', 'GRACE'] }, currentPeriodEnd: { lte: now } },
      ],
    },
    select: { id: true, version: true, status: true, trialEndsAt: true, currentPeriodEnd: true, graceDays: true },
    orderBy: { currentPeriodEnd: 'asc' },
  });
  let graced = 0;
  let expired = 0;
  let failed = 0;
  for (const sub of candidates) {
    // One bad row must not stop the rest: it is counted, logged by id and error name only, and the next run looks again.
    try {
      const to = await sweepOne(prisma, sub, now);
      if (to === 'GRACE') graced += 1;
      else if (to === 'EXPIRED') expired += 1;
    } catch (error) {
      failed += 1;
      console.error(`Subscription sweep failed for ${sub.id}: ${error instanceof Error ? error.name : 'unknown error'}`);
    }
  }
  return { graced, expired, failed };
}
