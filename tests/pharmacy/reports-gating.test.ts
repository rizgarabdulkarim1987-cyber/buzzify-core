import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as reports from '@/server/pharmacy/queries/reports';
import { grant, NOW, person, prisma, resetWorld, useTestDatabase } from './fixture';
import { ask, codeOf } from './stock-helpers';
import { at, build, dataOf, type Biz } from './reports-world';

/* eslint-disable @typescript-eslint/no-explicit-any -- report shapes are read off the wire and checked by value */

/**
 * Who may read which key of which report, through the QUERY layer (review of task 4). No real role holds `report.view` without
 * `cost.view`, so the permission table is wrapped: `denied` lists the permissions the table pretends nobody holds. Everything else
 * is the real table, the real framework gate and the real services.
 */

const denied = vi.hoisted(() => new Set<string>());
vi.mock('@/server/domain/pharmacy/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/domain/pharmacy/permissions')>();
  return { ...actual, canPh: (role: Parameters<typeof actual.canPh>[0], permission: Parameters<typeof actual.canPh>[1]) => !denied.has(permission) && actual.canPh(role, permission) };
});

let w: Biz;
const PERIOD = { from: '2026-10-27', to: '2026-10-28' };
const ALL: Array<[string, Record<string, unknown>]> = [
  ['sales', { ...PERIOD }],
  ['returns', { ...PERIOD }],
  ['discounts', { ...PERIOD }],
  ['margin', { ...PERIOD }],
  ['stockValuationQuery', {}],
  ['expiry', {}],
  ['damaged', { ...PERIOD }],
  ['transfers', { ...PERIOD }],
  ['lowStock', {}],
];
const def = (name: string) => (reports as unknown as Record<string, Parameters<typeof ask>[1]>)[name]!;

beforeAll(async () => {
  useTestDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await resetWorld();
  w = await build('G', false);
}, 120_000);
afterAll(() => {
  vi.useRealTimers();
  denied.clear();
});

const withDenied = async <T>(perms: string[], body: () => Promise<T>): Promise<T> => {
  for (const p of perms) denied.add(p);
  try {
    return await body();
  } finally {
    denied.clear();
  }
};

describe('the margin is gated on report.view, profit.view and cost.view', () => {
  it('the owner reads it when the table is whole', async () => {
    expect(codeOf(await ask(w.owner, def('margin'), { ...at(w), ...PERIOD }))).toBe('OK');
  });

  it.each([['report.view'], ['profit.view'], ['cost.view']])('is refused for a role without %s (other permissions intact)', async (missing) => {
    await withDenied([missing], async () => {
      expect(codeOf(await ask(w.owner, def('margin'), { ...at(w), ...PERIOD })), missing).toBe('FORBIDDEN');
    });
  });
});

describe('without report.view nothing is readable; without cost.view only the cost keys go', () => {
  it('every report is refused for a role without report.view', async () => {
    await withDenied(['report.view'], async () => {
      for (const [name, input] of ALL) expect(codeOf(await ask(w.owner, def(name), { ...at(w), ...input })), name).toBe('FORBIDDEN');
    });
  });

  it('every report but the margin still answers without cost.view, and none of them carries a cost key', async () => {
    await withDenied(['cost.view'], async () => {
      for (const [name, input] of ALL.filter(([n]) => n !== 'margin')) expect(codeOf(await ask(w.owner, def(name), { ...at(w), ...input })), name).toBe('OK');
      const valuation: any = dataOf(await ask(w.owner, def('stockValuationQuery'), { ...at(w), groupBy: 'product' }));
      for (const place of [valuation.totals, ...valuation.byBranch, ...valuation.rows]) {
        expect(place).not.toHaveProperty('values');
        expect(place).not.toHaveProperty('noCostRows');
        expect(place).not.toHaveProperty('valuationComplete');
      }
      expect(valuation.inTransit).not.toHaveProperty('values');
      const expiry: any = dataOf(await ask(w.owner, def('expiry'), { ...at(w) }));
      for (const band of [...expiry.totals, ...expiry.byBranch.flatMap((b: any) => b.bands)]) {
        expect(band).not.toHaveProperty('values');
        expect(band).not.toHaveProperty('noCostRows');
      }
      const damaged: any = dataOf(await ask(w.owner, def('damaged'), { ...at(w), ...PERIOD }));
      expect(damaged.current.totals).not.toHaveProperty('values');
      expect(damaged.current.totals).not.toHaveProperty('noCostRows');
      for (const t of damaged.movements.totals) {
        expect(t).not.toHaveProperty('values');
        expect(t).not.toHaveProperty('noCostRows');
      }
      expect(damaged.transfers.totals).not.toHaveProperty('values');
      expect(damaged.transfers.totals).not.toHaveProperty('noCostRows');
    });
  });

  it('with cost.view the same keys are there (the check above looks at something real)', async () => {
    const valuation: any = dataOf(await ask(w.owner, def('stockValuationQuery'), { ...at(w) }));
    expect(valuation.totals).toHaveProperty('values');
    const damaged: any = dataOf(await ask(w.owner, def('damaged'), { ...at(w), ...PERIOD }));
    expect(damaged.movements.totals[0]).toHaveProperty('values');
    expect(damaged.movements.totals[0]).toHaveProperty('noCostRows');
  });
});

describe('a support actor with a grant', () => {
  it('is refused by name (FORBIDDEN) on every report, the margin included', async () => {
    const admin = await person('supportG', { superAdmin: true });
    await grant(admin, w.a.id, { scopes: ['catalog.read', 'stock.read', 'sales.read'] });
    for (const [name, input] of ALL) expect(codeOf(await ask(admin, def(name), { ...at(w), ...input })), name).toBe('FORBIDDEN');
    void prisma;
  });
});
