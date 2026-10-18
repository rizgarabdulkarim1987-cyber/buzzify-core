import { z } from 'zod';
import { defineQuery } from '@/server/studio/framework/query';
import { idField } from '@/server/studio/services/content';
import { designState } from '@/server/studio/services/design';
import { upgradeInfo } from '@/server/studio/services/plans';

/**
 * What the Design tab reads: the menu's template and overrides, saved designs, what the menu can show, and which
 * background files the restaurant's plan includes.
 */
export const get = defineQuery({
  name: 'design.get',
  permission: 'brand.edit',
  input: z.object({ menuId: idField }),
  target: (i) => ({ kind: 'menu', menuId: i.menuId }),
  run: async (ctx) => {
    if (ctx.menuId === null || ctx.restaurantId === null) throw new Error('A menu query ran without a menu');
    if (ctx.plan === null) throw new Error('design.get ran without a plan');
    const upgrade = await upgradeInfo(ctx.db, ctx);
    return designState(ctx.db, ctx.menuId, ctx.restaurantId, ctx.actor.isSuperAdmin, { entitlements: ctx.plan.entitlements, upgrade });
  },
});
