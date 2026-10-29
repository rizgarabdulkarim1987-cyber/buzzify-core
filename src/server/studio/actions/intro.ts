import { z } from 'zod';
import { expireMenu } from '@/server/data/cache';
import { defineAction } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';
import { menuSlugs } from '@/server/studio/services/menus';
import { requireIntroAsset } from '@/server/studio/services/intro';
import { validOverlay } from '@/server/domain/intro';

/** The intro page before the menu. Read live by the guest pages, so no publish is needed; each write expires the menu's cached gate. */

const menuId = z.string().min(1).max(100);
const target = (i: { menuId: string }) => ({ kind: 'menu', menuId: i.menuId }) as const;

function restaurantOf(ctx: { restaurantId: string | null }): string {
  if (ctx.restaurantId === null) throw new Error('A menu action ran without a restaurant');
  return ctx.restaurantId;
}

export const setMenuIntroEnabled = defineAction({
  name: 'menus.setIntroEnabled',
  permission: 'content.edit',
  feature: 'menu.intro',
  input: z.object({ menuId, enabled: z.boolean() }),
  target,
  run: (ctx, { menuId, enabled }) =>
    ctx.transaction(async (tx) => {
      const row = await tx.menu.findUnique({ where: { id: menuId }, select: { introEnabled: true } });
      if (!row) throw new StudioError('NOT_FOUND');
      if (row.introEnabled === enabled) return { enabled };
      await tx.menu.update({ where: { id: menuId }, data: { introEnabled: enabled } });
      ctx.audit({ action: 'menu.intro_changed', entityType: 'MenuIntro', entityId: menuId, changes: { enabled: { before: row.introEnabled, after: enabled } } });
      const slugs = await menuSlugs(tx, menuId);
      ctx.afterCommit(() => expireMenu(slugs, menuId));
      return { enabled };
    }),
});

export const saveMenuIntro = defineAction({
  name: 'menus.saveIntro',
  permission: 'content.edit',
  feature: 'menu.intro',
  input: z.object({
    menuId,
    backgroundAssetId: z.string().min(1).max(100).nullable(),
    overlay: z.number().refine(validOverlay, 'Use a whole number from 0 to 100'),
    showLogo: z.boolean(),
    showContact: z.boolean(),
  }),
  target,
  run: (ctx, input) =>
    ctx.transaction(async (tx) => {
      if (!(await tx.menu.findUnique({ where: { id: input.menuId }, select: { id: true } }))) throw new StudioError('NOT_FOUND');
      if (input.backgroundAssetId) await requireIntroAsset(tx, restaurantOf(ctx), input.backgroundAssetId, ['IMAGE', 'VIDEO'], 'backgroundAssetId');
      const data = { backgroundAssetId: input.backgroundAssetId, overlay: input.overlay, showLogo: input.showLogo, showContact: input.showContact };
      await tx.menuIntro.upsert({ where: { menuId: input.menuId }, create: { menuId: input.menuId, ...data }, update: data });
      ctx.audit({ action: 'menu.intro_changed', entityType: 'MenuIntro', entityId: input.menuId, changes: { backgroundAssetId: { before: null, after: input.backgroundAssetId } } });
      const slugs = await menuSlugs(tx, input.menuId);
      ctx.afterCommit(() => expireMenu(slugs, input.menuId));
      return { saved: true };
    }),
});
