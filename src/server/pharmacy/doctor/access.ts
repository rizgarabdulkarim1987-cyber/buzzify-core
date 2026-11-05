import { canPh } from '@/server/domain/pharmacy/permissions';
import type { PhActor } from '../actor';

/**
 * True since the /pharmacy/doctor page, the Home card and the Sell panel exist (plan Task 8). Set it back to false to hide the
 * Doctor's nav item, slots and page from everyone without touching the access rule (the action keeps its own check).
 */
export const DOCTOR_UI_READY = true;

export type DoctorAccessReason = 'OK' | 'NO_ACTOR' | 'NOT_IN_PLAN' | 'NO_PERMISSION' | 'SWITCH_OFF';

/**
 * Who may use the AI Doctor: the plan must carry an AI budget above 0, the role must grant `ai.use`, and the person must
 * be the OWNER (always, including through the Studio membership, which has no staff row) or have the staff switch on.
 * A support actor has no role and never qualifies.
 */
export function doctorAccess(input: { actor: PhActor | null; aiBudgetMinor: number }): { allowed: boolean; reason: DoctorAccessReason } {
  const { actor, aiBudgetMinor } = input;
  if (!actor) return { allowed: false, reason: 'NO_ACTOR' };
  if (!(aiBudgetMinor > 0)) return { allowed: false, reason: 'NOT_IN_PLAN' };
  if (actor.role === null || !canPh(actor.role, 'ai.use')) return { allowed: false, reason: 'NO_PERMISSION' };
  if (actor.role === 'OWNER' || actor.aiDoctor) return { allowed: true, reason: 'OK' };
  return { allowed: false, reason: 'SWITCH_OFF' };
}

/** Whether the nav item and slots show: the access rule, and the UI being built. */
export function doctorEnabledFor(input: { actor: PhActor | null; aiBudgetMinor: number }): boolean {
  return DOCTOR_UI_READY && doctorAccess(input).allowed;
}
