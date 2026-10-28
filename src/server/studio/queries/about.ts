import { z } from 'zod';
import { defineQuery } from '@/server/studio/framework/query';
import { StudioError } from '@/server/studio/framework/result';
import { loadAssets } from '@/server/media/resolve';
import type { AssetVariants } from '@/server/media/process';
import { thumbKey } from '@/server/studio/services/media';
import { getStorage } from '@/server/storage/storage';
import type { Locale } from '@/lib/locale';
import type { AboutStudioView, LocaleTexts } from '@/server/studio/services/about';
import type { StoryByLocale } from '@/server/domain/about';

function nameOf(row: { slug: string; translations: unknown }, locale: string): string {
  const map = (row.translations ?? {}) as Record<string, { name?: unknown } | undefined>;
  for (const code of [locale, 'en', 'ar', 'ckb']) {
    const name = map[code]?.name;
    if (typeof name === 'string' && name.trim() !== '') return name;
  }
  return row.slug;
}

/** A menu's About page settings and offers for the Studio (all offers, expired ones included, so the restaurant can renew them). */
export const menuAbout = defineQuery({
  name: 'menus.about',
  permission: 'content.edit',
  input: z.object({ menuId: z.string().min(1).max(100) }),
  target: (i) => ({ kind: 'menu', menuId: i.menuId }) as const,
  run: async (ctx, { menuId }): Promise<AboutStudioView> => {
    const menu = await ctx.db.menu.findUnique({ where: { id: menuId }, select: { slug: true, aboutEnabled: true, locales: true, defaultLocale: true, timezone: true } });
    if (!menu) throw new StudioError('NOT_FOUND');
    const restaurantId = ctx.restaurantId;
    if (restaurantId === null) throw new Error('A menu query ran without a menu');
    const [about, offers, products, categories] = await Promise.all([
      ctx.db.menuAbout.findUnique({ where: { menuId } }),
      ctx.db.aboutOffer.findMany({ where: { menuId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
      ctx.db.product.findMany({ where: { menuId }, orderBy: [{ sortOrder: 'asc' }], select: { id: true, slug: true, translations: true } }),
      ctx.db.category.findMany({ where: { menuId }, orderBy: [{ sortOrder: 'asc' }], select: { id: true, slug: true, translations: true } }),
    ]);
    const ids = [about?.coverAssetId, ...(about?.galleryAssetIds ?? []), ...offers.map((offer) => offer.imageAssetId)].filter((id): id is string => !!id);
    const assets = await loadAssets(ctx.db, restaurantId, ids, ['IMAGE']);
    const storage = getStorage();
    // What the form shows for each picture the page names; a picture that is gone has no thumbnail and shows as a gap.
    const thumbs: Record<string, string> = {};
    for (const [id, asset] of assets) thumbs[id] = storage.publicUrl(thumbKey(asset.kind, asset.variants as unknown as AssetVariants));
    return {
      slug: menu.slug,
      restaurantId,
      thumbs,
      // What an offer may link to, named in the menu's default language.
      targets: {
        products: products.map((row) => ({ id: row.id, name: nameOf(row, menu.defaultLocale) })),
        categories: categories.map((row) => ({ id: row.id, name: nameOf(row, menu.defaultLocale) })),
      },
      enabled: menu.aboutEnabled,
      locales: menu.locales as Locale[],
      defaultLocale: menu.defaultLocale as Locale,
      timezone: menu.timezone,
      about: {
        titles: (about?.titles ?? {}) as LocaleTexts,
        coverAssetId: about?.coverAssetId ?? null,
        story: (about?.story ?? {}) as StoryByLocale,
        galleryAssetIds: about?.galleryAssetIds ?? [],
        showHours: about?.showHours ?? true,
        showContact: about?.showContact ?? true,
      },
      offers: offers.map((offer) => ({
        id: offer.id,
        titles: offer.titles as LocaleTexts,
        bodies: offer.bodies as LocaleTexts,
        label: offer.label as LocaleTexts,
        imageAssetId: offer.imageAssetId,
        startsAt: offer.startsAt?.toISOString() ?? null,
        endsAt: offer.endsAt?.toISOString() ?? null,
        active: offer.active,
        ended: offer.endsAt !== null && offer.endsAt.getTime() < Date.now(),
        productId: offer.productId,
        categoryId: offer.categoryId,
      })),
    };
  },
});
