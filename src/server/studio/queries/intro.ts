import { z } from 'zod';
import { defineQuery } from '@/server/studio/framework/query';
import { StudioError } from '@/server/studio/framework/result';

/** A menu's intro settings for the Studio, with the platform's adverts that apply to its restaurant (read only: adverts belong to Buzzify). */
export const menuIntro = defineQuery({
  name: 'menus.intro',
  permission: 'content.edit',
  input: z.object({ menuId: z.string().min(1).max(100) }),
  target: (i) => ({ kind: 'menu', menuId: i.menuId }) as const,
  run: async (ctx, { menuId }) => {
    const restaurantId = ctx.restaurantId;
    if (restaurantId === null) throw new Error('A menu query ran without a menu');
    const menu = await ctx.db.menu.findUnique({ where: { id: menuId }, select: { introEnabled: true, locales: true, defaultLocale: true } });
    if (!menu) throw new StudioError('NOT_FOUND');
    const [intro, platform] = await Promise.all([
      ctx.db.menuIntro.findUnique({ where: { menuId } }),
      ctx.db.platformAdvert.findMany({ where: { OR: [{ restaurantIds: { isEmpty: true } }, { restaurantIds: { has: restaurantId } }] }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
    ]);
    return {
      enabled: menu.introEnabled,
      locales: menu.locales,
      defaultLocale: menu.defaultLocale,
      intro: intro ?? { backgroundAssetId: null, overlay: 50, showLogo: true, showContact: true },
      platformAdverts: platform.map(({ restaurantIds: _ids, ...advert }) => advert),
    };
  },
});
