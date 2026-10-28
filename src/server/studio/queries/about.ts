import { z } from 'zod';
import { defineQuery } from '@/server/studio/framework/query';
import { StudioError } from '@/server/studio/framework/result';
import type { StoryByLocale } from '@/server/domain/about';

/** A menu's About page settings and offers for the Studio (all offers, expired ones included, so the restaurant can renew them). */
export const menuAbout = defineQuery({
  name: 'menus.about',
  permission: 'content.edit',
  input: z.object({ menuId: z.string().min(1).max(100) }),
  target: (i) => ({ kind: 'menu', menuId: i.menuId }) as const,
  run: async (ctx, { menuId }) => {
    const menu = await ctx.db.menu.findUnique({ where: { id: menuId }, select: { aboutEnabled: true, locales: true, defaultLocale: true, timezone: true } });
    if (!menu) throw new StudioError('NOT_FOUND');
    const [about, offers] = await Promise.all([
      ctx.db.menuAbout.findUnique({ where: { menuId } }),
      ctx.db.aboutOffer.findMany({ where: { menuId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
    ]);
    return {
      enabled: menu.aboutEnabled,
      locales: menu.locales,
      defaultLocale: menu.defaultLocale,
      timezone: menu.timezone,
      about: {
        titles: (about?.titles ?? {}) as Partial<Record<'en' | 'ar' | 'ckb', string>>,
        coverAssetId: about?.coverAssetId ?? null,
        story: (about?.story ?? {}) as StoryByLocale,
        galleryAssetIds: about?.galleryAssetIds ?? [],
        showHours: about?.showHours ?? true,
        showContact: about?.showContact ?? true,
      },
      offers,
    };
  },
});
