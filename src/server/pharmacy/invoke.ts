import type { ActionDef } from '@/server/studio/framework/action';
import { invoke, invokeQuery } from '@/server/studio/framework/invoke';
import type { QueryDef } from '@/server/studio/framework/query';
import { failure, type ActionResult } from '@/server/studio/framework/result';
import { getPhAccess } from './actor';
import { withPlace } from './place-input';

/**
 * How the pharmacy's Server Actions (src/app/pharmacy/_actions) and its file routes run a definition: the restaurant and
 * branch come from the place the person chose (`currentPhPlaceInput`: the signed cookie, checked against the database
 * on this request), never from the browser. Without a valid place the call is refused before the framework runs.
 * tests/studio/enforcement.test.ts holds the actions folder to these two forwards.
 *
 * The person's identity in that place and the pharmacy's gate were just resolved for this request (`getPhAccess`, cached
 * for it). They go to the framework with the call, so it does not read them from the database a second time; it uses them
 * only for the same person and pharmacy and still runs every check (gate, permission, branch) on them. Another request
 * calls `getPhAccess` again.
 */
export async function invokePh<I, O>(def: ActionDef<I, O>, raw: unknown): Promise<ActionResult<O>> {
  const known = await placeOf();
  if (!known) return failure('FORBIDDEN');
  return invoke(def, withPlace(raw, known.place), { phAccess: known.phAccess });
}

export async function invokePhQuery<I, O>(def: QueryDef<I, O>, raw: unknown): Promise<ActionResult<O>> {
  const known = await placeOf();
  if (!known) return failure('FORBIDDEN');
  return invokeQuery(def, withPlace(raw, known.place), { phAccess: known.phAccess });
}

/** The validated place and what was resolved for it in this request; null when the person has no valid place now. */
async function placeOf() {
  const { actor, gate, place } = await getPhAccess();
  if (!actor || !gate || !place) return null;
  return {
    place: place.branchId === null ? { restaurantId: place.restaurantId } : { restaurantId: place.restaurantId, branchId: place.branchId },
    phAccess: { actor, gate },
  };
}
