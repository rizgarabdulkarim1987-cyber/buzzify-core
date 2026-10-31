import { z } from 'zod';
import type { Locale } from '@/lib/locale';
import type { AssetVariants } from '@/server/media/process';
import { loadAssets } from '@/server/media/resolve';
import { getStorage } from '@/server/storage/storage';
import { defineQuery } from '@/server/studio/framework/query';
import { StudioError } from '@/server/studio/framework/result';
import { upgradeInfo } from '@/server/studio/services/plans';
import { thumbKey } from '@/server/studio/services/media';
import type { StoriesStudioView, StoryStudioRow } from '@/server/studio/services/stories-view';

function nameOf(row: { slug: string; translations: unknown }, locale: string): string {
  const map = (row.translations ?? {}) as Record<string, { name?: unknown } | undefined>;
  for (const code of [locale, 'en', 'ar', 'ckb']) {
    const name = map[code]?.name;
    if (typeof name === 'string' && name.trim() !== '') return name;
  }
  return row.slug;
}

/** A menu's stories for the Studio, ended ones included so the restaurant can run them again. */
export const menuStories = defineQuery({
  name: 'menus.stories',
  permission: 'content.edit',
  input: z.object({ menuId: z.string().min(1).max(100) }),
  target: (i) => ({ kind: 'menu', menuId: i.menuId }) as const,
  run: async (ctx, { menuId }): Promise<StoriesStudioView> => {
    const menu = await ctx.db.menu.findUnique({ where: { id: menuId }, select: { locales: true, defaultLocale: true, timezone: true } });
    if (!menu) throw new StudioError('NOT_FOUND');
    const restaurantId = ctx.restaurantId;
    if (restaurantId === null) throw new Error('A menu query ran without a menu');
    const [rows, products, upgrade] = await Promise.all([
      ctx.db.menuStory.findMany({ where: { menuId }, orderBy: { createdAt: 'desc' } }),
      ctx.db.product.findMany({ where: { menuId }, orderBy: [{ sortOrder: 'asc' }], select: { id: true, slug: true, translations: true } }),
      upgradeInfo(ctx.db, ctx),
    ]);
    const assets = await loadAssets(ctx.db, restaurantId, rows.map((row) => row.assetId), ['IMAGE']);
    const storage = getStorage();
    const now = Date.now();
    return {
      restaurantId,
      locales: menu.locales as Locale[],
      defaultLocale: menu.defaultLocale as Locale,
      timezone: menu.timezone,
      products: products.map((row) => ({ id: row.id, name: nameOf(row, menu.defaultLocale) })),
      stories: rows.map((row) => {
        const asset = assets.get(row.assetId);
        return {
          id: row.id,
          assetId: row.assetId,
          thumb: asset ? storage.publicUrl(thumbKey(asset.kind, asset.variants as unknown as AssetVariants)) : null,
          productId: row.productId,
          captions: (row.captions ?? {}) as Partial<Record<Locale, string>>,
          expiresAt: row.expiresAt.toISOString(),
          isActive: row.isActive,
          ended: row.expiresAt.getTime() <= now,
        };
      }),
      upgrade,
    };
  },
});
