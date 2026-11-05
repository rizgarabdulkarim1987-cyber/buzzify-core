import { z } from 'zod';
import { expireMenu } from '@/server/data/cache';
import { SEASON_EFFECTS } from '@/server/domain/seasons';
import { defineAction } from '@/server/studio/framework/action';
import { requireFeature } from '@/server/studio/framework/plan';
import { StudioError } from '@/server/studio/framework/result';
import { menuSlugs } from '@/server/studio/services/menus';

/**
 * The seasonal particle effect of a menu (docs/superpowers/specs/2026-11-01-project-6-seasonal-particles-design.md): one effect or none.
 * Read live by the guest pages, so no publish is needed; each write expires the menu's cached gate. Choosing an effect needs the plan
 * feature; switching it off never does, so a restaurant that fell to a lower plan can still clear it.
 */

export const setSeasonEffect = defineAction({
  name: 'menus.setSeasonEffect',
  permission: 'brand.edit',
  input: z.object({ menuId: z.string().min(1).max(100), effect: z.enum(SEASON_EFFECTS).nullable() }),
  target: (input) => ({ kind: 'menu', menuId: input.menuId }),
  run: (ctx, { menuId, effect }) => {
    if (effect !== null) requireFeature(ctx.plan, 'design.seasonalParticles');
    return ctx.transaction(async (tx) => {
      const row = await tx.menu.findUnique({ where: { id: menuId }, select: { seasonEffect: true } });
      if (!row) throw new StudioError('NOT_FOUND');
      if (row.seasonEffect === effect) return { effect };
      await tx.menu.update({ where: { id: menuId }, data: { seasonEffect: effect } });
      ctx.audit({ action: 'menu.season_changed', entityType: 'Menu', entityId: menuId, changes: { effect: { before: row.seasonEffect, after: effect } } });
      const slugs = await menuSlugs(tx, menuId);
      ctx.afterCommit(() => expireMenu(slugs, menuId));
      return { effect };
    });
  },
});
