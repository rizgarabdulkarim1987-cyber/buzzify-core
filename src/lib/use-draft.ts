'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Unsaved work kept on this device while a person edits: a form's value, saved to IndexedDB under `userId:screen:id`
 * (`draftKey`) on every change, offered back when the screen opens again. It never reaches the server, and callers keep
 * anything transient out of it (a barcode scanner's buffer is the scan field's own state, never part of the value).
 * IndexedDB may be missing or refuse (a private window, storage blocked): the draft then lives in memory only and the
 * screen works the same.
 */

export const DRAFT_DB = 'buzzify-pharmacy-drafts';
export const DRAFT_STORE = 'drafts';

/** The key of a draft: who, which screen, which record (`new` for one not saved yet). */
export function draftKey(userId: string, screen: string, id: string): string {
  return `${userId}:${screen}:${id}`;
}

interface Stored<T> {
  value: T;
  savedAt: string;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const request = indexedDB.open(DRAFT_DB, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(DRAFT_STORE)) request.result.createObjectStore(DRAFT_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** One operation at a time, in the order asked: a save then a clear never lands the other way round. */
let queue: Promise<unknown> = Promise.resolve();

function withStore<R>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<R>): Promise<R | undefined> {
  const next = queue.then(() => runOnStore(mode, run));
  queue = next.catch(() => undefined);
  return next;
}

async function runOnStore<R>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<R>): Promise<R | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(DRAFT_STORE, mode);
      const request = run(tx.objectStore(DRAFT_STORE));
      tx.oncomplete = () => {
        db.close();
        resolve(request.result);
      };
      tx.onerror = tx.onabort = () => {
        db.close();
        resolve(undefined);
      };
    } catch {
      db.close();
      resolve(undefined);
    }
  });
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export interface Draft<T> {
  value: T;
  set(next: T): void;
  /** The value differs from where the screen started (or was last saved). */
  dirty: boolean;
  /**
   * The draft is done: the stored copy is removed, and `next` (default: the current value, as after a save) becomes
   * where the screen stands. Discarding passes the original.
   */
  clear(next?: T): void;
  /** A draft from an earlier visit was found and put back. */
  restored: boolean;
  /** When the restored draft was last changed (ISO), for the screen to say. */
  restoredAt: string | null;
}

export function useDraft<T>(key: string, initial: T): Draft<T> {
  const [value, setValue] = useState<T>(initial);
  const [baseline, setBaseline] = useState<T>(initial);
  const [restored, setRestored] = useState<{ at: string } | null>(null);
  // A change typed before the stored draft was read wins over it.
  const touched = useRef(false);

  useEffect(() => {
    let live = true;
    touched.current = false;
    void withStore<Stored<T> | undefined>('readonly', (store) => store.get(key)).then((found) => {
      if (!live || touched.current || !found || same(found.value, initial)) return;
      setValue(found.value);
      setRestored({ at: found.savedAt });
    });
    return () => {
      live = false;
    };
    // The draft is read once per key; `initial` of that key is the baseline it is compared with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const set = useCallback(
    (next: T) => {
      touched.current = true;
      setValue(next);
      const record: Stored<T> = { value: next, savedAt: new Date().toISOString() };
      void withStore('readwrite', (store): IDBRequest => (same(next, baseline) ? store.delete(key) : store.put(record, key)));
    },
    [key, baseline],
  );

  const clear = useCallback(
    (next?: T) => {
      touched.current = true;
      const settled = next === undefined ? value : next;
      setValue(settled);
      setBaseline(settled);
      setRestored(null);
      void withStore('readwrite', (store) => store.delete(key));
    },
    [key, value],
  );

  return { value, set, dirty: !same(value, baseline), clear, restored: restored !== null, restoredAt: restored?.at ?? null };
}
