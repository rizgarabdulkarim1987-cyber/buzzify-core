import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { closePosDb, deviceId, openPosDb, type PosDb } from '@/lib/pos-sync/idb';
import type { Op, OpAnswer } from '@/lib/pos-sync/op-schema';
import {
  applyToCurrent,
  clearScopeCache,
  counts,
  discardLocal,
  enqueue,
  listQueue,
  loadSnapshot,
  pruneDone,
  retry,
  saveSnapshot,
  type OpDraft,
} from '@/lib/pos-sync/queue';
import { backoffDelay, replayUntilIdle, runReplayPass, withSyncLock, type Transport, type TransportResult } from '@/lib/pos-sync/replay';
import type { SyncSnapshot } from '@/lib/pos-sync/snapshot';

const A = 'rest1:user1';
const B = 'rest1:user2';

let factory: IDBFactory;
let db: PosDb;

beforeEach(async () => {
  factory = new IDBFactory();
  db = await openPosDb(factory);
});

const open = (tableId = 't1'): OpDraft => ({ kind: 'openOrder', payload: { tableId } });
const line = (op: string, expectedVersion: number): OpDraft => ({ kind: 'addLine', orderRef: { op }, expectedVersion, payload: { productId: 'p1', quantity: 1, note: '', optionIds: [] } });
const onServerOrder = (kind: 'sendToKitchen' | 'requestBill', id: string, expectedVersion: number): OpDraft => ({ kind, orderRef: { id }, expectedVersion, payload: {} });
const pay = (op: string, expectedVersion: number): OpDraft => ({ kind: 'payCash', orderRef: { op }, expectedVersion, payload: { expectedTotal: 5000, amountReceived: 5000 } });

const done = (op: Op, result: Record<string, unknown> = {}): OpAnswer => ({ operationId: op.operationId, status: 'done', replayed: false, result });
const fail = (op: Op, code: 'stale' | 'locked' = 'stale', extra: object = {}): OpAnswer => ({ operationId: op.operationId, status: 'error', code, currentVersion: null, orderStatus: null, ...extra });
const answering = (make: (ops: Op[]) => OpAnswer[]): Transport => async (_device, ops) => ({ kind: 'answers', answers: make(ops), serverTime: new Date().toISOString() });
const states = async (scope = A) => (await listQueue(db, scope)).map((q) => q.state);

describe('the queue', () => {
  it('keeps the order of operations across a reopened database', async () => {
    const first = await enqueue(db, A, open());
    await enqueue(db, A, line(first.operationId, 1));
    closePosDb(db);
    db = await openPosDb(factory);
    expect((await listQueue(db, A)).map((q) => [q.seq, q.kind])).toEqual([[1, 'openOrder'], [2, 'addLine']]);
  });

  it('keeps one scope away from another and counts what waits for someone else', async () => {
    await enqueue(db, A, open());
    await enqueue(db, B, open('t2'));
    await enqueue(db, B, open('t3'));
    expect(await listQueue(db, A)).toHaveLength(1);
    expect(await counts(db, A)).toEqual({ pending: 1, attention: 0, blocked: 0, otherScopes: 2 });
  });

  it('gives each operation an id, the device id and the time, and a provisional number to an opened order', async () => {
    const q = await enqueue(db, A, open(), new Date('2026-10-25T08:00:00Z'));
    expect(q.op).toMatchObject({ deviceId: await deviceId(db), clientAt: '2026-10-25T08:00:00.000Z' });
    expect(q.provisional).toMatch(/^P-[0-9A-F]{4}-1$/);
    expect((await enqueue(db, A, open('t2'))).provisional).toMatch(/-2$/);
    expect(await deviceId(db)).toBe(await deviceId(db));
  });

  it('refuses an operation the server would not read', async () => {
    await expect(enqueue(db, A, { kind: 'payCash', orderRef: { id: 'o' }, expectedVersion: 1, payload: { expectedTotal: 1.5, amountReceived: 2 } })).rejects.toThrow();
  });

  it('stores no cookie, token or password anywhere', async () => {
    const q = await enqueue(db, A, open());
    await enqueue(db, A, pay(q.operationId, 1));
    expect(JSON.stringify(await listQueue(db, A))).not.toMatch(/cookie|token|password/i);
  });

  it('forgets applied operations after a day, and only those', async () => {
    const a = await enqueue(db, A, open());
    await enqueue(db, A, open('t2'));
    await runReplayPass(db, A, answering((ops) => [done(ops[0]!, { orderId: 'o1' })]), () => 1_000);
    expect(await pruneDone(db, A, 1_000 + 86_400_000)).toBe(0);
    expect(await pruneDone(db, A, 1_000 + 86_400_001)).toBe(1);
    expect((await listQueue(db, A)).map((q) => q.operationId)).not.toContain(a.operationId);
  });

  it('drops the cached snapshot of a scope and keeps its queue', async () => {
    await enqueue(db, A, open());
    await saveSnapshot(db, A, { restaurantId: 'r' } as SyncSnapshot, 5);
    expect((await loadSnapshot(db, A))?.savedAt).toBe(5);
    await clearScopeCache(db, A);
    expect(await loadSnapshot(db, A)).toBeUndefined();
    expect(await listQueue(db, A)).toHaveLength(1);
  });
});

