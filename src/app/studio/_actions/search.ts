'use server';

import { invokeQuery } from '@/server/studio/framework/invoke';
import * as search from '@/server/studio/queries/search';

// Jump to (Ctrl+K) calls this as the person types.
export async function jump(input: unknown) {
  return invokeQuery(search.jump, input);
}

// The pickers of filters and forms: a restaurant, a menu or a person chosen by typing part of the name.
export async function searchRestaurants(input: unknown) {
  return invokeQuery(search.searchRestaurants, input);
}

export async function searchMenus(input: unknown) {
  return invokeQuery(search.searchMenus, input);
}

export async function searchPeople(input: unknown) {
  return invokeQuery(search.searchPeople, input);
}
