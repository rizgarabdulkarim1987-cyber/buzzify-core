import { z } from 'zod';
import { delegates } from '@/server/data/tenant-db';
import { QR_LIMITS } from '@/server/domain/pos/customer-order-rules';
import { canPos } from '@/server/domain/pos/permissions';
import { isUniqueViolation, refuse } from '@/server/pos/errors';
import { ensureMenuTablesIn } from '@/server/pos/qr-sheet';
import { getStudioTranslator } from '@/studio/messages';
import { acceptRequestIn, addRequestLineIn, approveRequestIn, rejectRequestIn, removeRequestLineIn, setRequestLineQuantityIn } from '@/server/pos/customer-orders';
import { getCatalog, getTenant } from '@/server/data/public-menu';
import { defineAction, type ActionContext } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';
import { idField } from '@/server/studio/services/content';

/**
 * What the till does with a guest's QR order: the cashier or the captain changes a quantity, removes or adds a line, or
 * rejects it; the captain approves one held for them; only the cashier accepts it into an order.
 */

const TILL = { kind: 'pos' } as const;
/** Accepting reads the products' kitchen sections, so it targets the catalog menu. */
const CATALOG = { kind: 'pos', catalog: true } as const;
const INT32 = 2_147_483_647;
const ATTEMPTS = 3;

function till(ctx: ActionContext) {
  if (ctx.pos === null || ctx.restaurantId === null) throw new Error('A till action ran without a till');
  return { pos: ctx.pos, restaurantId: ctx.restaurantId };
}

/** Whether the person may approve for the captain: their edits keep a captain's approval; anyone else's send it back. */
function canApprove(ctx: ActionContext): boolean {
  return ctx.pos !== null && canPos(ctx.pos.role, 'request.approve');
}

/** The audit entry of an edit that sent an approved request back to the captain. */
function approvalChange(cleared: boolean): Record<string, { before: unknown; after: unknown }> {
  return cleared ? { captainApproval: { before: 'APPROVED', after: 'NEEDED' } } : {};
}

export const setPosRequestLineQuantity = defineAction({
  name: 'pos.setRequestLineQuantity',
  permission: null,
  pos: 'request.handle',
  input: z.object({ lineId: idField, quantity: z.number().int().min(1).max(QR_LIMITS.maxQuantity) }),
  target: () => TILL,
  run: (ctx, input) => {
    const { restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      const done = await setRequestLineQuantityIn(delegates(tx), restaurantId, { ...input, canApprove: canApprove(ctx) });
      ctx.audit({
        action: 'pos.request.edit',
        entityType: 'PosCustomerOrderLine',
        entityId: done.lineId,
        changes: { quantity: { before: done.before, after: done.after }, ...approvalChange(done.approvalCleared) },
      });
      // `sentBack`: the edit undid the captain's approval, so the screen can say the order went back to them.
      return { requestId: done.requestId, sentBack: done.approvalCleared };
    });
  },
});

export const removePosRequestLine = defineAction({
  name: 'pos.removeRequestLine',
  permission: null,
  pos: 'request.handle',
  input: z.object({ lineId: idField }),
  target: () => TILL,
  run: (ctx, input) => {
    const { restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      const done = await removeRequestLineIn(delegates(tx), restaurantId, { ...input, canApprove: canApprove(ctx) });
      ctx.audit({
        action: 'pos.request.edit',
        entityType: 'PosCustomerOrderLine',
        entityId: done.lineId,
        changes: { name: { before: done.name, after: null }, quantity: { before: done.quantity, after: null }, ...approvalChange(done.approvalCleared) },
      });
      return { requestId: done.requestId, sentBack: done.approvalCleared };
    });
  },
});

