import { z } from 'zod';
import { expireMenu } from '@/server/data/cache';
import { defineAction } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';
import { menuSlugs } from '@/server/studio/services/menus';

/**
 * The order and view counts on dish cards (docs/superpowers/specs/2026-10-30-menu-dish-counts-design.md): one switch for the whole menu,
 * never per dish. The numbers themselves are never written here. Read live by the guest pages, so no publish is needed; each write expires
 * the menu's cached gate.
 */

export const setMenuDishCountsEnabled = defineAction({
  name: 'menus.setDishCountsEnabled',
  permission: 'content.edit',
  feature: 'menu.dishCounts',
  input: z.object({ menuId: z.string().min(1).max(100), enabled: z.boolean() }),
  target: (input) => ({ kind: 'menu', menuId: input.menuId }),
  run: (ctx, { menuId, enabled }) =>
    ctx.transaction(async (tx) => {
      const row = await tx.menu.findUnique({ where: { id: menuId }, select: { dishCountsEnabled: true } });
      if (!row) throw new StudioError('NOT_FOUND');
      if (row.dishCountsEnabled === enabled) return { enabled };
      await tx.menu.update({ where: { id: menuId }, data: { dishCountsEnabled: enabled } });
      ctx.audit({ action: 'menu.dish_counts_changed', entityType: 'Menu', entityId: menuId, changes: { enabled: { before: row.dishCountsEnabled, after: enabled } } });
      const slugs = await menuSlugs(tx, menuId);
      ctx.afterCommit(() => expireMenu(slugs, menuId));
      return { enabled };
    }),
});
