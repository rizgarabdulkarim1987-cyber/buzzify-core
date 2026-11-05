import { cache } from 'react';
import { getPrisma } from '@/server/data/prisma';
import { limitsOf } from '@/server/domain/pharmacy/limits';
import type { PhActor } from '../actor';
import { DOCTOR_UI_READY, doctorAccess, doctorEnabledFor } from './access';

/**
 * Whether the Doctor shows for this person now (nav item, Home card, Sell panel, the /pharmacy/doctor page). The plan's AI
 * budget is read only for a person the budget can decide for: someone the rule refuses whatever the plan holds (switch off, a
 * role without `ai.use`, support) costs no read. One read per request at most: the layout and the page share it (React
 * `cache`, keyed by the request's actor object from the cached `getPhAccess`).
 */
export async function doctorNavEnabled(actor: PhActor, now: Date = new Date(), db: Parameters<typeof limitsOf>[0] = getPrisma()): Promise<boolean> {
  if (!DOCTOR_UI_READY || !doctorAccess({ actor, aiBudgetMinor: 1 }).allowed) return false;
  const limits = await limitsOf(db, actor.restaurantId, now);
  return doctorEnabledFor({ actor, aiBudgetMinor: limits?.aiMonthlyBudgetMinor ?? 0 });
}

/** `doctorNavEnabled` once per request for the same actor (the layout, the page and the slots all ask). */
export const doctorEnabledThisRequest = cache((actor: PhActor): Promise<boolean> => doctorNavEnabled(actor));
