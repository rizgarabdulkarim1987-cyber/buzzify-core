import { z } from 'zod';
import { LOCALES } from '@/lib/locale';
import { loadDishCounts } from '@/server/data/dish-counts';
import { loadOverlay } from '@/server/data/live';
import { buildMenuView, type MenuView } from '@/server/data/menu-view';
import { getPrisma } from '@/server/data/prisma';
import { tenantInfo } from '@/server/data/public-menu';
import type { TenantInfo } from '@/server/data/tenant';
import { hiddenFromGuests, servedCatalog } from '@/server/domain/plan-choices';
import { toCatalog } from '@/server/domain/snapshot';
import { loadDraftSnapshot, type DesignContext } from '@/server/publish/draft';
import { defineQuery } from '@/server/studio/framework/query';
import { StudioError } from '@/server/studio/framework/result';
import { upgradeInfo } from '@/server/studio/services/plans';

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
  run: async (ctx, { locale }): Promise<{ tenant: TenantInfo; view: MenuView; designContext: DesignContext }> => {
    if (ctx.menuId === null || ctx.plan === null) throw new Error('A menu query ran without a menu');
    const menu = await ctx.db.menu.findUnique({ where: { id: ctx.menuId }, select: { id: true, slug: true, restaurantId: true, dishCountsEnabled: true } });
    if (!menu) throw new StudioError('NOT_FOUND');
    const snapshot = await loadDraftSnapshot(ctx.db, menu.id);
    if (!snapshot.menu.locales.includes(locale)) throw new StudioError('NOT_FOUND');
    // As guests on the restaurant's plan would see it.
    const tenant = tenantInfo(menu, 'draft', snapshot, ctx.plan.entitlements);
    const catalog = servedCatalog(toCatalog(menu.id, snapshot, await loadOverlay(ctx.db, menu.id)), tenant.features);
    // The restaurant's side of a template, so the Design tab can preview any template with the business's details.
    const restaurant = await ctx.db.restaurant.findUniqueOrThrow({
      where: { id: menu.restaurantId },
      select: { address: true, city: true, phone: true, whatsapp: true, mapUrl: true, socialLinks: true, workingHours: true, showPoweredBy: true },
    });
    const { showPoweredBy, ...details } = restaurant;
    return { tenant, view: buildMenuView(catalog, tenant, locale, new Date(), { dishCounts: tenant.extras.dishCounts ? await loadDishCounts(getPrisma(), menu.id) : undefined }), designContext: { details, showPoweredBy } };
  },
});

/** What the Preview tab says above the frames: what the draft would show guests that the plan leaves out, and the hint. */
export const planNote = defineQuery({
  name: 'preview.planNote',
  permission: 'view',
  input: z.object({ menuId: idField }),
  target: (i) => ({ kind: 'menu', menuId: i.menuId }),
  run: async (ctx) => {
    if (ctx.menuId === null || ctx.plan === null) throw new Error('A menu query ran without a menu');
    const snapshot = await loadDraftSnapshot(ctx.db, ctx.menuId);
    const hidden = hiddenFromGuests(snapshot.brand, snapshot.catalog, ctx.plan.entitlements);
    return { hidden, upgrade: hidden.length > 0 ? await upgradeInfo(ctx.db, ctx) : null };
  },
});
