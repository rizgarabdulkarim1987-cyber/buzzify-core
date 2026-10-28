import { z } from 'zod';
import { delegates } from '@/server/data/tenant-db';
import { QR_LIMITS } from '@/server/domain/pos/customer-order-rules';
import { getCatalog, getTenant } from '@/server/data/public-menu';
import { createCaptainRequestIn } from '@/server/pos/customer-orders';
import { refuse } from '@/server/pos/errors';
import { defineAction, type ActionContext } from '@/server/studio/framework/action';
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

const INT32 = 2_147_483_647;

/** Everything a dish of the captain's order is told: the same choices a guest makes on the Menu. */
const captainLine = z.object({
  productId: idField,
  quantity: z.number().int().min(1).max(QR_LIMITS.maxQuantity),
  note: z.string().trim().max(QR_LIMITS.maxNote, 'Use at most 300 characters').optional(),
  variantId: idField.nullable().optional(),
  optionIds: z.array(idField).max(50).optional(),
});

/**
 * The captain takes an order for a table by mouth. It reaches the cashier already approved, as a request like a guest's, so
 * the cashier accepts it the same way. Only while ordering from the table is on, because that is where requests are shown.
 */
export const placeCaptainOrder = defineAction({
  name: 'pos.placeCaptainOrder',
  permission: null,
  pos: 'captain.order',
  input: z.object({
    tableNumber: z.number().int().min(1).max(INT32),
    lines: z.array(captainLine).min(1).max(QR_LIMITS.maxLines),
    note: z.string().trim().max(QR_LIMITS.maxNote, 'Use at most 300 characters').optional(),
  }),
  target: () => ({ kind: 'pos', catalog: true }) as const,
  run: async (ctx: ActionContext, input) => {
    if (ctx.pos === null || ctx.restaurantId === null || ctx.menuId === null) throw new Error('A till action ran without a till');
    const { pos, restaurantId } = { pos: ctx.pos, restaurantId: ctx.restaurantId };
    const settings = await ctx.db.posSettings.findFirst({ where: { restaurantId }, select: { qrOrderingEnabled: true } });
    if (!settings?.qrOrderingEnabled) throw refuse('CONFLICT', 'Ordering from the table is off');
    const menu = await ctx.db.menu.findFirst({ where: { id: ctx.menuId, restaurantId }, select: { slug: true } });
    const tenant = menu ? await getTenant(menu.slug) : null;
    if (!tenant || tenant.id !== ctx.menuId) throw refuse('CONFLICT', 'This product is not available');
    const catalog = await getCatalog(tenant);
    return ctx.transaction(async (tx) => {
      const done = await createCaptainRequestIn(delegates(tx), restaurantId, catalog, { ...input, userId: pos.userId });
      ctx.audit({
        action: 'pos.request.captain',
        entityType: 'PosCustomerOrder',
        entityId: done.requestId,
        changes: { tableNumber: { before: null, after: input.tableNumber }, lines: { before: null, after: done.lines } },
      });
      return { requestId: done.requestId };
    });
  },
});
