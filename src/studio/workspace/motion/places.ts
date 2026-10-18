import type { Translate } from '@/lib/i18n';
import type { Locale } from '@/lib/locale';
import type { MotionParams } from '@/motion/types';
import { guestParams, type MotionPlace, type MotionTexts } from '@/server/domain/menu-motions';
import type { MotionPlaceView, MotionPlacesView } from '@/server/studio/services/menu-motions';

/** What the Motion tab and its editor share: a place's name, address, shape, and its motion as guests would draw it. */

export function placeName(t: Translate, place: Pick<MotionPlaceView, 'place' | 'name'>): string {
  return place.place === 'category' ? t('menuMotions.place.category', { name: place.name }) : t(`menuMotions.place.${place.place}`);
}

/** The editor's address segment for a place: `hero`, `signature`, or `category-<categoryId>`. */
export function placeSegment(place: Pick<MotionPlaceView, 'place' | 'categoryId'>): string {
  return place.place === 'category' ? `category-${place.categoryId}` : place.place;
}

export function placeBySegment(view: MotionPlacesView, segment: string): MotionPlaceView | undefined {
  return view.places.find((place) => placeSegment(place) === segment);
}

/** Each place's shape on the guest menu (src/ui/menu/MotionSlot.tsx). */
export const PLACE_ASPECT: Record<MotionPlace, string> = {
  hero: 'aspect-[2/1]',
  signature: 'aspect-[5/4]',
  category: 'aspect-[3/1]',
};

/** The guest menu's fade at the band's edges; the signature's stage masks its own. */
export const PLACE_FADE: Record<MotionPlace, string> = {
  hero: '[mask-image:linear-gradient(to_bottom,transparent,#000_18%,#000_62%,transparent)]',
  signature: '[mask-image:linear-gradient(to_bottom,transparent,#000_16%,#000_70%,transparent)]',
  category: '[mask-image:linear-gradient(to_bottom,transparent,#000_18%,#000_62%,transparent)]',
};

/** The motion's params as a guest reading the Studio's language would get them (the menu's default one if it lacks it). */
export function previewParams(
  view: Pick<MotionPlacesView, 'locales' | 'defaultLocale' | 'logoText'>,
  locale: Locale,
  motion: { motionId: string; params: MotionParams; texts: MotionTexts },
): MotionParams {
  const reading = view.locales.includes(locale) ? locale : view.defaultLocale;
  return guestParams({ place: 'hero', ...motion }, reading, view.defaultLocale, view.logoText);
}
