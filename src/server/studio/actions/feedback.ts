import { z } from 'zod';
import { expireMenu } from '@/server/data/cache';
import { defineAction } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';
import { menuSlugs } from '@/server/studio/services/menus';

/** Whether guests of a menu get the complaints and suggestions box. Read live by the guest pages, so no publish is needed. */
export const setMenuFeedback = defineAction({
  name: 'menus.setFeedback',
  permission: 'content.edit',
  input: z.object({ menuId: z.string().min(1).max(100), enabled: z.boolean() }),
  target: (i) => ({ kind: 'menu', menuId: i.menuId }) as const,
  run: (ctx, { menuId, enabled }) =>
    ctx.transaction(async (tx) => {
      const row = await tx.menu.findUnique({ where: { id: menuId }, select: { feedbackEnabled: true } });
      if (!row) throw new StudioError('NOT_FOUND');
      if (row.feedbackEnabled === enabled) return { enabled };
      await tx.menu.update({ where: { id: menuId }, data: { feedbackEnabled: enabled } });
      ctx.audit({ action: 'menu.feedback_changed', entityType: 'MenuFeedback', entityId: menuId, changes: { enabled: { before: row.feedbackEnabled, after: enabled } } });
      const slugs = await menuSlugs(tx, menuId);
      ctx.afterCommit(() => expireMenu(slugs, menuId));
      return { enabled };
    }),
});
