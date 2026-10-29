import { z } from 'zod';
import { allows } from '@/server/domain/entitlements';
import { advertShowsIn } from '@/server/domain/intro';
import { defineQuery } from '@/server/studio/framework/query';
import { StudioError } from '@/server/studio/framework/result';
import { thumbsOf } from '@/server/studio/services/intro';
import { upgradeInfo } from '@/server/studio/services/plans';

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
      ctx.db.platformAdvert.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
    ]);
    const shown = platform.filter((advert) => advertShowsIn(advert, { menuId, restaurantId }));
    if (ctx.plan === null) throw new Error('menus.intro ran without a plan');
    const upgrade = await upgradeInfo(ctx.db, ctx);
    const thumbs = await thumbsOf(ctx.db, [intro?.backgroundAssetId, ...shown.map((advert) => advert.imageAssetId)]);
    return {
      thumbs,
      // Whether the restaurant's plan holds the intro. Without it the switch is refused, and guests never see the page.
      plan: { allowed: allows(ctx.plan.entitlements, 'menu.intro'), upgrade },
      enabled: menu.introEnabled,
      locales: menu.locales,
      defaultLocale: menu.defaultLocale,
      intro: intro ?? { backgroundAssetId: null, overlay: 50, showLogo: true, showContact: true },
      platformAdverts: shown.map(({ restaurantIds: _r, menuIds: _m, ...advert }) => advert),
    };
  },
});
