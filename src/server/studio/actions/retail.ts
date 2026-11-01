import { z } from 'zod';
import { delegates } from '@/server/data/tenant-db';
import { bumpRetailState, kickAfterCommit } from '@/server/retail/outbox';
import { defineAction, type ActionContext } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';

/**
 * A linked retail shop's switches on the Studio side (spec section 5). Each change is a new snapshot version, queued in
 * the same transaction and sent once it commits. A business without a `RetailLink` is not a retail shop: not found.
 *
 * - `retail.setAiIntake`: the per-shop AI master switch Retails applies as its `ai.intake` override. It needs the
 *   permission that edits plans (`plans.manage`, the platform owner's; owner ruling on question 3), with a reason that is
 *   kept in the audit log.
 * - `retail.resync`: sends the shop's snapshot again, at a new version so Retails cannot ignore it as equal to the one it
 *   has. Any Super Admin (`platform.settings`).
 */

const idField = z.string().min(1).max(100);
const atRestaurant = (restaurantId: string) => ({ kind: 'restaurant', restaurantId }) as const;

function restaurantOf(ctx: ActionContext): string {
  if (ctx.restaurantId === null) throw new Error('A retail action ran without a restaurant');
  return ctx.restaurantId;
}

export const setAiIntake = defineAction({
  name: 'retail.setAiIntake',
  permission: 'plans.manage',
  input: z.object({
    restaurantId: idField,
    enabled: z.boolean(),
    reason: z.string().trim().min(3, 'Say why, in at least 3 characters').max(300, 'Use at most 300 characters'),
  }),
  target: (i) => atRestaurant(i.restaurantId),
  run: (ctx, { enabled, reason }) =>
    ctx.transaction(async (tx) => {
      const restaurantId = restaurantOf(ctx);
      const link = await tx.retailLink.findUnique({ where: { restaurantId }, select: { aiIntake: true, stateVersion: true } });
      if (!link) throw new StudioError('NOT_FOUND');
      if (link.aiIntake === enabled) return { aiIntake: enabled, version: link.stateVersion };
      await tx.retailLink.update({ where: { restaurantId }, data: { aiIntake: enabled } });
      const version = await bumpRetailState(delegates(tx), restaurantId);
      ctx.audit({
        action: 'retail.ai_intake_changed',
        entityType: 'RetailLink',
        entityId: restaurantId,
        changes: { aiIntake: { before: link.aiIntake, after: enabled }, reason: { before: null, after: reason } },
      });
      kickAfterCommit(ctx.afterCommit, restaurantId);
      return { aiIntake: enabled, version };
    }),
});

export const resync = defineAction({
  name: 'retail.resync',
  permission: 'platform.settings',
  input: z.object({ restaurantId: idField }),
  target: (i) => atRestaurant(i.restaurantId),
  run: (ctx) =>
    ctx.transaction(async (tx) => {
      const restaurantId = restaurantOf(ctx);
      const link = await tx.retailLink.findUnique({ where: { restaurantId }, select: { stateVersion: true } });
      if (!link) throw new StudioError('NOT_FOUND');
      const version = await bumpRetailState(delegates(tx), restaurantId);
      ctx.audit({
        action: 'retail.resync',
        entityType: 'RetailLink',
        entityId: restaurantId,
        changes: { stateVersion: { before: link.stateVersion, after: version } },
      });
      kickAfterCommit(ctx.afterCommit, restaurantId);
      return { version };
    }),
});
