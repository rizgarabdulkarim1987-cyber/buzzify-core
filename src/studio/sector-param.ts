import type { BusinessSector } from '@/server/domain/restaurant-profile';

/**
 * The sector the new business form opens on, from the untrusted `sector` parameter of /studio/restaurants/new: the
 * Pharmacy page's "New pharmacy" link names PHARMACY; anything else opens on Food, as the form always did.
 */
export function initialSectorOf(params: Record<string, string | string[] | undefined>): BusinessSector {
  return params.sector === 'PHARMACY' ? 'PHARMACY' : 'FOOD';
}
