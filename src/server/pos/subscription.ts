import type { PrismaClient } from '@/generated/prisma/client';
import { effectiveStatus } from '@/server/domain/billing/subscriptions';

export interface CashierSubscriptionView {
  /** The status as of now: a lapsed trial or period is already grace or expired, whatever the stored row still says. */
  state: 'TRIAL' | 'ACTIVE' | 'GRACE' | 'EXPIRED' | 'CANCELLED';
  /** The end of the trial while on trial, else of the paid period. */
  until: string;
}

/** The restaurant's Cashier subscription as the settings page states it, or null when it has none. Read-only. */
export async function cashierSubscriptionOf(prisma: Pick<PrismaClient, 'subscription'>, restaurantId: string, now: Date = new Date()): Promise<CashierSubscriptionView | null> {
  const row = await prisma.subscription.findFirst({
    where: { restaurantId, applicationId: 'cashier' },
    select: { status: true, trialEndsAt: true, currentPeriodEnd: true, graceDays: true },
  });
  if (!row) return null;
  const state = effectiveStatus(row, now);
  return { state, until: (state === 'TRIAL' && row.trialEndsAt ? row.trialEndsAt : row.currentPeriodEnd).toISOString() };
}
