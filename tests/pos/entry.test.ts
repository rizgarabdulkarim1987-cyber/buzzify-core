import { describe, expect, it } from 'vitest';
import type { PosActor } from '@/server/pos/actor';
import { POS_SIGN_IN, posEntry } from '@/server/pos/entry';

const actor: PosActor = { userId: 'u', name: 'U', restaurantId: 'r', restaurantName: 'R', role: 'CASHIER', viaMembership: false, locale: 'en' };

describe('posEntry', () => {
  it('sends nobody signed in to the shared sign-in, which returns to the till', () => {
    expect(POS_SIGN_IN).toBe('/studio/sign-in?next=/pos');
    expect(posEntry({ signedIn: false, actor: null, gate: null })).toEqual({ kind: 'signIn', to: POS_SIGN_IN });
  });

  it('answers a signed-in person with no till as not found, not a redirect (no loop with the sign-in)', () => {
    expect(posEntry({ signedIn: true, actor: null, gate: null })).toEqual({ kind: 'notFound' });
  });

  it('sends a closed gate to the inactive page with its reason', () => {
    expect(posEntry({ signedIn: true, actor, gate: { open: false, reason: 'cashierPlanInactive' } })).toEqual({
      kind: 'inactive',
      reason: 'cashierPlanInactive',
    });
  });

  it('opens for an actor with an open gate', () => {
    expect(posEntry({ signedIn: true, actor, gate: { open: true } })).toEqual({ kind: 'open', actor });
  });
});
