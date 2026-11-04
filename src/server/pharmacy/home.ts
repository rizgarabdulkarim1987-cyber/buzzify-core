import type { HomeFigures, HomePeriod } from '@/server/domain/pharmacy/home';
import { currentPhPlaceInput } from '@/server/pharmacy/actor';
import { homeFigures } from '@/server/pharmacy/queries/home';
import { query } from '@/server/studio/framework/invoke';

/** The home dashboard's figures for the place the person chose; `branchId` null means every branch they may see. Null with no place. */
export async function getHomeFigures(input: { branchId: string | null; period: HomePeriod; now: Date }): Promise<HomeFigures | null> {
  const place = await currentPhPlaceInput();
  if (!place) return null;
  return query(homeFigures, { restaurantId: place.restaurantId, ...(input.branchId ? { branchId: input.branchId } : {}), period: input.period, now: input.now });
}
