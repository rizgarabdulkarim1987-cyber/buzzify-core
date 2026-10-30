import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as reports from '@/server/pharmacy/queries/reports';
import { NOW, prisma, resetWorld, useTestDatabase } from './fixture';
import { ask } from './stock-helpers';
import { at, build, dataOf, type Biz } from './reports-world';

/* eslint-disable @typescript-eslint/no-explicit-any -- report shapes are read off the wire and checked by value */

/**
 * The names a report screen shows instead of ids (phase 6, task 6): every report answer carries `labels` for the branches of the
 * report and for the products, categories and sellers its rows name, and only for those; nothing of another business.
 */

let w: Biz;
let other: Biz;
const PERIOD = { from: '2026-10-27', to: '2026-10-28' };

beforeAll(async () => {
  useTestDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await resetWorld();
  w = await build('L', true);
  other = await build('M', false);
}, 180_000);
afterAll(() => vi.useRealTimers());

describe('report labels', () => {
  it('branch names are those of the report branches, products by name for the product grouping', async () => {
    const data = dataOf(await ask(w.owner, reports.sales, { ...at(w), ...PERIOD, groupBy: 'product' }));
    expect(Object.keys(data.labels.branch).sort()).toEqual([...w.a.branchIds].sort());
    const product = await prisma().phProduct.findMany({ where: { id: { in: data.rows.map((r: any) => r.key) } }, select: { id: true, tradeName: true } });
    expect(product.length).toBeGreaterThan(0);
    for (const p of product) expect(data.labels.product[p.id]).toBe(p.tradeName);
    expect(data.labels.user).toEqual({});
  });

  it('sellers are named for the user grouping, and only by their business', async () => {
    const data = dataOf(await ask(w.owner, reports.sales, { ...at(w), ...PERIOD, groupBy: 'user' }));
    expect(data.rows.length).toBeGreaterThan(0);
    for (const row of data.rows) expect(typeof data.labels.user[row.key]).toBe('string');
    expect(Object.keys(data.labels.user).every((id) => data.rows.some((r: any) => r.key === id))).toBe(true);
  });

  it('a branch-limited call names only that branch', async () => {
    const data = dataOf(await ask(w.owner, reports.sales, { ...at(w, w.b1), ...PERIOD }));
    expect(Object.keys(data.labels.branch)).toEqual([w.b1]);
  });

  it('every report carries labels', async () => {
    for (const [def, extra] of [
      [reports.returns, PERIOD],
      [reports.discounts, PERIOD],
      [reports.margin, PERIOD],
      [reports.stockValuationQuery, {}],
      [reports.expiry, {}],
      [reports.damaged, PERIOD],
      [reports.transfers, PERIOD],
      [reports.lowStock, {}],
    ] as const) {
      const data = dataOf(await ask(w.owner, def as Parameters<typeof ask>[1], { ...at(w), ...extra }));
      expect(Object.keys(data.labels.branch).sort()).toEqual([...w.a.branchIds].sort());
    }
  });

  it('nothing of another business appears', async () => {
    const data = dataOf(await ask(w.owner, reports.sales, { ...at(w), ...PERIOD, groupBy: 'product' }));
    const text = JSON.stringify(data.labels);
    for (const id of other.a.branchIds) expect(text).not.toContain(id);
  });
});
