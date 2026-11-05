import { describe, expect, it } from 'vitest';
import type { PhActor } from '@/server/pharmacy/actor';
import { history } from '@/server/pharmacy/queries/doctor-history';

const actor = (over: Partial<PhActor> = {}): PhActor => ({
  userId: 'u1',
  name: 'U',
  restaurantId: 'r1',
  restaurantName: 'Shifa',
  role: 'PHARMACIST',
  allBranches: false,
  branchIds: ['b1'],
  viaMembership: false,
  aiDoctor: true,
  support: null,
  locale: 'en',
  ...over,
});

/** A context whose log read is counted, on a plan with the given AI budget. */
function ctx(ph: PhActor, budget: number) {
  const reads = { log: 0 };
  const row = { id: 'l1', mode: 'COMPLAINT', questionText: 'headache', outcome: 'ANSWERED', createdAt: new Date(), staffId: ph.userId };
  const db = {
    subscription: { findMany: async () => [{ planCode: 'p', status: 'ACTIVE', trialEndsAt: null, currentPeriodEnd: new Date(Date.now() + 86_400_000), graceDays: 0 }] },
    appPlan: { findUnique: async () => ({ limits: { branches: 1, users: 5, storageMb: 100, aiMonthlyBudgetMinor: budget } }) },
  };
  const scoped = {
    phDoctorLog: {
      findMany: async () => {
        reads.log += 1;
        return [row];
      },
    },
  };
  return { c: { ph, scoped, db } as never, reads };
}

describe('ph.doctor.history applies the Doctor access rule itself', () => {
  it('lists the questions for a person the Doctor is open to', async () => {
    const { c, reads } = ctx(actor(), 5_000);
    const out = await history.run(c, { restaurantId: 'r1' } as never);
    expect(out.items.map((i) => i.id)).toEqual(['l1']);
    expect(reads.log).toBe(1);
  });

  it('lists nothing, and reads no log, when the staff switch is off', async () => {
    const { c, reads } = ctx(actor({ aiDoctor: false }), 5_000);
    expect((await history.run(c, { restaurantId: 'r1' } as never)).items).toEqual([]);
    expect(reads.log).toBe(0);
  });

  it('lists nothing, and reads no log, when the plan has no AI budget (even for the owner)', async () => {
    const { c, reads } = ctx(actor({ role: 'OWNER', viaMembership: true, allBranches: true, aiDoctor: false }), 0);
    expect((await history.run(c, { restaurantId: 'r1' } as never)).items).toEqual([]);
    expect(reads.log).toBe(0);
  });
});
