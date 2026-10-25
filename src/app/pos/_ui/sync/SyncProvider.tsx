'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { canQueue, type Refusal } from '@/lib/pos-sync/guards';
import { indicatorState, type IndicatorState } from '@/lib/pos-sync/indicator';
import { deleteValue, deviceId, getValue, openPosDb, putValue, type PosDb } from '@/lib/pos-sync/idb';
import { MAX_BATCH, type Op } from '@/lib/pos-sync/op-schema';
import { applyToCurrent, clearScopeCache, counts, discardLocal, enqueue, listQueue, loadSnapshot, pruneDone, retry, saveSnapshot, type OpDraft, type QueueCounts, type QueuedOp } from '@/lib/pos-sync/queue';
import { replayUntilIdle, withSyncLock, type Transport } from '@/lib/pos-sync/replay';
import { scopeOf, type Scope } from '@/lib/pos-sync/scope';
import type { SyncSnapshot } from '@/lib/pos-sync/snapshot';

const SNAPSHOT_EVERY_MS = 60_000;
const RETRY_EVERY_MS = 15_000;

export interface SyncApi {
  /** `loading` until the first read of the device store; `none` when this person has no till or nothing was ever cached. */
  ready: boolean;
  online: boolean;
  syncing: boolean;
  signedOut: boolean;
  state: IndicatorState;
  scope: Scope | null;
  snapshot: SyncSnapshot | null;
  snapshotAt: number | null;
  queue: QueuedOp[];
  counts: QueueCounts;
  /** Adds an operation to the queue (and sends it at once when online), or says why it cannot be queued. */
  enqueue(draft: OpDraft): Promise<{ ok: true; op: QueuedOp } | { ok: false; reason: Refusal }>;
  syncNow(): void;
  refresh(): Promise<void>;
  retry(operationId: string): Promise<void>;
  applyToCurrent(operationId: string, currentVersion: number): Promise<void>;
  /** Discards a queued operation (and what depended on it). Posts the record to the server first; needs the network. */
  discard(operationId: string, reason: string): Promise<{ ok: boolean }>;
}

const EMPTY: QueueCounts = { pending: 0, attention: 0, blocked: 0, otherScopes: 0 };
const Context = createContext<SyncApi | null>(null);

export function useSync(): SyncApi {
  const value = useContext(Context);
  if (!value) throw new Error('useSync needs a SyncProvider');
  return value;
}

/** The sync state when a screen may sit outside the provider (the sign-out button of another area): nothing waits. */
export function useSyncOptional(): SyncApi | null {
  return useContext(Context);
}

type Fetched = { kind: 'ok'; snapshot: SyncSnapshot } | { kind: 'signedOut' } | { kind: 'noTill' } | { kind: 'network' };

async function fetchSnapshot(): Promise<Fetched> {
  try {
    const response = await fetch('/api/pos/sync/snapshot', { cache: 'no-store', credentials: 'same-origin' });
    if (response.status === 401) return { kind: 'signedOut' };
    if (response.status === 403 || response.status === 404) return { kind: 'noTill' };
    if (!response.ok) return { kind: 'network' };
    const body = (await response.json()) as { data?: SyncSnapshot };
    return body.data ? { kind: 'ok', snapshot: body.data } : { kind: 'network' };
  } catch {
    return { kind: 'network' };
  }
}

/** The transport for one person's queue: the server refuses the batch when someone else is signed in by now. */
const transportFor = (scope: Scope): Transport => async (device, operations: Op[]) => {
  try {
    const response = await fetch('/api/pos/sync', {
      signal: AbortSignal.timeout(20_000),
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify({ scope, deviceId: device, operations: operations.slice(0, MAX_BATCH) }),
    });
    // 409: another person is signed in; 403: this one has lost the till. Either way the queue waits for the right sign-in.
    if (response.status === 401 || response.status === 403 || response.status === 409) return { kind: 'signedOut' };
    if (response.status >= 500) return { kind: 'server' };
    if (!response.ok) return { kind: 'server' };
    const body = (await response.json()) as { serverTime: string; answers: never[] };
    return { kind: 'answers', answers: body.answers, serverTime: body.serverTime };
  } catch {
    return { kind: 'network' };
  }
};

/**
 * The till device's connection to the server: it keeps the read cache fresh while online, holds the queue, and sends it
 * whenever the network is there. Everything it knows lives in IndexedDB, so a reload or a closed tab loses nothing.
 */
