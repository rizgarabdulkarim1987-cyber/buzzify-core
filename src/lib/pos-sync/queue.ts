import { deleteValue, deviceId, getValue, putValue, readQueue, updateQueue, countOtherScopes, type PosDb } from './idb';
import { operationSchema, type Op, type OpAnswer, type OpKind, type OrderRef, type SyncErrorCode } from './op-schema';
import type { Scope } from './scope';
import type { SyncSnapshot } from './snapshot';

/**
 * The device's queue of operations. Each record is one operation with where it stands: waiting to be sent, applied by the
 * server, stopped for the cashier to decide (`attention`), or held back behind a stopped one of the same order (`blocked`).
 */

export type OpState = 'pending' | 'done' | 'attention' | 'blocked';

export interface OpError {
  code: SyncErrorCode;
  currentVersion: number | null;
  orderStatus: string | null;
  detail?: { expectedTotal: number; total: number };
}

export interface QueuedOp {
  /** The operation's id, also the record's key. */
  operationId: string;
  scope: Scope;
  /** Position in the scope's queue: operations are sent in this order. */
  seq: number;
  kind: OpKind;
  op: Op;
  state: OpState;
  attempts: number;
  lastError: OpError | null;
  /** What the server answered when it applied the operation. */
  result: Record<string, unknown> | null;
  doneAt: number | null;
  /** For an `openOrder`: the number shown until the server gives the real one. */
  provisional: string | null;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** An operation as the screens build it: the queue adds the id, the device and the time. */
export type OpDraft = DistributiveOmit<Op, 'operationId' | 'deviceId' | 'clientAt'>;

/** What identifies the order an operation belongs to: the operation that opened it, else its server id. */
export function orderKeys(queue: readonly QueuedOp[]): (q: QueuedOp) => string {
  const opened = new Map<string, string>();
  for (const q of queue) {
    const orderId = q.result?.orderId;
    if (q.kind === 'openOrder' && typeof orderId === 'string') opened.set(orderId, q.operationId);
  }
  return (q) => {
    if (q.op.kind === 'openOrder') return q.operationId;
    const ref = q.op.orderRef;
    if ('op' in ref) return ref.op;
    return opened.get(ref.id) ?? `id:${ref.id}`;
  };
}

export const refOf = (ref: OrderRef): string => ('id' in ref ? ref.id : ref.op);

async function nextProvisional(db: PosDb, id: string): Promise<string> {
  const n = ((await getValue<number>(db, 'meta', 'provisional')) ?? 0) + 1;
  await putValue(db, 'meta', 'provisional', n);
  return `P-${id.slice(0, 4).toUpperCase()}-${n}`;
}

/** Adds an operation to the end of the scope's queue and returns the stored record. */
export async function enqueue(db: PosDb, scope: Scope, draft: OpDraft, now: Date = new Date()): Promise<QueuedOp> {
  const device = await deviceId(db);
  const op = operationSchema.parse({ ...draft, operationId: crypto.randomUUID(), deviceId: device, clientAt: now.toISOString() });
  const provisional = op.kind === 'openOrder' ? await nextProvisional(db, device) : null;
  return updateQueue<QueuedOp, QueuedOp>(db, scope, (records) => {
    const seq = records.reduce((max, r) => Math.max(max, r.seq), 0) + 1;
    const record: QueuedOp = { operationId: op.operationId, scope, seq, kind: op.kind, op, state: 'pending', attempts: 0, lastError: null, result: null, doneAt: null, provisional };
    return { put: [record], value: record };
  });
}

export async function listQueue(db: PosDb, scope: Scope): Promise<QueuedOp[]> {
  return (await readQueue<QueuedOp>(db, scope)).sort((a, b) => a.seq - b.seq);
}

export interface QueueCounts {
  pending: number;
  attention: number;
  blocked: number;
  /** Operations of other people that wait on this device: counted, never shown. */
  otherScopes: number;
}

export async function counts(db: PosDb, scope: Scope): Promise<QueueCounts> {
  const queue = await listQueue(db, scope);
  return {
    pending: queue.filter((q) => q.state === 'pending').length,
    attention: queue.filter((q) => q.state === 'attention').length,
    blocked: queue.filter((q) => q.state === 'blocked').length,
    otherScopes: await countOtherScopes(db, scope),
  };
}

/** Records the server's answers: what applied, what stopped, and what waits behind a stopped operation. */
export async function recordAnswers(db: PosDb, scope: Scope, answers: readonly OpAnswer[], now: number): Promise<void> {
  const byId = new Map(answers.map((a) => [a.operationId, a]));
  await updateQueue<QueuedOp, void>(db, scope, (records) => {
    const touched = new Map<string, QueuedOp>();
    for (const record of records) {
      const answer = byId.get(record.operationId);
      if (!answer || record.state === 'done') continue;
      if (answer.status === 'done') {
        record.state = 'done';
        record.result = answer.result;
        record.doneAt = now;
        record.lastError = null;
        touched.set(record.operationId, record);
      } else if (answer.status === 'error') {
        record.state = 'attention';
        record.lastError = { code: answer.code, currentVersion: answer.currentVersion, orderStatus: answer.orderStatus, ...(answer.detail ? { detail: answer.detail } : {}) };
        touched.set(record.operationId, record);
      }
    }
    // A result may name a new order: later operations of it are keyed by the operation that opened it.
    const newKey = orderKeys(records);
    const stopped = new Set(records.filter((r) => r.state === 'attention').map(newKey));
    for (const record of records) {
      if (record.state === 'pending' && stopped.has(newKey(record))) {
        record.state = 'blocked';
        touched.set(record.operationId, record);
      }
    }
    return { put: [...touched.values()], value: undefined };
  });
}

/** Counts a failed attempt against the operations that were sent. */
export async function recordAttempt(db: PosDb, scope: Scope, operationIds: readonly string[]): Promise<number> {
  const ids = new Set(operationIds);
  return updateQueue<QueuedOp, number>(db, scope, (records) => {
    const hit = records.filter((r) => ids.has(r.operationId));
    for (const record of hit) record.attempts += 1;
    return { put: hit, value: hit.reduce((max, r) => Math.max(max, r.attempts), 0) };
  });
}

/** An operation that stopped goes back to waiting, with the operations it was holding back. */
export async function retry(db: PosDb, scope: Scope, operationId: string): Promise<void> {
  await updateQueue<QueuedOp, void>(db, scope, (records) => {
    const keyOf = orderKeys(records);
    const target = records.find((r) => r.operationId === operationId);
    if (!target || target.state !== 'attention') return { value: undefined };
    const key = keyOf(target);
    const put: QueuedOp[] = [];
    for (const record of records) {
      if (record.state === 'done' || keyOf(record) !== key) continue;
      if (record.operationId === operationId || record.state === 'blocked') {
        record.state = 'pending';
        record.attempts = 0;
        if (record.operationId === operationId) record.lastError = null;
        put.push(record);
      }
    }
    return { put, value: undefined };
  });
}

/**
 * For an operation that stopped because the order moved on (`stale`): send it again at the order's version now, and move
 * the later operations of that order by the same amount. The cashier has seen the order as it is and chosen this.
 */
export async function applyToCurrent(db: PosDb, scope: Scope, operationId: string, currentVersion: number): Promise<void> {
  await updateQueue<QueuedOp, void>(db, scope, (records) => {
    const keyOf = orderKeys(records);
    const target = records.find((r) => r.operationId === operationId);
    if (!target || target.state !== 'attention' || target.lastError?.code !== 'stale' || target.op.kind === 'openOrder') return { value: undefined };
    const delta = currentVersion - target.op.expectedVersion;
    const key = keyOf(target);
    const put: QueuedOp[] = [];
    for (const record of records) {
      if (record.state === 'done' || keyOf(record) !== key || record.seq < target.seq || record.op.kind === 'openOrder') continue;
      record.op = { ...record.op, expectedVersion: record.op.expectedVersion + delta } as Op;
      if (record.operationId === operationId) {
        record.state = 'pending';
        record.attempts = 0;
        record.lastError = null;
      } else if (record.state === 'blocked') record.state = 'pending';
      put.push(record);
    }
    return { put, value: undefined };
  });
}

/** Removes an operation that never reached the server, and the later operations of its order, which depended on it. */
export async function discardLocal(db: PosDb, scope: Scope, operationId: string): Promise<QueuedOp[]> {
  return updateQueue<QueuedOp, QueuedOp[]>(db, scope, (records) => {
    const keyOf = orderKeys(records);
    const target = records.find((r) => r.operationId === operationId);
    if (!target || target.state === 'done') return { value: [] };
    const key = keyOf(target);
    const gone = records.filter((r) => r.state !== 'done' && keyOf(r) === key && r.seq >= target.seq).sort((x, y) => x.seq - y.seq);
    return { remove: gone.map((r) => r.operationId), value: gone };
  });
}

const DAY_MS = 86_400_000;

/** Forgets applied operations older than a day. */
export async function pruneDone(db: PosDb, scope: Scope, now: number): Promise<number> {
  return updateQueue<QueuedOp, number>(db, scope, (records) => {
    const old = records.filter((r) => r.state === 'done' && r.doneAt !== null && now - r.doneAt > DAY_MS);
    return { remove: old.map((r) => r.operationId), value: old.length };
  });
}

// The read cache ----------------------------------------------------------------------------------------------------------

export interface StoredSnapshot {
  snapshot: SyncSnapshot;
  savedAt: number;
}

export const saveSnapshot = (db: PosDb, scope: Scope, snapshot: SyncSnapshot, savedAt: number) => putValue(db, 'snapshot', scope, { snapshot, savedAt } satisfies StoredSnapshot);
export const loadSnapshot = (db: PosDb, scope: Scope) => getValue<StoredSnapshot>(db, 'snapshot', scope);

/** Sign-out: the cached floor and orders go; the queue stays for the person to sync later. */
export const clearScopeCache = (db: PosDb, scope: Scope) => deleteValue(db, 'snapshot', scope);
