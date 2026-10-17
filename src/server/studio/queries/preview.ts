import { z } from 'zod';
import { LOCALES } from '@/lib/locale';
import { loadOverlay } from '@/server/data/live';
import { buildMenuView, type MenuView } from '@/server/data/menu-view';
import { tenantInfo } from '@/server/data/public-menu';
import type { TenantInfo } from '@/server/data/tenant';
import { toCatalog } from '@/server/domain/snapshot';
import { loadDraftSnapshot } from '@/server/publish/draft';
import { defineQuery } from '@/server/studio/framework/query';
import { StudioError } from '@/server/studio/framework/result';

/**
 * The draft as guests would get it if it were published now (spec 10.4, Preview): the draft snapshot with today's live
 * switches laid over it, built by the public menu's own code. Anyone who may open the menu may preview it; nothing is
 * cached, since the page reads the session.
 */

const idField = z.string().min(1).max(100);

export const draft = defineQuery({
  name: 'preview.draft',
  permission: 'view',
  input: z.object({ menuId: idField, locale: z.enum(LOCALES) }),
  target: (i) => ({ kind: 'menu', menuId: i.menuId }),
  run: async (ctx, { locale }): Promise<{ tenant: TenantInfo; view: MenuView }> => {
    if (ctx.menuId === null) throw new Error('A menu query ran without a menu');
    const menu = await ctx.db.menu.findUnique({ where: { id: ctx.menuId }, select: { id: true, slug: true, restaurantId: true } });
    if (!menu) throw new StudioError('NOT_FOUND');
    const snapshot = await loadDraftSnapshot(ctx.db, menu.id);
    if (!snapshot.menu.locales.includes(locale)) throw new StudioError('NOT_FOUND');
    const catalog = toCatalog(menu.id, snapshot, await loadOverlay(ctx.db, menu.id));
    const tenant = tenantInfo(menu, 'draft', snapshot);
    return { tenant, view: buildMenuView(catalog, tenant, locale, new Date()) };
  },
});
