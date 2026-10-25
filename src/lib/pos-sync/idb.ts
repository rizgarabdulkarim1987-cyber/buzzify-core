import type { Scope } from './scope';

/**
 * The till device's own store: three object stores in one IndexedDB database, no library. `meta` holds the device id and
 * the provisional counter, `queue` the operations (indexed by scope), `snapshot` the read cache (one per scope). Every
 * multi-record change runs in one transaction, so a tab closing in the middle leaves the queue as it was.
 */

export const DB_NAME = 'buzzify-pos';
const VERSION = 1;

export type StoreName = 'meta' | 'queue' | 'snapshot';

export interface PosDb {
  readonly raw: IDBDatabase;
}

function wrap<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/** Opens (and on first use creates) the store. `factory` is the browser's `indexedDB`, or a fake in tests. */
export async function openPosDb(factory: IDBFactory = indexedDB, name: string = DB_NAME): Promise<PosDb> {
  const request = factory.open(name, VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    db.createObjectStore('meta');
    db.createObjectStore('queue', { keyPath: 'operationId' }).createIndex('scope', 'scope');
    db.createObjectStore('snapshot');
  };
  return { raw: await wrap(request) };
}

export function closePosDb(db: PosDb): void {
  db.raw.close();
}

export async function getValue<T>(db: PosDb, store: StoreName, key: string): Promise<T | undefined> {
  return (await wrap(db.raw.transaction(store, 'readonly').objectStore(store).get(key))) as T | undefined;
}

export async function putValue(db: PosDb, store: StoreName, key: string, value: unknown): Promise<void> {
  const tx = db.raw.transaction(store, 'readwrite');
  tx.objectStore(store).put(value, key);
  await finished(tx);
}

export async function deleteValue(db: PosDb, store: StoreName, key: string): Promise<void> {
  const tx = db.raw.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  await finished(tx);
}

/** The device id: made once, kept for good. */
export async function deviceId(db: PosDb): Promise<string> {
  const known = await getValue<string>(db, 'meta', 'deviceId');
  if (known) return known;
  const made = crypto.randomUUID();
  const tx = db.raw.transaction('meta', 'readwrite');
  const store = tx.objectStore('meta');
  // Two tabs opening for the first time: the first write wins, both read it back.
  const existing = await wrap(store.get('deviceId'));
  if (existing === undefined) store.put(made, 'deviceId');
  await finished(tx);
  return ((await getValue<string>(db, 'meta', 'deviceId')) ?? made);
}

/**
 * Reads every queue record of the scope, lets `change` edit them, and writes the edits back, all in one transaction.
 * `change` returns what to write and what to delete; it runs synchronously on the records it was given.
 */
export async function updateQueue<Q extends { operationId: string }, R>(
  db: PosDb,
  scope: Scope,
  change: (records: Q[]) => { put?: Q[]; remove?: string[]; value: R },
): Promise<R> {
  const tx = db.raw.transaction('queue', 'readwrite');
  const store = tx.objectStore('queue');
  const records = (await wrap(store.index('scope').getAll(scope))) as Q[];
  const outcome = change(records);
  for (const record of outcome.put ?? []) store.put(record);
  for (const id of outcome.remove ?? []) store.delete(id);
  await finished(tx);
  return outcome.value;
}

export async function readQueue<Q>(db: PosDb, scope: Scope): Promise<Q[]> {
  return (await wrap(db.raw.transaction('queue', 'readonly').objectStore('queue').index('scope').getAll(scope))) as Q[];
}

/** How many queue records belong to scopes other than this one, without reading what they hold. */
export async function countOtherScopes(db: PosDb, scope: Scope): Promise<number> {
  const total = await wrap(db.raw.transaction('queue', 'readonly').objectStore('queue').count());
  const own = await wrap(db.raw.transaction('queue', 'readonly').objectStore('queue').index('scope').count(scope));
  return total - own;
}
