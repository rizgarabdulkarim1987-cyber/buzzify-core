import { z } from 'zod';
import { canPh } from '@/server/domain/pharmacy/permissions';
import { approveCount, cancelCount, countOpenInput, countRecordInput, openCount, recordCounts, submitCount } from '@/server/pharmacy/counts';
import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { defineAction } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';

/**
 * Stock counts (spec 5, Phase 2): open, record, submit and cancel need `stock.count`; approving needs `stock.adjust`
 * and, when anything differs, a reason and (with several approvers in the branch) someone other than the counter. The
 * branch is the validated place's. Audit rows carry ids, numbers and differences, never cost.
 */

/** Up to 5000 lines, each possibly a movement: more than the default transaction time. */
const COUNT_TIMEOUT_MS = 60_000;
/** Differences listed in the audit row; the rest are only counted. */
const AUDIT_LINES = 100;

const countId = z.string().min(1).max(64);

export const open = defineAction({
  name: 'ph.stock.count.open',
  permission: null,
  ph: 'stock.count',
  input: countOpenInput.and(phPlaceInput),
  target: phTargetOf,
  run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    if (!input.branchId) throw new StudioError('INVALID', 'Choose the branch to count', { branchId: 'Choose a branch' });
    const branchId = input.branchId;
    return ctx.transaction(
      async (tx) => {
        const made = await openCount(tx, { restaurantId: ph.restaurantId, branchId, userId: ph.userId, input });
        ctx.audit({
          action: 'ph.count.open',
          entityType: 'PhStockCount',
          entityId: made.id,
          changes: {
            status: { before: null, after: 'OPEN' },
            branchId: { before: null, after: branchId },
            scope: { before: null, after: made.scope },
            blind: { before: null, after: made.blind },
            lineCount: { before: null, after: made.lineCount },
          },
        });
        return made;
      },
      { timeoutMs: COUNT_TIMEOUT_MS },
    );
  },
});

export const record = defineAction({
  name: 'ph.stock.count.record',
  permission: null,
  ph: 'stock.count',
  input: countRecordInput.and(phPlaceInput).and(z.object({ countId })),
  target: phTargetOf,
  run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    return ctx.transaction(
      async (tx) => {
        const saved = await recordCounts(tx, { countId: input.countId, userId: ph.userId, input });
        // How many lines were recorded, nothing else: the counted numbers stay in the count.
        ctx.audit({
          action: 'ph.count.record',
          entityType: 'PhStockCount',
          entityId: saved.id,
          changes: { recordedLines: { before: null, after: saved.recorded } },
        });
        return saved;
      },
      { timeoutMs: COUNT_TIMEOUT_MS },
    );
  },
});

export const submit = defineAction({
  name: 'ph.stock.count.submit',
  permission: null,
  ph: 'stock.count',
  input: phPlaceInput.extend({ countId, skipUncounted: z.boolean().default(false) }),
  target: phTargetOf,
  run(ctx, input) {
    return ctx.transaction(async (tx) => {
      const done = await submitCount(tx, { countId: input.countId, skipUncounted: input.skipUncounted });
      ctx.audit({
        action: 'ph.count.submit',
        entityType: 'PhStockCount',
        entityId: done.id,
        changes: { status: { before: 'OPEN', after: 'SUBMITTED' }, uncountedLines: { before: null, after: done.uncounted } },
      });
      return done;
    });
  },
});

export const cancel = defineAction({
  name: 'ph.stock.count.cancel',
  permission: null,
  ph: 'stock.count',
  input: phPlaceInput.extend({ countId }),
  target: phTargetOf,
  run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    return ctx.transaction(async (tx) => {
      const done = await cancelCount(tx, { countId: input.countId, userId: ph.userId, canAdjust: ph.role !== null && canPh(ph.role, 'stock.adjust') });
      ctx.audit({
        action: 'ph.count.cancel',
        entityType: 'PhStockCount',
        entityId: done.id,
        changes: { status: { before: done.from, after: 'CANCELLED' } },
      });
      return { id: done.id, status: done.status };
    });
  },
});

export const approve = defineAction({
  name: 'ph.stock.count.approve',
  permission: null,
  ph: 'stock.adjust',
  input: phPlaceInput.extend({
    countId,
    reason: z.string().trim().max(300, 'Use at most 300 characters').default(''),
    expectedVersion: z.number().int().min(1).optional(),
  }),
  target: phTargetOf,
  run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    return ctx.transaction(
      async (tx) => {
        const done = await approveCount(tx, { countId: input.countId, userId: ph.userId, reason: input.reason, expectedVersion: input.expectedVersion });
        ctx.audit({
          action: 'ph.count.approve',
          entityType: 'PhStockCount',
          entityId: done.id,
          changes: {
            status: { before: 'SUBMITTED', after: 'APPROVED' },
            reason: { before: null, after: input.reason },
            selfApproved: { before: null, after: done.selfApproved },
            countedLines: { before: null, after: done.countedLines },
            differenceCount: { before: null, after: done.movements },
            netDifference: { before: null, after: done.netDifference },
            differences: { before: null, after: done.differences.slice(0, AUDIT_LINES) },
          },
        });
        return done;
      },
      { timeoutMs: COUNT_TIMEOUT_MS },
    );
  },
});
