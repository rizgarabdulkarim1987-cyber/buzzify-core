import { getPrisma } from '@/server/data/prisma';
import { limitsOf } from '@/server/domain/pharmacy/limits';
import type { PhActor } from '../actor';
import { doctorEnabledFor } from './access';

/** Whether the Doctor's nav item shows for this person now: the plan's AI budget is read here, so pages never touch the client. */
export async function doctorNavEnabled(actor: PhActor, now: Date = new Date()): Promise<boolean> {
  const limits = await limitsOf(getPrisma(), actor.restaurantId, now);
  return doctorEnabledFor({ actor, aiBudgetMinor: limits?.aiMonthlyBudgetMinor ?? 0 });
}
