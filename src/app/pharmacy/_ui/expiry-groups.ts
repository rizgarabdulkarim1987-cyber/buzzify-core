/** The Expiry screen's urgency groups (pharmacy redesign, task 9). Days come from `urgencyDays`, the number behind the alert band. */

export const URGENCY_GROUPS = ['expired', 'd30', 'd60', 'd90'] as const;
export type UrgencyGroup = (typeof URGENCY_GROUPS)[number];

/** The group of a number of days: below 0 expired, 0 to 30, 31 to 60, 61 to 90; null beyond 90. */
export function urgencyGroup(daysLeft: number): UrgencyGroup | null {
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= 30) return 'd30';
  if (daysLeft <= 60) return 'd60';
  if (daysLeft <= 90) return 'd90';
  return null;
}

/** Batches in their groups, each soonest first (a stable sort, so equal days keep their order); over 90 days left out. */
export function groupByUrgency<T extends { daysLeft: number }>(batches: T[]): { expired: T[]; d30: T[]; d60: T[]; d90: T[] } {
  const groups: Record<UrgencyGroup, T[]> = { expired: [], d30: [], d60: [], d90: [] };
  for (const batch of [...batches].sort((a, b) => a.daysLeft - b.daysLeft)) {
    const group = urgencyGroup(batch.daysLeft);
    if (group) groups[group].push(batch);
  }
  return groups;
}

export type UrgencyTone = 'red' | 'amber' | 'blue';

/** One colour per urgency, the same on Home and on the Expiry screen: red to 30 days (and expired), amber to 60, blue beyond. */
export function urgencyTone(daysLeft: number): UrgencyTone {
  if (daysLeft <= 30) return 'red';
  if (daysLeft <= 60) return 'amber';
  return 'blue';
}
