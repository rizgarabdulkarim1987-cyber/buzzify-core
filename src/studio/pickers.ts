import { searchMenus, searchPeople, searchRestaurants } from '@/app/studio/_actions/search';
import type { PickerOption } from '@/studio/ui/Picker';

/**
 * What the Studio's pickers search with: each asks the server for a few matches of the typed text and turns them into
 * options. They are plain functions, so a picker given one does not search again for a new function on every render. A
 * refusal throws, which the picker shows as "not available".
 */

export async function findRestaurantOptions(q: string): Promise<PickerOption[]> {
  const result = await searchRestaurants({ q });
  if (!result.ok) throw new Error(result.error.code);
  return result.data.rows.map((restaurant) => ({
    value: restaurant.id,
    label: restaurant.name,
    detail: [restaurant.clientId, restaurant.city].filter(Boolean).join(' · '),
  }));
}

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
