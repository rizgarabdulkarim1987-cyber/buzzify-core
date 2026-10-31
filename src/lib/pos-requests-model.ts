import { canPos, type PosRole } from '@/server/domain/pos/permissions';

/** What a person may do with one waiting guest order on screen. The server actions check the same rules again. */
export interface RequestActions {
  /** Release an order held for the captain. */
  approve: boolean;
  /** Turn it into the table's order. Never while it is held for the captain. */
  accept: boolean;
  /** Change quantities, remove, add or replace dishes. */
  edit: boolean;
  reject: boolean;
}

export function requestActions(role: PosRole, request: { awaitingCaptain: boolean }): RequestActions {
  const handles = canPos(role, 'request.handle');
  return {
    approve: handles && request.awaitingCaptain && canPos(role, 'request.approve'),
    accept: handles && !request.awaitingCaptain && canPos(role, 'order.handle'),
    edit: handles,
    reject: handles,
  };
}

/**
 * The line shown on an order nobody on this screen can move on: held for the captain, approved and now with the cashier,
 * or simply waiting for the cashier when it never needed the captain.
 */
export function lockedNote(request: { awaitingCaptain: boolean; captainApproved: boolean }): 'pos.requests.awaitingHint' | 'pos.requests.withCashier' | 'pos.requests.waitingCashier' {
  if (request.awaitingCaptain) return 'pos.requests.awaitingHint';
  return request.captainApproved ? 'pos.requests.withCashier' : 'pos.requests.waitingCashier';
}

/**
 * The counts on the till's nav for guest orders and bill calls. A bill call is counted once: on the captain page for the
 * captain, with the guest orders for everyone else.
 */
export function requestBadges(role: PosRole, counts: { pendingRequests: number; billCalls: number }): { requests: number; captain: number } {
  if (role === 'CAPTAIN') return { requests: counts.pendingRequests, captain: counts.billCalls };
  return { requests: counts.pendingRequests + counts.billCalls, captain: 0 };
}
