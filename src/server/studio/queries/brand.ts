import { z } from 'zod';
import { defineQuery, type QueryContext } from '@/server/studio/framework/query';
import { brandKit, paletteSuggestions } from '@/server/studio/services/brand';
import { idField } from '@/server/studio/services/content';

/** What the Brand tab reads: the kit, and palettes suggested from a logo. */

const atMenu = (menuId: string) => ({ kind: 'menu', menuId }) as const;

function placeOf(ctx: QueryContext): { menuId: string; restaurantId: string } {
  if (ctx.menuId === null || ctx.restaurantId === null) throw new Error('A menu query ran without a menu');
  return { menuId: ctx.menuId, restaurantId: ctx.restaurantId };
}

export const get = defineQuery({
  name: 'brand.get',
  permission: 'brand.edit',
  input: z.object({ menuId: idField }),
  target: (i) => atMenu(i.menuId),
  run: (ctx) => {
    const { menuId, restaurantId } = placeOf(ctx);
    return brandKit(ctx.db, menuId, restaurantId);
  },
});

export const suggestFromLogo = defineQuery({
  name: 'brand.suggestFromLogo',
  permission: 'brand.edit',
  input: z.object({ menuId: idField, assetId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), theme: z.enum(['light', 'dark']) }),
  target: (i) => atMenu(i.menuId),
  run: (ctx, input) => paletteSuggestions(ctx.db, placeOf(ctx).restaurantId, input),
});
