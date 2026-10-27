import { notFound } from 'next/navigation';
import type { Writable } from '@/app/pharmacy/_ui/WriteBlocked';
import { canPh, type PhPermission } from '@/server/domain/pharmacy/permissions';
import { currentPhPlaceInput, getPhAccess, type PhActor, type PhGate } from '@/server/pharmacy/actor';
import { mayViewCost } from '@/server/pharmacy/products';

export interface CatalogAccess {
  actor: PhActor;
  gate: PhGate | null;
  /** The `ph` input for where the person works, from the validated place cookie: spread into every query. */
  placeInput: { restaurantId: string; branchId?: string };
  place: { branchId: string | null; branchName: string | null };
  showCost: boolean;
  /** Whether the person may use `permission` here now, and if not, why (support, a read-only pharmacy, their role). */
  writable: (permission: PhPermission) => Writable;
}

/**
 * Who is on a catalog screen and what they may do there, for the page to decide which controls to draw. It never
 * guards data: every read and write still goes through the framework's checks. The layout has already sent away anyone
 * without a place, so a missing one here is a 404.
 */
export async function catalogAccess(): Promise<CatalogAccess> {
  const [{ actor, gate, place }, placeInput] = await Promise.all([getPhAccess(), currentPhPlaceInput()]);
  if (!actor || !place || !placeInput) notFound();
  const writable = (permission: PhPermission): Writable => {
    if (actor.role === null) return { ok: false, reason: 'support' };
    if (gate?.state === 'readOnly') return { ok: false, reason: 'readOnly', until: gate.until.toISOString() };
    if (gate?.state !== 'open' || !canPh(actor.role, permission)) return { ok: false, reason: 'role' };
    return { ok: true };
  };
  return {
    actor,
    gate,
    placeInput,
    place: { branchId: place.branchId, branchName: place.branchName },
    showCost: mayViewCost(actor),
    writable,
  };
}

/** True when the role may use `permission` at all (whatever the pharmacy's state): whether a screen exists for them. */
export function roleMay(actor: PhActor, permission: PhPermission): boolean {
  return actor.role !== null && canPh(actor.role, permission);
}
