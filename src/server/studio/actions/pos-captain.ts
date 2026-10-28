import { z } from 'zod';
import { defineAction } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';
import { idField } from '@/server/studio/services/content';

/** The captain's approval step of a restaurant: a Super Admin switches it here; its own people switch it in the till settings. Audited. */
export const setPosCaptainApproval = defineAction({
  name: 'pos.setCaptainApproval',
  permission: 'platform.settings',
  input: z.object({ restaurantId: idField, enabled: z.boolean() }),
  target: () => ({ kind: 'platform' }) as const,
  run: (ctx, input) =>
    ctx.transactionIn({ restaurantId: input.restaurantId }, async (tx) => {
      const existing = await tx.posSettings.findFirst({ where: { restaurantId: input.restaurantId } });
      if (existing) {
        // Same bump as a till save, so a form loaded before this change is refused as stale rather than undoing it.
        await tx.posSettings.update({ where: { id: existing.id }, data: { captainApproval: input.enabled, version: { increment: 1 } } });
      } else {
        try {
          await tx.posSettings.create({ data: { restaurantId: input.restaurantId, captainApproval: input.enabled, version: 1 } });
        } catch (error) {
          if ((error as { code?: unknown } | null)?.code === 'P2002') throw new StudioError('CONFLICT');
          throw error;
        }
      }
      ctx.audit({
        action: 'pos.captain.approval',
        entityType: 'PosSettings',
        entityId: input.restaurantId,
        changes: { captainApproval: { before: existing?.captainApproval ?? false, after: input.enabled } },
      });
      return { enabled: input.enabled };
    }),
});