/** Adds a dish to a waiting request, priced from the Menu's published catalog as the guest's own lines are. */
export const addPosRequestLine = defineAction({
  name: 'pos.addRequestLine',
  permission: null,
  pos: 'request.handle',
  input: z.object({
    requestId: idField,
    productId: idField,
    quantity: z.number().int().min(1).max(QR_LIMITS.maxQuantity),
    note: z.string().trim().max(QR_LIMITS.maxNote, 'Use at most 300 characters').optional(),
    variantId: idField.nullable().optional(),
    optionIds: z.array(idField).max(50).optional(),
  }),
  target: () => CATALOG,
  run: async (ctx, input) => {
    const { restaurantId } = till(ctx);
    if (ctx.menuId === null) throw new StudioError('NOT_FOUND');
    // The catalog guests are priced against: the catalog menu's live revision, read before the transaction.
    const menu = await ctx.db.menu.findFirst({ where: { id: ctx.menuId, restaurantId }, select: { slug: true } });
    const tenant = menu ? await getTenant(menu.slug) : null;
    if (!tenant || tenant.id !== ctx.menuId) throw refuse('CONFLICT', 'This product is not available');
    const catalog = await getCatalog(tenant);
    return ctx.transaction(async (tx) => {
      const done = await addRequestLineIn(delegates(tx), restaurantId, catalog, { ...input, canApprove: canApprove(ctx) });
      ctx.audit({
        action: 'pos.request.edit',
        entityType: 'PosCustomerOrderLine',
        entityId: done.lineId,
        changes: { name: { before: null, after: done.name }, quantity: { before: null, after: done.quantity }, ...approvalChange(done.approvalCleared) },
      });
      return { requestId: done.requestId, lineId: done.lineId, sentBack: done.approvalCleared };
    });
  },
});

/** The captain's approval of a guest order held for them; after it the cashier may accept it. */
export const approvePosRequest = defineAction({
  name: 'pos.approveRequest',
  permission: null,
  pos: 'request.approve',
  input: z.object({ requestId: idField }),
  target: () => TILL,
  run: (ctx, input) => {
    const { pos, restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      const done = await approveRequestIn(delegates(tx), restaurantId, { ...input, userId: pos.userId });
      ctx.audit({
        action: 'pos.request.approve',
        entityType: 'PosCustomerOrder',
        entityId: done.requestId,
        changes: { captainApprovedAt: { before: null, after: done.approvedAt.toISOString() } },
      });
      return { requestId: done.requestId };
    });
  },
});

export const acceptPosRequest = defineAction({
  name: 'pos.acceptRequest',
  permission: null,
  pos: 'order.handle',
  input: z.object({ requestId: idField, expectedOrderVersion: z.number().int().min(1).max(INT32).optional() }),
  target: () => CATALOG,
  run: async (ctx, input) => {
    const { pos, restaurantId } = till(ctx);
    // Two people opening a table at once can pick the same next number or the same table: the database refuses the second,
    // and a failed transaction cannot go on, so the whole acceptance is tried again.
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        return await ctx.transaction(async (tx) => {
          const done = await acceptRequestIn(delegates(tx), restaurantId, { ...input, userId: pos.userId });
          ctx.audit({
            action: 'pos.request.accept',
            entityType: 'PosCustomerOrder',
            entityId: done.requestId,
            changes: {
              status: { before: 'PENDING', after: 'ACCEPTED' },
              orderId: { before: null, after: done.orderId },
              lines: { before: null, after: done.lineCount },
            },
          });
          return { orderId: done.orderId, created: done.created, version: done.version };
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }
    throw refuse('CONFLICT', 'Could not open the order. Try again.');
  },
});

export const rejectPosRequest = defineAction({
  name: 'pos.rejectRequest',
  permission: null,
  pos: 'request.handle',
  input: z.object({ requestId: idField, reason: z.string().trim().max(200, 'Use at most 200 characters') }),
  target: () => TILL,
  run: (ctx, input) => {
    const { pos, restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      const done = await rejectRequestIn(delegates(tx), restaurantId, { ...input, userId: pos.userId });
      ctx.audit({
        action: 'pos.request.reject',
        entityType: 'PosCustomerOrder',
        entityId: done.requestId,
        changes: { status: { before: 'PENDING', after: 'REJECTED' }, reason: { before: null, after: done.reason } },
      });
      return { requestId: done.requestId };
    });
  },
});

/** Makes the Menu's table pages for the floor's tables that have none, so every printed QR code opens a page. */
export const ensurePosMenuTables = defineAction({
  name: 'pos.ensureMenuTables',
  permission: null,
  pos: 'settings.manage',
  input: z.object({}),
  target: () => ({ kind: 'pos', catalog: true }) as const,
  run: (ctx) => {
    const { restaurantId } = till(ctx);
    const menuId = ctx.menuId;
    if (menuId === null) throw new StudioError('NOT_FOUND');
    const name = getStudioTranslator(ctx.actor.locale);
    return ctx.transaction(async (tx) => {
      const done = await ensureMenuTablesIn(delegates(tx), restaurantId, menuId, (number) => name('qr.kind.table', { number }));
      if (done.created > 0) {
        ctx.audit({ action: 'pos.qr.tables', entityType: 'PosSettings', entityId: menuId, changes: { menuTables: { before: null, after: done.created } } });
      }
      return done;
    });
  },
});
