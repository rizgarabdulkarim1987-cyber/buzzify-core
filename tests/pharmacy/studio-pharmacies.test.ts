import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runQuery, type QueryDef } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import { listPharmacies } from '@/server/studio/queries/pharmacies';
import { initialSectorOf } from '@/studio/sector-param';
import { person, pharmacy, prisma, resetWorld, useTestDatabase } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

beforeAll(() => useTestDatabase());
beforeEach(resetWorld);
afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

const ask = async <I, O>(who: { userId: string }, def: QueryDef<I, O>, input: unknown = {}): Promise<ActionResult<O>> => {
  const actor = (await loadActor(prisma(), who.userId)) as Actor;
  return runQuery(prisma(), actor, def, input);
};
const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  return result.data;
};

// Periods far from the real clock, so the effective status the query computes from `new Date()` stays what was stored.
const FAR = 3650;

describe('the Studio pharmacy list (pharmacies.list)', () => {
  it('lists only PHARMACY businesses, by name, with branches, status, subscription and created date', async () => {
    await pharmacy('Zeta Pharmacy', { branches: 3, periodEndsInDays: FAR });
    await pharmacy('Alpha Pharmacy', { subscription: 'TRIAL', periodEndsInDays: FAR, status: 'SUSPENDED' });
    await pharmacy('Bistro', { sector: 'FOOD', periodEndsInDays: FAR });
    await pharmacy('Beta Pharmacy', { subscription: 'none' });
    await prisma().appPlan.create({ data: { applicationId: 'pharmacy', code: 'standard', name: { en: 'Standard', ar: 'قياسي', ckb: 'ستاندارد' } } });
    const admin = await person('ph-list-admin', { superAdmin: true });

    const { rows } = dataOf(await ask(admin, listPharmacies));

    expect(rows.map((row) => row.name)).toEqual(['Alpha Pharmacy', 'Beta Pharmacy', 'Zeta Pharmacy']);
    const [alpha, beta, zeta] = rows;
    expect(alpha).toMatchObject({ status: 'SUSPENDED', branches: 1, subscription: { status: 'TRIAL', planCode: 'standard', planName: { en: 'Standard' } } });
    expect(beta).toMatchObject({ status: 'ACTIVE', branches: 1, subscription: null });
    expect(zeta).toMatchObject({ status: 'ACTIVE', branches: 3, subscription: { status: 'ACTIVE', planCode: 'standard' } });
    expect(zeta!.createdAt).toBeInstanceOf(Date);
  });

  it('shows the live subscription over a newer ended one', async () => {
    const ph = await pharmacy('Gamma Pharmacy', { periodEndsInDays: FAR });
    await prisma().subscription.create({
      data: {
        restaurantId: ph.id,
        applicationId: 'pharmacy',
        planCode: 'old',
        status: 'CANCELLED',
        period: 'MONTHLY',
        currency: 'IQD',
        priceMinor: 0,
        currentPeriodStart: new Date(Date.now() - 60 * 86_400_000),
        currentPeriodEnd: new Date(Date.now() - 30 * 86_400_000),
        cancelledAt: new Date(),
        version: 1,
      },
    });
    const admin = await person('ph-live-admin', { superAdmin: true });
    const { rows } = dataOf(await ask(admin, listPharmacies));
    expect(rows[0]!.subscription).toMatchObject({ status: 'ACTIVE', planCode: 'standard', planName: null });
  });

  it("refuses the pharmacy's own owner and a designer: it is a Super Admin's platform read", async () => {
    const ph = await pharmacy('Delta Pharmacy');
    const owner = await person('ph-list-owner', { membership: [ph.id, 'OWNER'] });
    const designer = await person('ph-list-designer', { membership: [ph.id, 'DESIGNER'] });
    for (const who of [owner, designer]) {
      const result = await ask(who, listPharmacies);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('FORBIDDEN');
    }
  });
});

describe('the new business form opened for a sector', () => {
  it('opens on the Pharmacy sector only for ?sector=PHARMACY, otherwise on Food', () => {
    expect(initialSectorOf({ sector: 'PHARMACY' })).toBe('PHARMACY');
    expect(initialSectorOf({ sector: 'FOOD' })).toBe('FOOD');
    expect(initialSectorOf({})).toBe('FOOD');
    expect(initialSectorOf({ sector: 'pharmacy' })).toBe('FOOD');
    expect(initialSectorOf({ sector: ['PHARMACY', 'FOOD'] })).toBe('FOOD');
  });
});
