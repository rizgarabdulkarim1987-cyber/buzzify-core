import type { Metadata } from 'next';
import { cache } from 'react';
import { query } from '@/server/studio/framework/invoke';
import { getRestaurant } from '@/server/studio/queries/restaurants';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';

/**
 * The restaurant of the page's address, read once per request: its layout (the header and the tabs) and its page share
 * the one answer. Something that does not exist, or that the person may not see, is the Studio's not-found page.
 */
export const loadRestaurant = cache((restaurantId: string) => query(getRestaurant, { restaurantId }));

/** The tab's title for the browser: the tab and the restaurant, so several open tabs can be told apart. */
export async function tabMetadata(restaurantId: string, tab: 'branches' | 'menus' | 'media' | 'people' | 'activity'): Promise<Metadata> {
  const [t, restaurant] = [getStudioTranslator(await requestStudioLocale()), await loadRestaurant(restaurantId)];
  return { title: `${t(`restaurants.tabs.${tab}`)} · ${restaurant.name}` };
}
