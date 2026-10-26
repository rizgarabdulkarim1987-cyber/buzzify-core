import { OP_KINDS, type OpKind } from './op-schema';
import type { SyncSnapshot } from './snapshot';

/** How old the cached snapshot may be for the till to keep taking new operations offline. */
export const OFFLINE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export type Refusal = 'stale' | 'noShift' | 'forbidden' | 'onlineOnly';

/**
 * Whether the device may queue one more operation of this kind from what it holds. A refusal says why, so the screen can
 * tell the cashier. The server checks everything again at replay; this only keeps the queue from collecting what cannot work.
 */
export function canQueue(kind: string, state: { snapshot: SyncSnapshot; snapshotAt: number; now: number }): { ok: true } | { ok: false; reason: Refusal } {
  if (!(OP_KINDS as readonly string[]).includes(kind)) return { ok: false, reason: 'onlineOnly' };
  if (state.now - state.snapshotAt > OFFLINE_MAX_AGE_MS) return { ok: false, reason: 'stale' };
  const { can } = state.snapshot.user;
  const k = kind as OpKind;
  if (k === 'payCash') {
    if (!can.pay) return { ok: false, reason: 'forbidden' };
    if (!state.snapshot.openShift) return { ok: false, reason: 'noShift' };
  }
  if (k === 'cancelOrder' && !can.cancel) return { ok: false, reason: 'forbidden' };
  return { ok: true };
}
