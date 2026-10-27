import { z } from 'zod';
import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { confirmReceipt, createDraft, receiptInput, updateDraft, voidDraft } from '@/server/pharmacy/receipts';
import { defineAction } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';

/**
 * Manual receiving (spec 4, Phase 2): create a draft (idempotent by `clientKey`), edit it, confirm it into stock, or
 * void it. All need `purchase.manage` (the framework's `ph` field takes one permission, so a holder of only
 * `stock.adjust` cannot receive yet). The branch is the validated place's; a receipt is created in it and nowhere else.
 */

const receiptId = z.string().min(1).max(64);
const clientKey = z.string().trim().min(8, 'Use at least 8 characters').max(100, 'Use at most 100 characters');

const isUnique = (error: unknown) => (error as { code?: unknown } | null)?.code === 'P2002';

export const create = defineAction({
  name: 'ph.stock.receipt.create',
  permission: null,
  ph: 'purchase.manage',
  input: receiptInput.extend(phPlaceInput.shape).extend({ clientKey }),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    if (!input.branchId) throw new StudioError('INVALID', 'Choose the branch that receives the goods', { branchId: 'Choose a branch' });
    const branchId = input.branchId;
    try {
      return await ctx.transaction(async (tx) => {
        const made = await createDraft(tx, { restaurantId: ph.restaurantId, branchId, clientKey: input.clientKey, userId: ph.userId, input });
        if (!made.replayed) {
          // Ids, counts and status only.
          ctx.audit({
            action: 'ph.receipt.create',
            entityType: 'PhReceipt',
            entityId: made.id,
            changes: { status: { before: null, after: 'DRAFT' }, branchId: { before: null, after: branchId }, lineCount: { before: null, after: made.lineCount } },
          });
        }
        return made;
      });
    } catch (error) {
      if (!isUnique(error)) throw error;
      // Two saves with one key at once: the database kept one. Return it (when this actor may see it).
      const winner = await scoped.phReceipt.findFirst({
        where: { clientKey: input.clientKey },
        select: { id: true, version: true, status: true, _count: { select: { lines: true } } },
      });
      if (!winner) throw new StudioError('CONFLICT', 'This key was already used', { phCode: 'CLIENT_KEY_USED' });
      if (winner.status !== 'DRAFT') throw new StudioError('CONFLICT', 'This receipt was already processed', { phCode: 'NOT_DRAFT' });
      return { id: winner.id, version: winner.version, status: 'DRAFT' as const, replayed: true, lineCount: winner._count.lines };
    }
  },
});

export const update = defineAction({
  name: 'ph.stock.receipt.update',
  permission: null,
  ph: 'purchase.manage',
  input: receiptInput.extend(phPlaceInput.shape).extend({ receiptId, expectedVersion: z.number().int().min(1) }),
  target: phTargetOf,
  run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    return ctx.transaction(async (tx) => {
      const saved = await updateDraft(tx, { restaurantId: ph.restaurantId, receiptId: input.receiptId, expectedVersion: input.expectedVersion, input });
      ctx.audit({
        action: 'ph.receipt.update',
        entityType: 'PhReceipt',
        entityId: saved.id,
        changes: { version: { before: input.expectedVersion, after: saved.version }, lineCount: { before: null, after: saved.lineCount } },
      });
      return saved;
    });
  },
});

export const confirm = defineAction({
  name: 'ph.stock.receipt.confirm',
  permission: null,
  ph: 'purchase.manage',
  input: phPlaceInput.extend({ receiptId }),
  target: phTargetOf,
  run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    return ctx.transaction(async (tx) => {
      const done = await confirmReceipt(tx, { restaurantId: ph.restaurantId, receiptId: input.receiptId, userId: ph.userId });
      ctx.audit({
        action: 'ph.receipt.confirm',
        entityType: 'PhReceipt',
        entityId: done.id,
        changes: {
          status: { before: 'DRAFT', after: 'CONFIRMED' },
          number: { before: null, after: done.number },
          lineCount: { before: null, after: done.lines },
          baseQty: { before: null, after: done.baseQty },
          costDiffers: { before: null, after: done.warnings.length },
        },
      });
      return done;
    });
  },
});

export const voidReceipt = defineAction({
  name: 'ph.stock.receipt.void',
  permission: null,
  ph: 'purchase.manage',
  input: phPlaceInput.extend({ receiptId }),
  target: phTargetOf,
  run(ctx, input) {
    return ctx.transaction(async (tx) => {
      const voided = await voidDraft(tx, input.receiptId);
      ctx.audit({
        action: 'ph.receipt.void',
        entityType: 'PhReceipt',
        entityId: voided.id,
        changes: { status: { before: 'DRAFT', after: 'VOID' }, lineCount: { before: null, after: voided.lineCount } },
      });
      return { id: voided.id, status: 'VOID' as const };
    });
  },
});
