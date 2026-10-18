import { z } from 'zod';
import { defineQuery } from '@/server/studio/framework/query';
import { idField } from '@/server/studio/services/content';
import { designState } from '@/server/studio/services/design';

/** What the Design tab reads: the menu's template and overrides, saved designs, and what the menu can show. */
export const get = defineQuery({
  name: 'design.get',
  permission: 'brand.edit',
  input: z.object({ menuId: idField }),
  target: (i) => ({ kind: 'menu', menuId: i.menuId }),
  run: (ctx) => {
    if (ctx.menuId === null || ctx.restaurantId === null) throw new Error('A menu query ran without a menu');
    return designState(ctx.db, ctx.menuId, ctx.restaurantId, ctx.actor.isSuperAdmin);
  },
});
