import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as chain from '@/server/pharmacy/queries/chain';
import { grant, NOW, person, pharmacy, resetWorld, useTestDatabase } from './fixture';
import { ask, codeOf } from './stock-helpers';
import { at, dataOf } from './reports-world';
import { buildChain, type ChainBiz } from './chain-world';

/* eslint-disable @typescript-eslint/no-explicit-any -- the dashboard is read off the wire and checked by value */

/**
 * Who sees which key of the chain dashboard (phase 6, task 5), through the query layer. No real role holds `report.view` without
 * `cost.view`, so the permission table is wrapped (as in reports-gating.test.ts): `denied` lists what nobody holds.
 */

const denied = vi.hoisted(() => new Set<string>());
vi.mock('@/server/domain/pharmacy/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/domain/pharmacy/permissions')>();
  return { ...actual, canPh: (role: Parameters<typeof actual.canPh>[0], permission: Parameters<typeof actual.canPh>[1]) => !denied.has(permission) && actual.canPh(role, permission) };
});

let w: ChainBiz;
const PERIOD = { from: '2026-10-27', to: '2026-10-28' };

beforeAll(async () => {
  useTestDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await resetWorld();
  w = await buildChain('G');
}, 240_000);
afterAll(() => {
  vi.useRealTimers();
  denied.clear();
});

const dash = (who = w.owner) => ask(who, chain.dashboard, { ...at(w), ...PERIOD });
const without = async <T>(perms: string[], body: () => Promise<T>): Promise<T> => {
  for (const p of perms) denied.add(p);
  try {
    return await body();
  } finally {
    denied.clear();
  }
};
const costKeysIn = (r: any): string[] => {
  const found: string[] = [];
  const walk = (value: unknown, path: string) => {
    if (value === null || typeof value !== 'object') return;
    for (const [k, v] of Object.entries(value)) {
      if (['values', 'noCostRows', 'valuationComplete', 'stockValueMinor', 'costMinor', 'marginMinor', 'marginBp'].includes(k)) found.push(`${path}.${k}`);
      walk(v, `${path}.${k}`);
    }
  };
  walk(r, '$');
  return found;
};

describe('cost and profit keys', () => {
  it('the owner sees them (so the absence checks below look at something real)', async () => {
    const r: any = dataOf(await dash());
    expect(r.estimatedMargin).toBe(true);
    expect(r.total.margin.length).toBeGreaterThan(0);
    expect(r.total.stock.values.length).toBeGreaterThan(0);
    expect(costKeysIn(r).length).toBeGreaterThan(10);
  });

  it.each([['cost.view'], ['profit.view']])('without %s there is no margin anywhere: no card, no total, no comparison column, no marker', async (missing) => {
    await without([missing], async () => {
      const r: any = dataOf(await dash());
      expect(r).not.toHaveProperty('estimatedMargin');
      expect(r.total).not.toHaveProperty('margin');
      for (const b of r.branches) expect(b).not.toHaveProperty('margin');
      for (const g of r.comparison) for (const row of g.rows) expect(row).not.toHaveProperty('marginBp');
      expect(JSON.stringify(r)).not.toContain('marginBp');
      expect(JSON.stringify(r)).not.toContain('costMinor');
    });
  });

  it('without cost.view no value, no no-cost flag, no valuation flag appears at all; quantities and sales stay', async () => {
    await without(['cost.view'], async () => {
      const r: any = dataOf(await dash());
      expect(costKeysIn(r)).toEqual([]);
      expect(r.total.stock.available).toBeGreaterThan(0);
      expect(r.total.sales.length).toBeGreaterThan(0);
      expect(r.total.expiry.expired.units).toBeGreaterThan(0);
    });
  });

  it('without report.view the dashboard is refused', async () => {
    await without(['report.view'], async () => {
      expect(codeOf(await dash())).toBe('FORBIDDEN');
    });
  });
});

describe('support, read-only and one failing figure', () => {
  it('a support actor with a grant reads nothing', async () => {
    const admin = await person('supportChain', { superAdmin: true });
    await grant(admin, w.a.id, { scopes: ['catalog.read', 'stock.read', 'sales.read'] });
    expect(codeOf(await dash(admin))).toBe('FORBIDDEN');
  });

  it('works while the subscription is lapsed (read-only mode)', async () => {
    const p = await pharmacy('ReadOnly', { branches: 2, subscription: 'ACTIVE', periodEndsInDays: -30, graceDays: 7 });
    const owner = await person('ownerRO', { membership: [p.id, 'OWNER'] });
    const r: any = dataOf(await ask(owner, chain.dashboard, { restaurantId: p.id, ...PERIOD }));
    expect(r.branches).toHaveLength(2);
    expect(r.total.sales).toEqual([]);
  });

  it('a pharmacist in charge of several branches is admitted (R6-8): their branches only, costs yes, margin no', async () => {
    const pic = await person('picChain', { staff: [w.a.id, 'PHARMACIST_IN_CHARGE', [w.b1, w.b3]] });
    const r: any = dataOf(await dash(pic));
    expect(r.scope.branchIds.slice().sort()).toEqual([w.b1, w.b3].sort());
    expect(r.branches.map((b: any) => b.branchId).sort()).toEqual([w.b1, w.b3].sort());
    expect(JSON.stringify(r)).not.toContain(w.b2);
    expect(r.estimatedMargin).toBeUndefined();
    expect(JSON.stringify(r)).not.toContain('marginBp');
    expect(r.total.stock.values.length).toBeGreaterThan(0);
    const one = await person('picOneChain', { staff: [w.a.id, 'PHARMACIST_IN_CHARGE', [w.b1]] });
    const refused = await dash(one);
    expect(refused.ok).toBe(false);
  });

  it('has no unavailable figure: the expiry cards are an aggregate with no batch limit, so they always answer', async () => {
    const r: any = dataOf(await dash(w.owner));
    expect(JSON.stringify(r)).not.toContain('unavailable');
    for (const card of [r.total, ...r.branches]) expect(Object.keys(card.expiry).sort()).toEqual(['d30', 'expired']);
  });
});
