import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as exportQueries from '@/server/pharmacy/queries/exports';
import { NOW, resetWorld, useTestDatabase } from './fixture';
import { ask, codeOf } from './stock-helpers';
import { at, dataOf } from './reports-world';
import { buildChain, type ChainBiz } from './chain-world';
import { parseCsv } from './sheet-read';

/* eslint-disable @typescript-eslint/no-explicit-any -- exported shapes are read off the wire and checked by value */

/**
 * Cost and margin columns are LEFT OUT of an export (not blank) without the permissions (phase 6, task 5; R6-9). No real role
 * holds `report.view` without `cost.view`, so the permission table is wrapped, as in reports-gating.test.ts.
 */

const denied = vi.hoisted(() => new Set<string>());
vi.mock('@/server/domain/pharmacy/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/domain/pharmacy/permissions')>();
  return { ...actual, canPh: (role: Parameters<typeof actual.canPh>[0], permission: Parameters<typeof actual.canPh>[1]) => !denied.has(permission) && actual.canPh(role, permission) };
});

let w: ChainBiz;
const PERIOD = { from: '2026-10-27', to: '2026-10-28' };
const ALL: Array<[string, Record<string, unknown>]> = [
  ['sales', { ...PERIOD, groupBy: 'branch' }],
  ['returns', { ...PERIOD }],
  ['discounts', { ...PERIOD }],
  ['margin', { ...PERIOD }],
  ['stockValuation', {}],
  ['expiry', {}],
  ['damaged', { from: '2026-10-01', to: '2026-12-31' }],
  ['transfers', { ...PERIOD }],
  ['lowStock', {}],
  ['chain', { ...PERIOD }],
];

beforeAll(async () => {
  useTestDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await resetWorld();
  w = await buildChain('Y');
}, 240_000);
afterAll(() => {
  vi.useRealTimers();
  denied.clear();
});

const fetchExport = (report: string, input: Record<string, unknown>) => ask(w.owner, exportQueries.report, { ...at(w), report, format: 'csv', ...input });
const headerOf = async (report: string, input: Record<string, unknown>): Promise<string[]> => {
  const data = dataOf(await fetchExport(report, input)) as any;
  return parseCsv(new Uint8Array(Buffer.from(data.base64, 'base64')))[0]!;
};
const without = async <T>(perms: string[], body: () => Promise<T>): Promise<T> => {
  for (const p of perms) denied.add(p);
  try {
    return await body();
  } finally {
    denied.clear();
  }
};
const COST = /cost|value|margin|noCost|valuationComplete|currency$/i;

describe('cost columns are omitted, not blank', () => {
  it('with every permission the cost columns exist (so the omission checks look at something)', async () => {
    expect(await headerOf('stockValuation', {})).toEqual(expect.arrayContaining(['value', 'damagedValue', 'noCostRows', 'valuationComplete']));
    expect(await headerOf('expiry', {})).toEqual(expect.arrayContaining(['unitCost', 'costCurrency']));
    expect(await headerOf('damaged', { from: '2026-10-01', to: '2026-12-31' })).toEqual(expect.arrayContaining(['damagedValue', 'lostValue']));
    expect(await headerOf('chain', { ...PERIOD })).toEqual(expect.arrayContaining(['marginPercent_IQD', 'stockValue_IQD']));
  });

  it('without cost.view: no value, cost, margin or valuation column in any export; the margin export is refused', async () => {
    await without(['cost.view'], async () => {
      for (const [report, input] of ALL.filter(([r]) => r !== 'margin')) {
        const header = await headerOf(report, input);
        // `currency` itself stays where a money column of the sales side needs it (sales, returns, discounts).
        const costColumns = header.filter((h) => COST.test(h) && !['currency'].includes(h));
        expect(costColumns, `${report} still carries cost columns`).toEqual([]);
      }
      expect(await headerOf('stockValuation', {})).toEqual(['key', 'label', 'available', 'reserved', 'quarantine', 'damaged', 'inTransitUnits', 'inTransitTransfers', 'rowType']);
      expect(await headerOf('expiry', {})).not.toContain('unitCost');
      expect(codeOf(await fetchExport('margin', { ...PERIOD }))).toBe('FORBIDDEN');
    });
  });

  it('without profit.view: the margin export is refused and the chain export has no margin column, but still its stock value', async () => {
    await without(['profit.view'], async () => {
      expect(codeOf(await fetchExport('margin', { ...PERIOD }))).toBe('FORBIDDEN');
      const header = await headerOf('chain', { ...PERIOD });
      expect(header.some((h) => h.startsWith('marginPercent'))).toBe(false);
      expect(header).toContain('stockValue_IQD');
    });
  });

  it('without report.view every export is refused', async () => {
    await without(['report.view'], async () => {
      for (const [report, input] of ALL) expect(codeOf(await fetchExport(report, input)), report).toBe('FORBIDDEN');
    });
  });
});
