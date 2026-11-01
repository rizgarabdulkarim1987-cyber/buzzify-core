import { searchMenus, searchPeople, searchRestaurants } from '@/app/studio/_actions/search';
import type { PickerOption } from '@/studio/ui/Picker';

/**
 * What the Studio's pickers search with: each asks the server for a few matches of the typed text and turns them into
 * options. They are plain functions, so a picker given one does not search again for a new function on every render. A
 * refusal throws, which the picker shows as "not available".
 */

type PickerSpace = 'food' | 'pharmacy' | 'retail' | 'platform';

const restaurantFinder =
  (space?: 'food' | 'pharmacy' | 'retail') =>
  async (q: string): Promise<PickerOption[]> => {
    const result = await searchRestaurants({ q, ...(space ? { space } : {}) });
    if (!result.ok) throw new Error(result.error.code);
    return result.data.rows.map((restaurant) => ({
      value: restaurant.id,
      label: restaurant.name,
      detail: [restaurant.clientId, restaurant.city].filter(Boolean).join(' · '),
    }));
  };

export const findRestaurantOptions = restaurantFinder();

/** The same search kept to one space, so a Super Admin working in one project never picks a business of the other. */
export const findRestaurantOptionsIn: Record<PickerSpace, (q: string) => Promise<PickerOption[]>> = {
  food: restaurantFinder('food'),
  pharmacy: restaurantFinder('pharmacy'),
  retail: restaurantFinder('retail'),
  // The Platform space works on people of every project, so it finds the businesses of each.
  platform: async (q) => (await Promise.all([restaurantFinder('food')(q), restaurantFinder('pharmacy')(q), restaurantFinder('retail')(q)])).flat(),
};

export async function findMenuOptions(q: string): Promise<PickerOption[]> {
  const result = await searchMenus({ q });
  if (!result.ok) throw new Error(result.error.code);
  return result.data.rows.map((menu) => ({ value: menu.id, label: menu.name, detail: [menu.slug, menu.restaurantName].join(' · ') }));
}

export async function findPersonOptions(q: string): Promise<PickerOption[]> {
  const result = await searchPeople({ q });
  if (!result.ok) throw new Error(result.error.code);
  return result.data.rows.map((person) => ({ value: person.id, label: person.name, detail: person.email }));
}
