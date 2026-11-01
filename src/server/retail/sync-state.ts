import { failedPermanently } from './sender';

/** What the Studio's Retail screens show about delivery to Buzzify Retail, derived from the link and its outbox row. */
export type RetailSyncState =
  | { kind: 'synced'; version: number }
  | { kind: 'waitingOwner' }
  | { kind: 'waitingSubscription' }
  | { kind: 'retrying'; attempts: number; nextAttemptAt: Date; code: string | null }
  /** `permanent`: Retails refused the content, so only a change or Resync sends it again (the reconcile does not). */
  | { kind: 'failed'; code: string | null; permanent: boolean }
  | { kind: 'queued'; nextAttemptAt: Date | null }
  | { kind: 'notProvisioned' };

export interface SyncLink {
  retailBusinessId: string | null;
  stateVersion: number;
  acceptedVersion: number;
}

export interface SyncOutbox {
  attempts: number;
  nextAttemptAt: Date;
  waitingFor: string | null;
  lastError: string | null;
  failedAt: Date | null;
}

/** The delivery state of one shop. Pure: the rows say it all, there is no clock. */
export function deriveSyncState(link: SyncLink, outbox: SyncOutbox | null): RetailSyncState {
  if (outbox) {
    if (outbox.waitingFor === 'OWNER') return { kind: 'waitingOwner' };
    if (outbox.waitingFor === 'SUBSCRIPTION') return { kind: 'waitingSubscription' };
    if (outbox.failedAt) return { kind: 'failed', code: outbox.lastError, permanent: failedPermanently(outbox) };
    if (outbox.attempts > 0) return { kind: 'retrying', attempts: outbox.attempts, nextAttemptAt: outbox.nextAttemptAt, code: outbox.lastError };
    return { kind: 'queued', nextAttemptAt: outbox.nextAttemptAt };
  }
  if (link.retailBusinessId === null && link.stateVersion === 0) return { kind: 'notProvisioned' };
  if (link.acceptedVersion === link.stateVersion && link.retailBusinessId !== null) return { kind: 'synced', version: link.acceptedVersion };
  return link.retailBusinessId === null ? { kind: 'notProvisioned' } : { kind: 'queued', nextAttemptAt: null };
}

/** AI reads are counted in half units (a half read is 1); the screens show units. */
export function aiUnitsOf(halfUnits: number | null): number | null {
  return halfUnits === null ? null : halfUnits / 2;
}
