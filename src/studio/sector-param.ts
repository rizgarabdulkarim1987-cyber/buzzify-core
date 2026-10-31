import type { BusinessSector } from '@/server/domain/restaurant-profile';

/**
 * The sector the new business form opens on, from the untrusted `sector` parameter of /studio/restaurants/new: the
 * Pharmacy page's "New pharmacy" link names PHARMACY and a retail link names RETAIL; anything else opens on Food, as the form always did.
 */
export function initialSectorOf(params: Record<string, string | string[] | undefined>): BusinessSector {
  return params.sector === 'PHARMACY' || params.sector === 'RETAIL' ? params.sector : 'FOOD';
}
