import type { PrismaClient } from '@/generated/prisma/client';
import { scopeOf } from '@/lib/pos-sync/scope';
import { operationIdOf, operationSchema, type Op, type OpAnswer, type OpKind, type OrderRef, type SyncErrorCode } from '@/lib/pos-sync/op-schema';
import { delegates, scopedClient } from '@/server/data/tenant-db';
import { resolvePosActor } from '@/server/pos/actor';
import { readOrderView } from '@/server/pos/orders';
import { findStoredOperation, payloadHash } from '@/server/pos/sync-operation';
import { sendPosToKitchen } from '@/server/studio/actions/pos-kitchen';
import { addPosLine, cancelPosOrder, openPosOrder, requestPosBill } from '@/server/studio/actions/pos-orders';
import { payPosOrder } from '@/server/studio/actions/pos-payments';
import type { Actor } from '@/server/studio/auth/actor';
import { runAction, type ActionDef, type RequestMeta } from '@/server/studio/framework/action';
import type { StudioFailure } from '@/server/studio/framework/result';

/**
 * Replays a till device's queued operations through the till's own actions, in the order sent. The actions keep their
 * permission, subscription gate, tenant scope, audit and version checks; this file only maps an operation to an action,
 * runs it exactly once (`PosSyncOperation`) and turns the outcome into an answer the device can act on.
 */

const ACTIONS = {
  openOrder: openPosOrder,
  addLine: addPosLine,
  sendToKitchen: sendPosToKitchen,
  requestBill: requestPosBill,
  cancelOrder: cancelPosOrder,
  payCash: payPosOrder,
} as unknown as Record<OpKind, ActionDef<unknown, unknown>>;

const TEXT = {
  shift: 'Open a shift before taking payments',
  table: 'The table already has an open order',
  product: 'This product is not available',
  total: 'The total changed. Check the bill and try again.',
  locked: 'The order is paid, cancelled or rejected and can no longer change',
  stale: 'The order was changed by someone else. Reload it and try again.',
} as const;

/** The action's input for an operation, once its order reference is resolved to an id. */
function inputFor(op: Op, orderId: string): unknown {
  switch (op.kind) {
    case 'openOrder':
      return op.payload;
    case 'addLine':
      return { orderId, expectedVersion: op.expectedVersion, ...op.payload };
    case 'sendToKitchen':
    case 'requestBill':
      return { orderId, expectedVersion: op.expectedVersion };
    case 'cancelOrder':
      return { orderId, expectedVersion: op.expectedVersion, reason: op.payload.reason };
    case 'payCash':
      return { orderId, expectedVersion: op.expectedVersion, expectedTotal: op.payload.expectedTotal, amountReceived: op.payload.amountReceived, method: 'CASH' };
  }
}

/** What identifies the request for the same-id check: everything but the id, the device and the time. */
function hashed(op: Op): unknown {
  return op.kind === 'openOrder' ? { kind: op.kind, payload: op.payload } : { kind: op.kind, orderRef: op.orderRef, expectedVersion: op.expectedVersion, payload: op.payload };
}

const refKey = (ref: OrderRef): string => ('id' in ref ? `id:${ref.id}` : `op:${ref.op}`);

interface ErrorExtra {
  currentVersion?: number | null;
  orderStatus?: string | null;
  detail?: { expectedTotal: number; total: number };
}

const error = (operationId: string, code: SyncErrorCode, extra: ErrorExtra = {}): OpAnswer => ({
  operationId,
  status: 'error',
  code,
  currentVersion: extra.currentVersion ?? null,
  orderStatus: extra.orderStatus ?? null,
  ...(extra.detail ? { detail: extra.detail } : {}),
});

type Stored = NonNullable<Awaited<ReturnType<typeof findStoredOperation>>>;

/** The answer for an operation the restaurant already applied: its stored result, if it is this very request. */
function storedAnswer(op: Op, stored: Stored, userId: string): OpAnswer {
  if (stored.userId !== userId) return error(op.operationId, 'wrongActor');
  if (stored.payloadHash !== payloadHash(hashed(op)) || stored.kind !== op.kind) return error(op.operationId, 'operationMismatch');
  const result = typeof stored.result === 'object' && stored.result !== null ? (stored.result as Record<string, unknown>) : {};
  return { operationId: op.operationId, status: 'done', replayed: true, result };
}

/** The batch was queued by someone else (another person, or another restaurant) than the one now signed in. */
export class ScopeMismatchError extends Error {}

export interface SyncContext {
  prisma: PrismaClient;
  actor: Actor;
  meta: RequestMeta;
}

/**
 * Applies the operations in order. Returns `null` when the person has no till (the route answers 403), else one answer
 * per operation. Once an operation of an order fails, the later ones of that order answer `skipped`; other orders go on.
 */
