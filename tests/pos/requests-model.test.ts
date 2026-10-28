import { describe, expect, it } from 'vitest';
import { requestActions, requestBadges } from '@/lib/pos-requests-model';

describe('requests screen model', () => {
  it('a cashier cannot accept or approve an order held for the captain, but may still trim or reject it', () => {
    expect(requestActions('CASHIER', { awaitingCaptain: true })).toEqual({ approve: false, accept: false, edit: true, reject: true });
  });

  it('a cashier accepts an order that is not held', () => {
    expect(requestActions('CASHIER', { awaitingCaptain: false })).toEqual({ approve: false, accept: true, edit: true, reject: true });
  });

  it('the captain approves a held order and never accepts', () => {
    expect(requestActions('CAPTAIN', { awaitingCaptain: true })).toEqual({ approve: true, accept: false, edit: true, reject: true });
    expect(requestActions('CAPTAIN', { awaitingCaptain: false })).toEqual({ approve: false, accept: false, edit: true, reject: true });
  });

  it('a manager or owner approves a held order, then accepts it', () => {
    for (const role of ['MANAGER', 'OWNER'] as const) {
      expect(requestActions(role, { awaitingCaptain: true })).toEqual({ approve: true, accept: false, edit: true, reject: true });
      expect(requestActions(role, { awaitingCaptain: false })).toEqual({ approve: false, accept: true, edit: true, reject: true });
    }
  });

  it('the kitchen does nothing with guest orders', () => {
    expect(requestActions('KITCHEN', { awaitingCaptain: true })).toEqual({ approve: false, accept: false, edit: false, reject: false });
    expect(requestActions('KITCHEN', { awaitingCaptain: false })).toEqual({ approve: false, accept: false, edit: false, reject: false });
  });
});

describe('till nav badges', () => {
  const counts = { pendingRequests: 2, billCalls: 3 };

  it('the captain sees bill calls on the captain page only', () => {
    expect(requestBadges('CAPTAIN', counts)).toEqual({ requests: 2, captain: 3 });
  });

  it('everyone else sees bill calls with the guest orders, never twice', () => {
    for (const role of ['OWNER', 'MANAGER', 'CASHIER'] as const) expect(requestBadges(role, counts)).toEqual({ requests: 5, captain: 0 });
  });
});