export function SyncProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<PosDb | null>(null);
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [scope, setScope] = useState<Scope | null>(null);
  const [snapshot, setSnapshot] = useState<SyncSnapshot | null>(null);
  const [snapshotAt, setSnapshotAt] = useState<number | null>(null);
  const [queue, setQueue] = useState<QueuedOp[]>([]);
  const [tally, setTally] = useState<QueueCounts>(EMPTY);
  const scopeRef = useRef<Scope | null>(null);
  const retryTimer = useRef<number | null>(null);

  const reload = useCallback(async (handle: PosDb, forScope: Scope | null) => {
    if (!forScope) return;
    const [list, c] = await Promise.all([listQueue(handle, forScope), counts(handle, forScope)]);
    setQueue(list);
    setTally(c);
  }, []);

  /** Reads the snapshot from the server when it can, else from the device. Decides whose queue this is. */
  const refresh = useCallback(async () => {
    if (!db) return;
    const fetched = await fetchSnapshot();
    if (fetched.kind === 'ok') {
      const next = scopeOf(fetched.snapshot.restaurantId, fetched.snapshot.user.id);
      const now = Date.now();
      await saveSnapshot(db, next, fetched.snapshot, now);
      await putValue(db, 'meta', 'lastScope', next);
      scopeRef.current = next;
      setScope(next);
      setSnapshot(fetched.snapshot);
      setSnapshotAt(now);
      setOnline(true);
      setSignedOut(false);
      await reload(db, next);
      return;
    }
    setOnline(fetched.kind !== 'network');
    setSignedOut(fetched.kind === 'signedOut');
    if (fetched.kind === 'noTill') return;
    const known = scopeRef.current ?? (await getValue<string>(db, 'meta', 'lastScope')) ?? null;
    const waiting = known && fetched.kind === 'signedOut' ? await counts(db, known) : null;
    if (known && waiting && waiting.pending + waiting.blocked + waiting.attention === 0) {
      // Signed out with nothing waiting: the next person at this device must not read this one's floor and orders.
      await clearScopeCache(db, known);
      await deleteValue(db, 'meta', 'lastScope');
      scopeRef.current = null;
      setScope(null);
      setSnapshot(null);
      setSnapshotAt(null);
      setQueue([]);
      setTally(EMPTY);
      return;
    }
    if (known) {
      scopeRef.current = known;
      setScope(known);
      const stored = await loadSnapshot(db, known);
      if (stored) {
        setSnapshot(stored.snapshot);
        setSnapshotAt(stored.savedAt);
      }
      await reload(db, known);
    }
  }, [db, reload]);

  const sync = useCallback(async () => {
    if (!db || !scopeRef.current) return;
    const forScope = scopeRef.current;
    setSyncing(true);
    try {
      const pass = await withSyncLock(() => replayUntilIdle(db, forScope, transportFor(forScope)));
      if (pass.state === 'signedOut') setSignedOut(true);
      else if (pass.state === 'backoff') {
        setOnline(false);
        if (retryTimer.current) window.clearTimeout(retryTimer.current);
        retryTimer.current = window.setTimeout(() => void sync(), pass.nextDelayMs ?? RETRY_EVERY_MS);
      } else if (pass.sent > 0) {
        await pruneDone(db, forScope, Date.now());
        await refresh();
      }
      await reload(db, forScope);
    } finally {
      setSyncing(false);
    }
  }, [db, refresh, reload]);

  useEffect(() => {
    let alive = true;
    void openPosDb().then((handle) => {
      if (alive) setDb(handle);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!db) return;
    // Starting the first read is the effect's whole job; it sets state only once the device store has answered.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh().then(() => {
      setReady(true);
      void sync();
    });
  }, [db, refresh, sync]);

  useEffect(() => {
    if (!db) return;
    const goOnline = () => {
      setOnline(true);
      void refresh().then(() => sync());
    };
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    const timer = window.setInterval(() => {
      if (navigator.onLine) void refresh().then(() => sync());
    }, SNAPSHOT_EVERY_MS);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      window.clearInterval(timer);
      if (retryTimer.current) window.clearTimeout(retryTimer.current);
    };
  }, [db, refresh, sync]);

  const api = useMemo<SyncApi>(
    () => ({
      ready,
      online,
      syncing,
      signedOut,
      state: indicatorState({ online, syncing, signedOut, pending: tally.pending + tally.blocked, attention: tally.attention }),
      scope,
      snapshot,
      snapshotAt,
      queue,
      counts: tally,
      async enqueue(draft) {
        if (!db || !scopeRef.current || !snapshot || snapshotAt === null) return { ok: false, reason: 'stale' };
        const verdict = canQueue(draft.kind, { snapshot, snapshotAt, now: Date.now() });
        if (!verdict.ok) return verdict;
        const op = await enqueue(db, scopeRef.current, draft);
        await reload(db, scopeRef.current);
        if (navigator.onLine) void sync();
        return { ok: true, op };
      },
      syncNow: () => void refresh().then(() => sync()),
      refresh,
      async retry(operationId) {
        if (!db || !scopeRef.current) return;
        await retry(db, scopeRef.current, operationId);
        await reload(db, scopeRef.current);
        void sync();
      },
      async applyToCurrent(operationId, currentVersion) {
        if (!db || !scopeRef.current) return;
        await applyToCurrent(db, scopeRef.current, operationId, currentVersion);
        await reload(db, scopeRef.current);
        void sync();
      },
      async discard(operationId, reason) {
        if (!db || !scopeRef.current) return { ok: false };
        const forScope = scopeRef.current;
        return withSyncLock(async () => {
        // Under the lock no send is in flight: what is still waiting here has not reached the server.
        const target = (await listQueue(db, forScope)).find((q) => q.operationId === operationId);
        if (!target || target.state === 'done') return { ok: false };
        const amount = target.op.kind === 'payCash' ? target.op.payload.amountReceived : undefined;
        const lines = target.op.kind === 'addLine' ? target.op.payload.quantity : undefined;
        try {
          const response = await fetch('/api/pos/sync/discard', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
              operationId,
              deviceId: await deviceId(db),
              kind: target.kind,
              clientAt: target.op.clientAt,
              summary: { ...(amount !== undefined ? { amount } : {}), ...(lines !== undefined ? { lines } : {}) },
              reason,
            }),
          });
          if (!response.ok) return { ok: false };
        } catch {
          return { ok: false };
        }
        await discardLocal(db, forScope, operationId);
        await reload(db, forScope);
        return { ok: true };
        });
      },
    }),
    [db, ready, online, syncing, signedOut, tally, scope, snapshot, snapshotAt, queue, refresh, reload, sync],
  );

  return <Context.Provider value={api}>{children}</Context.Provider>;
}
