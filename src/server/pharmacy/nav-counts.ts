import { currentPhPlaceInput } from '@/server/pharmacy/actor';
import { navCounts } from '@/server/pharmacy/queries/nav-counts';
import { query } from '@/server/studio/framework/invoke';

/** The counters for the place the person chose (a page's navigation); `branchId` null means every branch they may see. */
export async function getNavCounts(input: { branchId: string | null; now: Date }): Promise<{ lowStock: number; expiring: number }> {
  const place = await currentPhPlaceInput();
  if (!place) return { lowStock: 0, expiring: 0 };
  return query(navCounts, { restaurantId: place.restaurantId, ...(input.branchId ? { branchId: input.branchId } : {}), now: input.now });
}
