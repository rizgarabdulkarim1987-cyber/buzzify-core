import { z } from 'zod';
import { catalogMenuOf } from '@/server/pos/catalog-menu';
import { readPosSettings } from '@/server/pos/settings';
import { listPosStaff } from '@/server/pos/staff';
import { defineQuery, type QueryContext } from '@/server/studio/framework/query';

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
