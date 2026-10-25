import type { PosDb } from './idb';
import { deviceId } from './idb';
import { MAX_BATCH, type Op, type OpAnswer } from './op-schema';
import { listQueue, orderKeys, recordAnswers, recordAttempt } from './queue';
import type { Scope } from './scope';

/**
 * Sends the queue to the server in order and files the answers. The pass is the same wherever the transport comes from, so
 * it runs against a fake in tests. The server decides every conflict; nothing here resolves one.
 */

export type TransportResult =
  | { kind: 'answers'; answers: OpAnswer[]; serverTime: string }
  | { kind: 'signedOut' }
  | { kind: 'network' }
  | { kind: 'server' };

export type Transport = (deviceId: string, operations: Op[]) => Promise<TransportResult>;

export interface PassResult {
  /** `idle`: nothing was left to send or the batch went through; `backoff`: try again after `nextDelayMs`; `signedOut`: wait for a sign-in. */
  state: 'idle' | 'signedOut' | 'backoff';
  sent: number;
  nextDelayMs: number | null;
}

const MAX_DELAY_MS = 60_000;

/** One second, then two, four... up to a minute: the wait after the n-th failed attempt in a row. */
export function backoffDelay(attempts: number): number {
  return Math.min(MAX_DELAY_MS, 1000 * 2 ** Math.max(0, attempts - 1));
}

/** One batch: up to 25 waiting operations in queue order, those of an order that is stopped left out. */
export async function runReplayPass(db: PosDb, scope: Scope, transport: Transport, now: () => number = Date.now): Promise<PassResult> {
  const queue = await listQueue(db, scope);
  const keyOf = orderKeys(queue);
  const stopped = new Set(queue.filter((q) => q.state === 'attention' || q.state === 'blocked').map(keyOf));
  const batch = queue.filter((q) => q.state === 'pending' && !stopped.has(keyOf(q))).slice(0, MAX_BATCH);
  if (batch.length === 0) return { state: 'idle', sent: 0, nextDelayMs: null };

  const outcome = await transport(batch[0]!.op.deviceId, batch.map((q) => q.op));
  if (outcome.kind === 'signedOut') return { state: 'signedOut', sent: 0, nextDelayMs: null };
  if (outcome.kind !== 'answers') {
    const attempts = await recordAttempt(db, scope, batch.map((q) => q.operationId));
    return { state: 'backoff', sent: 0, nextDelayMs: backoffDelay(attempts) };
  }
  await recordAnswers(db, scope, outcome.answers, now());
  return { state: 'idle', sent: batch.length, nextDelayMs: null };
}

/** Passes one after another until nothing is left to send, or one has to wait. */
export async function replayUntilIdle(db: PosDb, scope: Scope, transport: Transport, now: () => number = Date.now): Promise<PassResult> {
  let total = 0;
  for (;;) {
    const pass = await runReplayPass(db, scope, transport, now);
    total += pass.sent;
    if (pass.state !== 'idle' || pass.sent === 0) return { ...pass, sent: total };
  }
}

// One pass at a time ------------------------------------------------------------------------------------------------------

let chain: Promise<unknown> = Promise.resolve();

/**
 * Runs `fn` after every earlier call has finished, here and, where the browser has Web Locks, in the device's other tabs
 * too, so one queue is never sent twice at once.
 */
export function withSyncLock<T>(fn: () => Promise<T>): Promise<T> {
  const locked = (): Promise<T> => {
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
    return locks ? (locks.request('buzzify-pos-sync', fn) as Promise<T>) : fn();
  };
  const next: Promise<T> = chain.then(locked, locked);
  chain = next.catch(() => undefined);
  return next;
}

export { deviceId };
