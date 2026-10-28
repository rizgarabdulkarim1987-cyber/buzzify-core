import { z } from 'zod';
import type { Locale } from '@/lib/locale';
import type { AssetVariants } from '@/server/media/process';
import { loadAssets } from '@/server/media/resolve';
import { getStorage } from '@/server/storage/storage';
import { defineQuery } from '@/server/studio/framework/query';
import { StudioError } from '@/server/studio/framework/result';
import type { LocaleTexts } from '@/server/studio/services/about';
import { thumbKey } from '@/server/studio/services/media';
import { hasPhoto, type WheelStudioView } from '@/server/studio/services/wheel';

function nameOf(row: { slug: string; translations: unknown }, locale: string): string {
  const map = (row.translations ?? {}) as Record<string, { name?: unknown } | undefined>;
  for (const code of [locale, 'en', 'ar', 'ckb']) {
    const name = map[code]?.name;
    if (typeof name === 'string' && name.trim() !== '') return name;
  }
  return row.slug;
}

/** The first library photo of a dish's stored media, as an asset id (a not-yet-resolved reference or an already resolved image). */
function firstAssetId(media: unknown): string | null {
  if (!Array.isArray(media)) return null;
  for (const item of media as { kind?: unknown; assetId?: unknown }[]) {
    if ((item?.kind === 'asset' || item?.kind === 'image') && typeof item.assetId === 'string') return item.assetId;
  }
  return null;
}

/** The address of a dish's first resolved image, when its media holds one with no library asset behind it. */
function firstImageUrl(media: unknown): string | null {
  if (!Array.isArray(media)) return null;
  for (const item of media as { kind?: unknown; url?: unknown }[]) {
    if (item?.kind === 'image' && typeof item.url === 'string' && item.url.startsWith('/')) return item.url;
  }
  return null;
}

/** A menu's wheel for the Studio: the saved settings and slices, and the dishes with a photo it could use. */
export const menuWheel = defineQuery({
  name: 'menus.wheel',
  permission: 'content.edit',
  input: z.object({ menuId: z.string().min(1).max(100) }),
  target: (i) => ({ kind: 'menu', menuId: i.menuId }) as const,
  run: async (ctx, { menuId }): Promise<WheelStudioView> => {
    const menu = await ctx.db.menu.findUnique({ where: { id: menuId }, select: { slug: true, wheelEnabled: true, locales: true, defaultLocale: true, timezone: true } });
    if (!menu) throw new StudioError('NOT_FOUND');
    const restaurantId = ctx.restaurantId;
    if (restaurantId === null) throw new Error('A menu query ran without a menu');
    const [wheel, slices, products] = await Promise.all([
      ctx.db.menuWheel.findUnique({ where: { menuId } }),
      ctx.db.wheelSlice.findMany({ where: { menuId }, orderBy: { sortOrder: 'asc' } }),
      ctx.db.product.findMany({ where: { menuId }, orderBy: [{ sortOrder: 'asc' }], select: { id: true, slug: true, translations: true, media: true } }),
    ]);
    const withPhoto = products.filter((row) => hasPhoto(row.media));
    const assets = await loadAssets(ctx.db, restaurantId, withPhoto.map((row) => firstAssetId(row.media)).filter((id): id is string => !!id), ['IMAGE']);
    const storage = getStorage();
    return {
      slug: menu.slug,
      enabled: menu.wheelEnabled,
      saved: wheel !== null,
      defaultLocale: menu.defaultLocale as Locale,
      locales: menu.locales as Locale[],
      timezone: menu.timezone,
      spinsPerDay: wheel?.spinsPerDay ?? 1,
      startsAt: wheel?.startsAt?.toISOString() ?? null,
      endsAt: wheel?.endsAt?.toISOString() ?? null,
      title: (wheel?.title ?? {}) as LocaleTexts,
      slices: slices.map((slice) => ({ productId: slice.productId, label: slice.label as LocaleTexts, weight: slice.weight })),
      candidates: withPhoto.map((row) => {
        const asset = assets.get(firstAssetId(row.media) ?? '');
        // A photo from the library has a thumbnail; one already resolved into the menu's media (no asset kept) shows its own address.
        const thumb = asset ? storage.publicUrl(thumbKey(asset.kind, asset.variants as unknown as AssetVariants)) : firstImageUrl(row.media);
        return { id: row.id, name: nameOf(row, menu.defaultLocale), thumb };
      }),
    };
  },
});
