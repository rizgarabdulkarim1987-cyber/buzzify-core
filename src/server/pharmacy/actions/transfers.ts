import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { assertStaff } from '@/server/pharmacy/receipts';
import {
  asRetryableTransfer,
  cancelFields,
  cancelTransfer,
  receiveFields,
  receiveTransfer,
  requestFields,
  requestTransfer,
  sendFields,
  sendTransfer,
  updateFields,
  updateTransfer,
} from '@/server/pharmacy/transfers';
import { defineAction } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';

/**
 * Moving stock between branches (R6-1..R6-6), `transfer.manage`. Who may act at each end is decided in the service (the
 * scoped client only decides what is visible). The audit rows carry ids, numbers, status, branch ids, counts, quantities and
 * movement ids: never the note or any free text.
 */

const isUnique = (error: unknown) => (error as { code?: unknown } | null)?.code === 'P2002';

/** Up to 100 lines, a few writes each: more than the default transaction time on a slow day. */
const SLOW = { timeoutMs: 60_000 };

/** Runs a keyed write; two saves with one key at once leave the database one, so a unique violation runs again (found, compared, returned). */
async function keyed<T>(attempt: () => Promise<T>): Promise<T> {
  try {
    return await attempt();
  } catch (error) {
    const first = asRetryableTransfer(error);
    if (!isUnique(first)) throw first;
    try {
      return await attempt();
    } catch (again) {
      const second = asRetryableTransfer(again);
      if (!isUnique(second)) throw second;
      throw new StudioError('CONFLICT', 'This key was already used', { phCode: 'CLIENT_KEY_USED' });
    }
  }
}

async function plain<T>(attempt: () => Promise<T>): Promise<T> {
  try {
    return await attempt();
  } catch (error) {
    throw asRetryableTransfer(error);
  }
}

export const request = defineAction({
  name: 'ph.transfers.request',
  permission: null,
  ph: 'transfer.manage',
  input: requestFields.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    assertStaff(ph);
    return keyed(() =>
      ctx.transaction(async (tx) => {
        const made = await requestTransfer(tx, { restaurantId: ph.restaurantId, ph, clientKey: input.clientKey, input });
        if (!made.replayed) {
          ctx.audit({
            action: 'ph.transfer.request',
            entityType: 'PhTransfer',
            entityId: made.id,
            changes: {
              number: { before: null, after: made.number },
              status: { before: null, after: made.status },
              fromBranchId: { before: null, after: made.fromBranchId },
              toBranchId: { before: null, after: made.toBranchId },
              lineCount: { before: null, after: made.lines.length },
              requestedQty: { before: null, after: made.lines.reduce((sum, l) => sum + l.requestedQty, 0) },
            },
          });
        }
        return made;
      }, SLOW),
    );
  },
});

export const update = defineAction({
  name: 'ph.transfers.update',
  permission: null,
  ph: 'transfer.manage',
  input: updateFields.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    assertStaff(ph);
    return plain(() =>
      ctx.transaction(async (tx) => {
        const done = await updateTransfer(tx, { restaurantId: ph.restaurantId, ph, input });
        ctx.audit({
          action: 'ph.transfer.update',
          entityType: 'PhTransfer',
          entityId: done.id,
          changes: { lineCount: { before: null, after: done.lineCount }, version: { before: input.version, after: done.version } },
        });
        return done;
      }, SLOW),
    );
  },
});

export const cancel = defineAction({
  name: 'ph.transfers.cancel',
  permission: null,
  ph: 'transfer.manage',
  input: cancelFields.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    assertStaff(ph);
    return plain(() =>
      ctx.transaction(async (tx) => {
        const done = await cancelTransfer(tx, { restaurantId: ph.restaurantId, ph, input });
        ctx.audit({
          action: 'ph.transfer.cancel',
          entityType: 'PhTransfer',
          entityId: done.id,
          changes: { status: { before: 'REQUESTED', after: done.status }, number: { before: done.number, after: done.number } },
        });
        return done;
      }),
    );
  },
});

export const send = defineAction({
  name: 'ph.transfers.send',
  permission: null,
  ph: 'transfer.manage',
  input: sendFields.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    assertStaff(ph);
    return keyed(() =>
      ctx.transaction(async (tx) => {
        const done = await sendTransfer(tx, { restaurantId: ph.restaurantId, ph, input });
        if (!done.replayed) {
          ctx.audit({
            action: 'ph.transfer.send',
            entityType: 'PhTransfer',
            entityId: done.id,
            changes: {
              status: { before: 'REQUESTED', after: done.status },
              number: { before: done.number, after: done.number },
              lines: { before: null, after: done.lines.map((l) => `${l.batchId}:${l.sentQty}`) },
              totalQty: { before: null, after: done.totalQty },
              override: { before: null, after: done.override },
              movementIds: { before: null, after: done.movementIds },
            },
          });
        }
        return done;
      }, SLOW),
    );
  },
});

export const receive = defineAction({
  name: 'ph.transfers.receive',
  permission: null,
  ph: 'transfer.manage',
  input: receiveFields.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    assertStaff(ph);
    return keyed(() =>
      ctx.transaction(async (tx) => {
        const done = await receiveTransfer(tx, { restaurantId: ph.restaurantId, ph, input });
        if (!done.replayed) {
          ctx.audit({
            action: 'ph.transfer.receive',
            entityType: 'PhTransfer',
            entityId: done.id,
            changes: {
              status: { before: 'SENT', after: done.status },
              number: { before: done.number, after: done.number },
              receivedQty: { before: null, after: done.receivedQty },
              damagedQty: { before: null, after: done.damagedQty },
              lostQty: { before: null, after: done.lostQty },
              movementIds: { before: null, after: done.movementIds },
            },
          });
        }
        return done;
      }, SLOW),
    );
  },
});
