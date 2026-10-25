import { z } from 'zod';
import { delegates } from '@/server/data/tenant-db';
import { OP_KINDS } from '@/lib/pos-sync/op-schema';
import { refuse } from '@/server/pos/errors';
import { findStoredOperation } from '@/server/pos/sync-operation';
import { defineAction } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';

/**
 * A cashier throws away an operation that waits on a device and never reached the server. The server changes nothing (there
 * is nothing to undo); it keeps a record, so cash taken offline and then discarded leaves a trace and a reason.
 */

const TILL = { kind: 'pos' } as const;
const INT32 = 2_147_483_647;

export const discardPosSyncOperation = defineAction({
  name: 'pos.discardSyncOperation',
  permission: null,
  pos: 'order.handle',
  input: z.object({
    operationId: z.uuid(),
    deviceId: z.uuid(),
    kind: z.enum(OP_KINDS),
    clientAt: z.iso.datetime(),
    summary: z.object({ amount: z.number().int().min(0).max(INT32).optional(), lines: z.number().int().min(0).max(1000).optional() }).strict(),
    reason: z.string().trim().max(300, 'Use at most 300 characters'),
  }),
  target: () => TILL,
  run: async (ctx, input) => {
    if (ctx.pos === null || ctx.restaurantId === null) throw new Error('A till action ran without a till');
    // Cash was taken at the till for a payment: the reason is the only record of why it was not posted.
    if (input.kind === 'payCash' && input.reason === '') throw new StudioError('INVALID', 'Enter a reason', { reason: 'Enter a reason' });
    if (await findStoredOperation(delegates(ctx.db), ctx.restaurantId, input.operationId)) {
      throw refuse('CONFLICT', 'This operation was already applied');
    }
    ctx.audit({
      action: 'pos.sync.discard',
      entityType: 'PosSyncOperation',
      entityId: input.operationId,
      changes: {
        kind: { before: input.kind, after: null },
        deviceId: { before: input.deviceId, after: null },
        clientAt: { before: input.clientAt, after: null },
        ...(input.summary.amount !== undefined ? { amount: { before: input.summary.amount, after: null } } : {}),
        ...(input.summary.lines !== undefined ? { lines: { before: input.summary.lines, after: null } } : {}),
        reason: { before: null, after: input.reason },
      },
    });
    return { discarded: true as const };
  },
});
