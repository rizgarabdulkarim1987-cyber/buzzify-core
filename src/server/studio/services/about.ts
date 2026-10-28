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
