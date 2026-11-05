import { getPhAccess } from '@/server/pharmacy/actor';
import { navCounts } from '@/server/pharmacy/queries/nav-counts';
import { query } from '@/server/studio/framework/invoke';

/**
 * The counters for the place the person chose (a page's navigation); `branchId` null means every branch they may see.
 * A support actor (or anyone without a pharmacy role) may not read stock levels through the counters query, which would
 * turn its refusal into a 404 on every screen; their navigation simply shows no counters.
 */
export async function getNavCounts(input: { branchId: string | null; now: Date }): Promise<{ lowStock: number; expiring: number }> {
  const none = { lowStock: 0, expiring: 0 };
  const { actor, place } = await getPhAccess();
  if (!place || !actor || actor.role === null || actor.support !== null) return none;
  return query(navCounts, { restaurantId: place.restaurantId, ...(input.branchId ? { branchId: input.branchId } : {}), now: input.now });
}
