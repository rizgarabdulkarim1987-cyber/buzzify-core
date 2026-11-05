import { describe, expect, it } from 'vitest';
import type { PhRole } from '@/server/domain/pharmacy/permissions';
import { DOCTOR_UI_READY, doctorAccess, doctorEnabledFor } from '@/server/pharmacy/doctor/access';
import type { PhActor } from '@/server/pharmacy/actor';

const actor = (over: Partial<PhActor> = {}): PhActor => ({
  userId: 'u1',
  name: 'U',
  restaurantId: 'r1',
  restaurantName: 'Shifa',
  role: 'PHARMACIST',
  allBranches: false,
  branchIds: ['b1'],
  viaMembership: false,
  aiDoctor: false,
  support: null,
  locale: 'en',
  ...over,
});

const BUDGET = 5_000;

describe('doctorAccess', () => {
  const cases: Array<[string, PhActor | null, number, boolean, string]> = [
    ['owner via membership (no staff row, switch false)', actor({ role: 'OWNER', viaMembership: true, allBranches: true }), BUDGET, true, 'OK'],
    ['pharmacist with the switch off', actor({ aiDoctor: false }), BUDGET, false, 'SWITCH_OFF'],
    ['pharmacist with the switch on', actor({ aiDoctor: true }), BUDGET, true, 'OK'],
    ['cashier with the switch on', actor({ role: 'CASHIER' as PhRole, aiDoctor: true }), BUDGET, false, 'NO_PERMISSION'],
    ['budget 0 (owner)', actor({ role: 'OWNER', viaMembership: true }), 0, false, 'NOT_IN_PLAN'],
    ['budget 0 (pharmacist, switch on)', actor({ aiDoctor: true }), 0, false, 'NOT_IN_PLAN'],
    ['support actor (no role)', actor({ role: null, aiDoctor: true, support: { grantId: 'g', scopes: new Set(), expiresAt: new Date() } }), BUDGET, false, 'NO_PERMISSION'],
    ['no actor', null, BUDGET, false, 'NO_ACTOR'],
  ];
  it.each(cases)('%s', (_label, who, budget, allowed, reason) => {
    expect(doctorAccess({ actor: who, aiBudgetMinor: budget })).toEqual({ allowed, reason });
  });

  it('keeps the nav item hidden while the UI is not ready', () => {
    expect(DOCTOR_UI_READY).toBe(false);
    expect(doctorEnabledFor({ actor: actor({ aiDoctor: true }), aiBudgetMinor: BUDGET })).toBe(false);
  });
});
