import type { Locale } from '@/lib/locale';
import type { AnyDb, ScopedDb } from '@/server/data/tenant-db';
import { cleanStory, type StoryByLocale } from '@/server/domain/about';
import { loadAssets } from '@/server/media/resolve';
import { StudioError } from '@/server/studio/framework/result';

/** Pictures the About page may show: the restaurant's own or the shared library's, never a video. Another restaurant's and a missing one answer alike. */
export async function requireAboutImages(db: AnyDb | ScopedDb, restaurantId: string, ids: readonly string[], field: string): Promise<void> {
  const found = await loadAssets(db as AnyDb, restaurantId, ids, ['IMAGE']);
  if (ids.some((id) => !found.has(id))) throw new StudioError('NOT_FOUND', undefined, { [field]: 'Choose a picture from your library' });
}

/** The story per language, each list of blocks validated; one bad block refuses the whole save. */
export function cleanStoryByLocale(story: Partial<Record<'en' | 'ar' | 'ckb', unknown>>): StoryByLocale {
  const clean: StoryByLocale = {};
  for (const locale of ['en', 'ar', 'ckb'] as const) {
    const blocks = story[locale];
    if (blocks === undefined) continue;
    try {
      clean[locale] = cleanStory(blocks);
    } catch {
      throw new StudioError('INVALID', undefined, { story: 'The story has a block that is not allowed' });
    }
  }
  return clean;
}

/** An offer's link: a dish or a category of this menu, never both. */
export async function requireOfferTarget(db: ScopedDb | AnyDb, menuId: string, productId: string | null, categoryId: string | null): Promise<void> {
  if (productId && categoryId) throw new StudioError('INVALID', undefined, { productId: 'Choose a dish or a category, not both' });
  const scoped = db as ScopedDb;
  if (productId && !(await scoped.product.findFirst({ where: { id: productId, menuId }, select: { id: true } }))) {
    throw new StudioError('NOT_FOUND', undefined, { productId: 'Choose a dish of this menu' });
  }
  if (categoryId && !(await scoped.category.findFirst({ where: { id: categoryId, menuId }, select: { id: true } }))) {
    throw new StudioError('NOT_FOUND', undefined, { categoryId: 'Choose a category of this menu' });
  }
}

export type LocaleTexts = Partial<Record<'en' | 'ar' | 'ckb', string>>;

export interface AboutOfferRow {
  id: string;
  titles: LocaleTexts;
  bodies: LocaleTexts;
  label: LocaleTexts;
  imageAssetId: string | null;
  /** ISO instants, as stored; the form shows them as dates in the menu's time zone. */
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
  /** Its last day has passed. */
  ended: boolean;
  productId: string | null;
  categoryId: string | null;
}

/** Everything the Studio's About tab shows. */
export interface AboutStudioView {
  slug: string;
  restaurantId: string;
  /** A thumbnail for each picture the page and its offers name. */
  thumbs: Record<string, string>;
  targets: { products: { id: string; name: string }[]; categories: { id: string; name: string }[] };
  enabled: boolean;
  locales: Locale[];
  defaultLocale: Locale;
  timezone: string;
  about: { titles: LocaleTexts; coverAssetId: string | null; story: StoryByLocale; galleryAssetIds: string[]; showHours: boolean; showContact: boolean };
  offers: AboutOfferRow[];
}