describe('replay', () => {
  it('sends the waiting operations in order in one batch and files each answer', async () => {
    const o = await enqueue(db, A, open());
    await enqueue(db, A, line(o.operationId, 1));
    await enqueue(db, A, pay(o.operationId, 2));
    const seen: string[][] = [];
    const result = await runReplayPass(db, A, answering((ops) => (seen.push(ops.map((x) => x.kind)), ops.map((x) => done(x, x.kind === 'openOrder' ? { orderId: 'srv1', number: 7, version: 1 } : {})))));
    expect(seen).toEqual([['openOrder', 'addLine', 'payCash']]);
    expect(result).toMatchObject({ state: 'idle', sent: 3 });
    expect(await states()).toEqual(['done', 'done', 'done']);
    expect((await listQueue(db, A))[0]?.result).toMatchObject({ orderId: 'srv1', number: 7 });
  });

  it('sends nothing when nothing waits', async () => {
    let calls = 0;
    const result = await runReplayPass(db, A, async () => (calls++, { kind: 'network' }));
    expect(result).toEqual({ state: 'idle', sent: 0, nextDelayMs: null });
    expect(calls).toBe(0);
  });

  it('backs off 1 s, 2 s, 4 s on a network failure, never past a minute, and loses nothing', async () => {
    await enqueue(db, A, open());
    const down: Transport = async () => ({ kind: 'network' });
    const delays: (number | null)[] = [];
    for (let i = 0; i < 3; i++) delays.push((await runReplayPass(db, A, down)).nextDelayMs);
    expect(delays).toEqual([1000, 2000, 4000]);
    expect(backoffDelay(20)).toBe(60_000);
    expect(await states()).toEqual(['pending']);
    expect((await runReplayPass(db, A, async () => ({ kind: 'server' } as TransportResult))).state).toBe('backoff');
  });

  it('stops and touches nothing when the session is gone', async () => {
    await enqueue(db, A, open());
    expect((await runReplayPass(db, A, async () => ({ kind: 'signedOut' }))).state).toBe('signedOut');
    expect(await states()).toEqual(['pending']);
  });

  it('stops an order on an error, holds its later operations, and goes on with another order', async () => {
    const o1 = await enqueue(db, A, open('t1'));
    await enqueue(db, A, line(o1.operationId, 1));
    const o2 = await enqueue(db, A, open('t2'));
    await enqueue(db, A, line(o2.operationId, 1));
    await runReplayPass(
      db,
      A,
      answering((ops) => ops.map((x) => (x.operationId === o1.operationId ? fail(x, 'locked', { orderStatus: 'CANCELLED' }) : x.kind === 'addLine' && 'op' in x.orderRef && x.orderRef.op === o1.operationId ? { operationId: x.operationId, status: 'skipped' } : done(x, { orderId: `srv-${x.operationId.slice(0, 4)}` })))),
    );
    expect(await states()).toEqual(['attention', 'blocked', 'done', 'done']);
    expect((await listQueue(db, A))[0]?.lastError).toMatchObject({ code: 'locked', orderStatus: 'CANCELLED' });
    // The next pass sends nothing for the stopped order.
    const sent: string[] = [];
    await runReplayPass(db, A, answering((ops) => (sent.push(...ops.map((x) => x.kind)), [])));
    expect(sent).toEqual([]);
  });

  it('holds the operations that name a server order by the id an earlier operation returned', async () => {
    const o = await enqueue(db, A, open());
    await runReplayPass(db, A, answering((ops) => ops.map((x) => done(x, { orderId: 'srv1' }))));
    const bill = await enqueue(db, A, onServerOrder('requestBill', 'srv1', 1));
    await runReplayPass(db, A, answering((ops) => ops.map((x) => fail(x, 'stale', { currentVersion: 3 }))));
    expect((await listQueue(db, A)).find((q) => q.operationId === bill.operationId)?.state).toBe('attention');
    expect(o.operationId).not.toBe(bill.operationId);
  });

  it('retry sends the same operation again and frees the ones it held', async () => {
    const o = await enqueue(db, A, open());
    await enqueue(db, A, line(o.operationId, 1));
    await runReplayPass(db, A, answering((ops) => [fail(ops[0]!, 'locked')]));
    expect(await states()).toEqual(['attention', 'blocked']);
    await retry(db, A, o.operationId);
    expect(await states()).toEqual(['pending', 'pending']);
  });

  it('applyToCurrent re-sends a stale operation at the version now and shifts the later ones the same way', async () => {
    const o = await enqueue(db, A, open());
    await runReplayPass(db, A, answering((ops) => ops.map((x) => done(x, { orderId: 'srv1' }))));
    const add = await enqueue(db, A, { kind: 'addLine', orderRef: { id: 'srv1' }, expectedVersion: 1, payload: { productId: 'p1', quantity: 1, note: '', optionIds: [] } });
    await enqueue(db, A, onServerOrder('sendToKitchen', 'srv1', 2));
    await enqueue(db, A, { kind: 'payCash', orderRef: { id: 'srv1' }, expectedVersion: 3, payload: { expectedTotal: 5000, amountReceived: 5000 } });
    await runReplayPass(db, A, answering((ops) => [fail(ops[0]!, 'stale', { currentVersion: 4 })]));
    expect(await states()).toEqual(['done', 'attention', 'blocked', 'blocked']);
    await applyToCurrent(db, A, add.operationId, 4);
    const after = await listQueue(db, A);
    expect(after.map((q) => q.state)).toEqual(['done', 'pending', 'pending', 'pending']);
    expect(after.slice(1).map((q) => ('expectedVersion' in q.op ? q.op.expectedVersion : 0))).toEqual([4, 5, 6]);
    expect(o.state).toBe('pending');
  });

  it('applyToCurrent does nothing for an operation that did not go stale', async () => {
    const o = await enqueue(db, A, open());
    const l = await enqueue(db, A, line(o.operationId, 1));
    await runReplayPass(db, A, answering((ops) => [done(ops[0]!, {}), fail(ops[1]!, 'locked')]));
    await applyToCurrent(db, A, l.operationId, 9);
    expect((await listQueue(db, A))[1]?.state).toBe('attention');
  });

  it('discarding an opened order takes its later operations with it, never an applied one', async () => {
    const o = await enqueue(db, A, open());
    await enqueue(db, A, line(o.operationId, 1));
    const other = await enqueue(db, A, open('t2'));
    const gone = await discardLocal(db, A, o.operationId);
    expect(gone.map((q) => q.kind)).toEqual(['openOrder', 'addLine']);
    expect((await listQueue(db, A)).map((q) => q.operationId)).toEqual([other.operationId]);
    await runReplayPass(db, A, answering((ops) => ops.map((x) => done(x))));
    expect(await discardLocal(db, A, other.operationId)).toEqual([]);
  });

  it('replays until the queue is empty, 25 at a time, and sends each operation once under two concurrent passes', async () => {
    for (let i = 0; i < 30; i++) await enqueue(db, A, open(`t${i}`));
    const batches: number[] = [];
    const transport = answering((ops) => (batches.push(ops.length), ops.map((x) => done(x, { orderId: x.operationId }))));
    const [first, second] = await Promise.all([
      withSyncLock(() => replayUntilIdle(db, A, transport)),
      withSyncLock(() => replayUntilIdle(db, A, transport)),
    ]);
    expect(batches).toEqual([25, 5]);
    expect(first.sent + second.sent).toBe(30);
    expect(await counts(db, A)).toMatchObject({ pending: 0, attention: 0, blocked: 0 });
  });

  it('treats an answer that was already stored on the server as done', async () => {
    await enqueue(db, A, open());
    await runReplayPass(db, A, answering((ops) => [{ operationId: ops[0]!.operationId, status: 'done', replayed: true, result: { orderId: 'srv1' } }]));
    expect(await states()).toEqual(['done']);
  });
});