export async function applyOperations(ctx: SyncContext, deviceId: string, raw: readonly unknown[], scope?: string): Promise<OpAnswer[] | null> {
  const pos = await resolvePosActor(ctx.prisma, ctx.actor.userId, ctx.actor.posRestaurantId);
  if (!pos) return null;
  const restaurantId = pos.restaurantId;
  // Operations are the work of the person and restaurant that queued them: never apply them under another sign-in.
  if (scope !== undefined && scope !== scopeOf(restaurantId, ctx.actor.userId)) throw new ScopeMismatchError();
  const db = delegates(scopedClient(ctx.prisma, { restaurantId }));
  const failed = new Set<string>();
  const answers: OpAnswer[] = [];

  const classify = async (op: Op, orderId: string | null, failure: StudioFailure): Promise<OpAnswer> => {
    const order = orderId ? await db.posOrder.findFirst({ where: { id: orderId, restaurantId }, select: { version: true, status: true } }) : null;
    const message = failure.message;
    const code = failure.code;
    if (code === 'FORBIDDEN' || code === 'TWO_FACTOR_REQUIRED' || code === 'UPGRADE_REQUIRED') return error(op.operationId, 'forbidden');
    if (message === TEXT.shift) return error(op.operationId, 'shiftRequired');
    if (message === TEXT.table) return error(op.operationId, 'tableOccupied');
    if (message === TEXT.product) return error(op.operationId, 'productUnavailable');
    if (message === TEXT.total && op.kind === 'payCash' && orderId) {
      const view = await readOrderView(db, restaurantId, orderId);
      return error(op.operationId, 'totalChanged', { currentVersion: order?.version ?? null, detail: { expectedTotal: op.payload.expectedTotal, total: view?.totals.total ?? 0 } });
    }
    if (code === 'NOT_FOUND') {
      if (op.kind === 'addLine' && order) return error(op.operationId, 'productUnavailable');
      return error(op.operationId, op.kind === 'openOrder' || order ? 'invalid' : 'unknownRef');
    }
    if (message === TEXT.locked) return error(op.operationId, 'locked', { currentVersion: order?.version ?? null, orderStatus: order?.status ?? null });
    if (code === 'CONFLICT' && order && 'expectedVersion' in op && (message === TEXT.stale || order.version !== op.expectedVersion)) {
      return error(op.operationId, 'stale', { currentVersion: order.version, orderStatus: order.status });
    }
    if (code === 'INVALID') return error(op.operationId, 'invalid');
    return error(op.operationId, 'failed', { currentVersion: order?.version ?? null, orderStatus: order?.status ?? null });
  };

  const one = async (item: unknown): Promise<{ answer: OpAnswer; key: string | null }> => {
    const parsed = operationSchema.safeParse(item);
    if (!parsed.success) return { answer: error(operationIdOf(item), 'invalid'), key: null };
    const op = parsed.data;
    const key = op.kind === 'openOrder' ? `op:${op.operationId}` : refKey(op.orderRef);
    if (op.deviceId !== deviceId) return { answer: error(op.operationId, 'invalid'), key };

    const stored = await findStoredOperation(db, restaurantId, op.operationId);
    if (stored) return { answer: storedAnswer(op, stored, ctx.actor.userId), key };
    if (failed.has(key)) return { answer: { operationId: op.operationId, status: 'skipped' }, key };

    let orderId = '';
    if (op.kind !== 'openOrder') {
      if ('id' in op.orderRef) orderId = op.orderRef.id;
      else {
        const creator = await findStoredOperation(db, restaurantId, op.orderRef.op);
        const created = typeof creator?.result === 'object' && creator.result !== null ? (creator.result as { orderId?: unknown }).orderId : undefined;
        if (creator?.kind !== 'openOrder' || typeof created !== 'string') return { answer: error(op.operationId, 'unknownRef'), key };
        orderId = created;
      }
    }

    const operation = { operationId: op.operationId, kind: op.kind, deviceId: op.deviceId, clientAt: new Date(op.clientAt), payloadHash: payloadHash(hashed(op)) };
    const result = await runAction(ctx.prisma, ctx.actor, ACTIONS[op.kind], inputFor(op, orderId), ctx.meta, { operation });
    if (result.ok) return { answer: { operationId: op.operationId, status: 'done', replayed: false, result: result.data as Record<string, unknown> }, key };
    // A twin of this very request may have committed between our check and our claim: its answer is the answer.
    const twin = await findStoredOperation(db, restaurantId, op.operationId);
    if (twin) return { answer: storedAnswer(op, twin, ctx.actor.userId), key };
    return { answer: await classify(op, orderId || null, result.error), key };
  };

  for (const item of raw) {
    const { answer, key } = await one(item);
    if (answer.status === 'error' && key !== null) failed.add(key);
    answers.push(answer);
  }
  return answers;
}
