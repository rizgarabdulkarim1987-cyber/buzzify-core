export type SubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'GRACE' | 'EXPIRED' | 'CANCELLED';

export type LifecycleView = {
  status: SubscriptionStatus;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date;
  graceDays: number;
};

export type DueTransition = null | { to: 'GRACE' | 'EXPIRED'; event: 'ENTERED_GRACE' | 'EXPIRED' };

const DAY_MS = 86_400_000;

export function graceEndsAt(sub: LifecycleView): Date {
  return new Date(sub.currentPeriodEnd.getTime() + sub.graceDays * DAY_MS);
}

/** The transition a subscription is due for at `now`, or null. A trial has no grace. */
export function dueTransition(sub: LifecycleView, now: Date): DueTransition {
  switch (sub.status) {
    case 'TRIAL':
      return sub.trialEndsAt !== null && now > sub.trialEndsAt ? { to: 'EXPIRED', event: 'EXPIRED' } : null;
    case 'ACTIVE':
      return now > sub.currentPeriodEnd ? { to: 'GRACE', event: 'ENTERED_GRACE' } : null;
    case 'GRACE':
      return now >= graceEndsAt(sub) ? { to: 'EXPIRED', event: 'EXPIRED' } : null;
    default:
      return null;
  }
}

export function isLive(status: SubscriptionStatus): boolean {
  return status === 'TRIAL' || status === 'ACTIVE' || status === 'GRACE';
}

/** The status as of "now": dueTransition applied repeatedly, so a missed sweep jumps ACTIVE straight to EXPIRED. */
export function effectiveStatus(sub: LifecycleView, now: Date): SubscriptionStatus {
  let current = sub;
  for (let step = 0; step < 3; step += 1) {
    const due = dueTransition(current, now);
    if (!due) break;
    current = { ...current, status: due.to };
  }
  return current.status;
}
