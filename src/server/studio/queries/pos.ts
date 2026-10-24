import { z } from 'zod';
import { catalogMenuOf } from '@/server/pos/catalog-menu';
import { readPosSettings } from '@/server/pos/settings';
import { listKitchenSections } from '@/server/pos/kitchen-sections';
import { listPosStaff } from '@/server/pos/staff';
import { defineQuery, type QueryContext } from '@/server/studio/framework/query';
import { tree } from '@/server/studio/queries/content';

/** The cashier's settings and staff, read for the person's own restaurant (never one named by the input). */

const TILL = { kind: 'pos' } as const;

function restaurantOf(ctx: QueryContext): string {
  if (ctx.restaurantId === null) throw new Error('A till query ran without a restaurant');
  return ctx.restaurantId;
}

export const posSettings = defineQuery({
  name: 'pos.settings',
  permission: null,
  pos: 'settings.manage',
  input: z.object({}),
  target: () => TILL,
  run: (ctx) => readPosSettings(ctx.db, restaurantOf(ctx)),
});

export const posStaff = defineQuery({
  name: 'pos.staff',
  permission: null,
  pos: 'staff.manage',
  input: z.object({}),
  target: () => TILL,
  run: (ctx) => listPosStaff(ctx.db, restaurantOf(ctx)),
});

/** The menus a restaurant may pick its product list from, and the one it has picked. */
export const posCatalogMenu = defineQuery({
  name: 'pos.catalogMenu',
  permission: null,
  pos: 'catalog.manage',
  input: z.object({}),
  target: () => TILL,
  run: async (ctx) => {
    const restaurantId = restaurantOf(ctx);
    const [chosen, menus] = await Promise.all([
      catalogMenuOf(ctx.db, restaurantId),
      ctx.db.menu.findMany({
        where: { restaurantId, status: { not: 'ARCHIVED' } },
        select: { id: true, name: true, currency: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return { chosenId: chosen?.id ?? null, menus };
  },
});

/** The product list as the till's catalog page edits it: the menu's categories with their products and versions, and the sections. */
export const posCatalogEditor = defineQuery({
  name: 'pos.catalogEditor',
  permission: null,
  pos: 'catalog.manage',
  input: z.object({}),
  target: () => ({ kind: 'pos', catalog: true }) as const,
  run: async (ctx) => {
    if (ctx.menuId === null) throw new Error('A till query ran without a restaurant');
    const [catalog, sections] = await Promise.all([tree.run(ctx, { menuId: ctx.menuId }), listKitchenSections(ctx.db, restaurantOf(ctx))]);
    const restaurantId = restaurantOf(ctx);
    const [categorySettings, productSettings] = await Promise.all([
      ctx.db.posCategorySetting.findMany({ where: { restaurantId }, select: { categoryId: true, sectionId: true } }),
      ctx.db.posProductSetting.findMany({ where: { restaurantId }, select: { productId: true, sectionId: true, soldOutOverride: true } }),
    ]);
    return {
      menuId: ctx.menuId,
      catalog,
      sections,
      categorySections: Object.fromEntries(categorySettings.map((row) => [row.categoryId, row.sectionId])),
      productSettings: Object.fromEntries(productSettings.map((row) => [row.productId, { sectionId: row.sectionId, soldOutOverride: row.soldOutOverride }])),
    };
  },
});
