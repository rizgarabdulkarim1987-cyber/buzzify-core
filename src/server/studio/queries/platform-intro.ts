import { z } from 'zod';
import { defineQuery } from '@/server/studio/framework/query';
import { thumbsOf } from '@/server/studio/services/intro';

/** The platform's intro background and every platform advert, for the Super Admin's page. */
export const platformIntro = defineQuery({
  name: 'platform.intro',
  permission: 'platform.settings',
  input: z.object({}),
  target: () => ({ kind: 'platform' }) as const,
  run: async (ctx) => {
    const [defaults, adverts, restaurants, menus] = await Promise.all([
      ctx.db.platformIntro.findUnique({ where: { id: 'singleton' } }),
      ctx.db.platformAdvert.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
      ctx.db.restaurant.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      ctx.db.menu.findMany({ orderBy: [{ restaurantId: 'asc' }, { name: 'asc' }], select: { id: true, name: true, restaurantId: true, slug: true } }),
    ]);
    // The picker: every restaurant, and every menu with the restaurant it belongs to.
    const thumbs = await thumbsOf(ctx.db, [defaults?.backgroundAssetId, ...adverts.map((advert) => advert.imageAssetId)]);
    return { backgroundAssetId: defaults?.backgroundAssetId ?? null, adverts, restaurants, menus, thumbs };
  },
});
