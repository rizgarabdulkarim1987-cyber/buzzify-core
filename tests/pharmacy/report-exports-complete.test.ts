import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { chainDashboard } from '@/server/pharmacy/chain';
import { listExpiry, expiryInput } from '@/server/pharmacy/expiry';
import { discountsReport, returnsReport } from '@/server/pharmacy/reports';
import { scopeOf } from '@/server/pharmacy/reports-common';
import { discountsInput, marginInput, returnsInput } from '@/server/pharmacy/reports-inputs';
import { damagedInput, damagedReport, transfersReport, transfersReportInput } from '@/server/pharmacy/reports-ledger';
import { marginReport } from '@/server/pharmacy/reports-margin';
import { expiryBandTotals, lowStockInput, lowStockReport, stockValuation, valuationInput } from '@/server/pharmacy/reports-stock';
import { exportReport, userNamesFor, type ExportReportInput } from '@/server/pharmacy/report-exports';
import { phScopedClient } from '@/server/studio/framework/access';
import * as exportQueries from '@/server/pharmacy/queries/exports';
import { asPh, NOW, person, pharmacy, prisma, resetWorld, useTestDatabase } from './fixture';
import { ask } from './stock-helpers';
import { at, dataOf } from './reports-world';
import { buildChain, type ChainBiz } from './chain-world';
import { parseCsv, readXlsx, records } from './sheet-read';

/* eslint-disable @typescript-eslint/no-explicit-any -- report shapes are compared by value with the file */

/**
 * Report 5b: an export carries every figure its report carries. Each test fetches the report's own answer through the service,
 * reads the file back, and compares the two field by field (the summary rows are typed by `rowType`).
 */

let w: ChainBiz;
const PERIOD = { from: '2026-10-27', to: '2026-10-28' };
const names = new Map<string, string>();

beforeAll(async () => {
  useTestDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await resetWorld();
  w = await buildChain('Z');
  for (const b of await prisma().branch.findMany({ where: { restaurantId: w.a.id } })) names.set(b.id, b.name);
}, 240_000);
afterAll(() => {
  vi.useRealTimers();
});

const WHOLE = { take: 500, cursor: null };
async function env(who = w.owner) {
  const ph = (await asPh(who.userId, w.a.id))!;
  return { ph, scoped: phScopedClient(prisma(), ph) };
}
async function fileOf(report: string, input: Record<string, unknown> = {}, who = w.owner, format: 'csv' | 'xlsx' = 'csv') {
  const { ph, scoped } = await env(who);
  const file = await exportReport(scoped, ph, {}, { report, format, ...input } as ExportReportInput, { now: NOW });
  const bytes = new Uint8Array(Buffer.from(file.base64, 'base64'));
  const table = format === 'csv' ? parseCsv(bytes) : await readXlsx(bytes);
  return { file, table, rows: records(table) };
}
const of = (rows: Array<Record<string, string>>, type: string) => rows.filter((r) => r.rowType === type);
/** Minor units as the sheet writes them. */
const fmt = (minor: string | bigint, currency: string): string => {
  const v = BigInt(minor);
  if (currency === 'IQD') return v.toString();
  const abs = v < 0n ? -v : v;
  return `${v < 0n ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
};
const pct = (bp: number | null): string => {
  if (bp === null) return '';
  const abs = Math.abs(bp).toString().padStart(3, '0');
  return `${bp < 0 ? '-' : ''}${abs.slice(0, -2)}.${abs.slice(-2)}`;
};
const nm = (id: string) => names.get(id) ?? '';

describe('returns: totals by currency, by branch, by reason and by method', () => {
  it('equal the report, and the file holds nothing else', async () => {
    const { ph, scoped } = await env();
    const r = await returnsReport(scoped, ph, {}, { ...returnsInput.parse(PERIOD), ...WHOLE });
    const { rows, file } = await fileOf('returns', PERIOD);
    expect(r.totals.length).toBeGreaterThan(0);
    expect(of(rows, 'row')).toHaveLength(r.rows.length);
    expect(of(rows, 'total').map((x) => [x.currency, x.count, x.refund])).toEqual(r.totals.map((t) => [t.currency, String(t.count), fmt(t.refundMinor, t.currency)]));
    expect(of(rows, 'branch').map((x) => [x.branch, x.currency, x.count, x.refund])).toEqual(r.byBranch.map((t) => [nm(t.branchId), t.currency, String(t.count), fmt(t.refundMinor, t.currency)]));
    expect(of(rows, 'reason').map((x) => [x.reason, x.count])).toEqual(r.byReason.map((t) => [t.reason, String(t.count)]));
    expect(of(rows, 'method').map((x) => [x.method, x.currency, x.count, x.refund])).toEqual(r.byMethod.map((t) => [t.method, t.currency, String(t.count), fmt(t.refundMinor, t.currency)]));
    expect(rows).toHaveLength(r.rows.length + r.totals.length + r.byBranch.length + r.byReason.length + r.byMethod.length);
    expect(file.rows).toBe(rows.length);
  });
});

describe('discounts: totals by currency, by branch, the top givers and the limit', () => {
  it('equal the report', async () => {
    const { ph, scoped } = await env();
    const r = await discountsReport(scoped, ph, {}, { ...discountsInput.parse(PERIOD), ...WHOLE });
    const { rows } = await fileOf('discounts', PERIOD);
    const shape = (t: { currency: string; salesCount: number; discountedCount: number; grossMinor: string; discountMinor: string; discountBp: number | null }) => [t.currency, String(t.salesCount), String(t.discountedCount), fmt(t.grossMinor, t.currency), fmt(t.discountMinor, t.currency), pct(t.discountBp)];
    const got = (x: Record<string, string>) => [x.currency, x.salesCount, x.discountedCount, x.gross, x.discount, x.discountPercent];
    expect(r.totals.length).toBeGreaterThan(0);
    expect(of(rows, 'row')).toHaveLength(r.rows.length);
    expect(of(rows, 'total').map(got)).toEqual(r.totals.map(shape));
    expect(of(rows, 'branch').map((x) => [x.branch, ...got(x)])).toEqual(r.byBranch.map((t) => [nm(t.branchId), ...shape(t)]));
    expect(of(rows, 'topUser').map((x) => [x.soldBy, x.currency, x.discountedCount, x.gross, x.discount, x.discountPercent])).toEqual(
      r.topUsers.map((u) => [u.userName ?? '', u.currency, String(u.discountedCount), fmt(u.grossMinor, u.currency), fmt(u.discountMinor, u.currency), pct(u.discountBp)]),
    );
    expect(of(rows, 'limit').map((x) => x.discountPercent)).toEqual(r.maxDiscountPercent === null ? [] : [String(r.maxDiscountPercent)]);
    expect(rows).toHaveLength(r.rows.length + r.totals.length + r.byBranch.length + r.topUsers.length + 1);
  });
});

describe('margin: the estimate caveat travels with the file', () => {
  it('carries the left-out counts per branch and in all, and the excluded net, equal to the report', async () => {
    const { ph, scoped } = await env();
    const r = await marginReport(scoped, ph, {}, { ...marginInput.parse({ ...PERIOD, groupBy: 'product' }), ...WHOLE });
    const { rows } = await fileOf('margin', { ...PERIOD, groupBy: 'product' });
    expect(r.incompleteCostRows + r.mixedCurrencyRows, 'the world has lines left out').toBeGreaterThan(0);
    expect(r.excluded.length).toBeGreaterThan(0);
    const money = (t: { currency: string; netMinor: string; costMinor: string; marginMinor: string; marginBp: number | null }) => [t.currency, fmt(t.netMinor, t.currency), fmt(t.costMinor, t.currency), fmt(t.marginMinor, t.currency), pct(t.marginBp)];
    const got = (x: Record<string, string>) => [x.currency, x.net, x.cost, x.margin, x.marginPercent];
    expect(of(rows, 'row')).toHaveLength(r.rows.length);
    expect(of(rows, 'total').map(got)).toEqual(r.totals.map(money));
    expect(of(rows, 'branch').map((x) => [x.key, x.label, ...got(x), x.incompleteCostRows, x.mixedCurrencyRows])).toEqual(
      r.byBranch.map((b) => [b.branchId, nm(b.branchId), ...money(b), String(b.incompleteCostRows), String(b.mixedCurrencyRows)]),
    );
    expect(of(rows, 'summary').map((x) => [x.incompleteCostRows, x.mixedCurrencyRows])).toEqual([[String(r.incompleteCostRows), String(r.mixedCurrencyRows)]]);
    expect(of(rows, 'excluded').map((x) => [x.currency, x.net])).toEqual(r.excluded.map((e) => [e.currency, fmt(e.netMinor, e.currency)]));
    expect(rows).toHaveLength(r.rows.length + r.totals.length + r.byBranch.length + 1 + r.excluded.length);
  });
});

describe('stock valuation: per-branch rows and what is on the road', () => {
  it('equal the report', async () => {
    const { ph, scoped } = await env();
    const r = await stockValuation(scoped, ph, {}, { ...valuationInput.parse({ groupBy: 'product' }), ...WHOLE });
    const { rows } = await fileOf('stockValuation', { groupBy: 'product' });
    const buckets = (x: Record<string, string>) => [x.available, x.reserved, x.quarantine, x.damaged];
    const expectBuckets = (b: { available: number; reserved: number; quarantine: number; damaged: number }) => [String(b.available), String(b.reserved), String(b.quarantine), String(b.damaged)];
    for (const b of r.byBranch) {
      const mine = of(rows, 'branch').filter((x) => x.key === b.branchId);
      expect(mine.length, b.branchId).toBeGreaterThan(0);
      expect([buckets(mine[0]!), mine[0]!.label, mine[0]!.noCostRows, mine[0]!.valuationComplete]).toEqual([expectBuckets(b), nm(b.branchId), String(b.noCostRows), b.valuationComplete ? 'yes' : 'no']);
      for (const v of b.values ?? []) expect(mine.find((x) => x.currency === v.currency)!.value, `${b.branchId} ${v.currency}`).toBe(fmt(v.valueMinor, v.currency));
    }
    expect(of(rows, 'branch').map((x) => x.key)).toEqual(expect.arrayContaining(r.byBranch.map((b) => b.branchId)));
    expect(r.inTransit.units).toBeGreaterThan(0);
    const transit = of(rows, 'inTransit');
    expect(transit.filter((x) => x.currency === '').map((x) => [x.inTransitUnits, x.inTransitTransfers])).toEqual([[String(r.inTransit.units), String(r.inTransit.transfers)]]);
    expect(transit.filter((x) => x.currency !== '').map((x) => [x.currency, x.value])).toEqual((r.inTransit.values ?? []).map((v) => [v.currency, fmt(v.valueMinor, v.currency)]));
    expect(of(rows, 'inTransitBranch').map((x) => [x.key, x.label, x.inTransitUnits])).toEqual(r.inTransit.byDestination.map((d) => [d.branchId, nm(d.branchId), String(d.units)]));
  });
});

describe('expiry: band totals in all and per branch, and the list counts', () => {
  it('equal the report', async () => {
    const { ph, scoped } = await env();
    const scope = scopeOf(ph, undefined);
    const bands = await expiryBandTotals(scoped, scope, true);
    const list = await listExpiry(scoped, ph, expiryInput.parse({ days: 90, includeExpired: true }));
    const { rows } = await fileOf('expiry');
    type Band = (typeof bands.totals)[number];
    const expand = (branch: string, bs: Band[]) =>
      bs.flatMap((b) => {
        const values = b.values ?? [];
        const shared = [b.band, branch, String(b.rows), String(b.units)];
        if (values.length === 0) return [[...shared, '', '', String(b.noCostRows ?? 0)]];
        return values.map((v) => [...shared, v.currency, fmt(v.valueMinor, v.currency), String(b.noCostRows ?? 0)]);
      });
    const expected = [...expand('', bands.totals), ...bands.byBranch.flatMap((e) => expand(nm(e.branchId), e.bands))];
    expect(expected.length).toBeGreaterThan(8);
    expect(of(rows, 'bandTotal').map((x) => [x.band, x.branch, x.stockRows, x.units, x.costCurrency, x.value, x.noCostRows])).toEqual(expected);
    expect(of(rows, 'listTotal').map((x) => [x.band, x.stockRows])).toEqual(Object.entries(list.totals).map(([band, n]) => [band, String(n)]));
    expect(of(rows, 'row').length).toBe(list.items.length);
  });
});

describe('damaged: every section, typed', () => {
  it('equals the report', async () => {
    const { ph, scoped } = await env();
    const days = (await prisma().phStockMovement.findMany({ where: { restaurantId: w.a.id, type: { in: ['DAMAGE', 'ADJUST'] } }, select: { createdAt: true } })).map((r) => new Date(r.createdAt.getTime() + 3 * 3_600_000).toISOString().slice(0, 10)).sort();
    const range = { from: days[0]!, to: days[days.length - 1]! };
    const r = await damagedReport(scoped, ph, {}, damagedInput.parse(range));
    const { rows } = await fileOf('damaged', range);
    const sec = (section: string, type: string) => rows.filter((x) => x.section === section && x.rowType === type);
    expect(sec('current', 'branch').map((x) => [x.branch, x.damaged, x.quarantine])).toEqual(r.current.byBranch.map((b) => [nm(b.branchId), String(b.damaged), String(b.quarantine)]));
    expect(sec('current', 'total').map((x) => [x.damaged, x.quarantine])).toEqual([[String(r.current.totals.damaged), String(r.current.totals.quarantine)]]);
    expect(sec('current', 'value').map((x) => [x.currency, x.damagedValue, x.quarantineValue])).toEqual((r.current.totals.values ?? []).map((v) => [v.currency, fmt(v.damagedValueMinor, v.currency), fmt(v.quarantineValueMinor, v.currency)]));
    expect(sec('movements', 'branch').map((x) => [x.type, x.branch, x.units])).toEqual(r.movements.byBranch.map((b) => [b.type, nm(b.branchId), String(b.units)]));
    expect(sec('movements', 'total').map((x) => [x.type, x.units])).toEqual(r.movements.totals.map((t) => [t.type, String(t.units)]));
    expect(sec('movements', 'value').map((x) => [x.type, x.currency, x.value])).toEqual(r.movements.totals.flatMap((t) => (t.values ?? []).map((v) => [t.type, v.currency, fmt(v.valueMinor, v.currency)])));
    expect(sec('movementReasons', 'reason').map((x) => [x.type, x.reason, x.units])).toEqual(r.movements.reasons.map((x) => [x.type, x.reason, String(x.units)]));
    expect(sec('transfers', 'route').map((x) => [x.branch, x.toBranch, x.damaged, x.lost])).toEqual(r.transfers.byRoute.map((x) => [nm(x.fromBranchId), nm(x.toBranchId), String(x.damagedQty), String(x.lostQty)]));
    expect(sec('transfers', 'total').map((x) => [x.damaged, x.lost])).toEqual([[String(r.transfers.totals.damagedQty), String(r.transfers.totals.lostQty)]]);
    expect(sec('transfers', 'value').map((x) => [x.currency, x.damagedValue, x.lostValue])).toEqual((r.transfers.totals.values ?? []).map((v) => [v.currency, fmt(v.damagedValueMinor, v.currency), fmt(v.lostValueMinor, v.currency)]));
    expect(rows.every((x) => ['branch', 'total', 'value', 'reason', 'route'].includes(x.rowType))).toBe(true);
  });
});

describe('transfers: the total, the splits, what is on the road, what was lost', () => {
  it('equal the report', async () => {
    const { ph, scoped } = await env();
    const r = await transfersReport(scoped, ph, {}, { ...transfersReportInput.parse(PERIOD), ...WHOLE });
    const { rows } = await fileOf('transfers', PERIOD);
    expect(of(rows, 'row')).toHaveLength(r.rows.length);
    expect(of(rows, 'total').map((x) => x.count)).toEqual([String(r.total)]);
    expect(of(rows, 'status').map((x) => [x.status, x.count])).toEqual(r.byStatus.map((s) => [s.status, String(s.count)]));
    expect(of(rows, 'branch').map((x) => [x.from, x.count])).toEqual(r.byBranch.map((b) => [nm(b.branchId), String(b.count)]));
    expect(of(rows, 'route').map((x) => [x.from, x.to, x.status, x.count])).toEqual(r.byRoute.map((b) => [nm(b.fromBranchId), nm(b.toBranchId), b.status, String(b.count)]));
    expect(of(rows, 'inTransit').map((x) => [x.units, x.count])).toEqual([[String(r.inTransit.units), String(r.inTransit.transfers)]]);
    expect(of(rows, 'inTransitRoute').map((x) => [x.from, x.to, x.units])).toEqual(r.inTransit.byRoute.map((b) => [nm(b.fromBranchId), nm(b.toBranchId), String(b.units)]));
    expect(of(rows, 'lost').map((x) => [x.lost, x.damaged])).toEqual([[String(r.lost.lostQty), String(r.lost.damagedQty)]]);
    expect(of(rows, 'lostReason').map((x) => [x.reason, x.lost])).toEqual(r.lost.byReason.map((b) => [b.reason, String(b.lostQty)]));
    expect(of(rows, 'avgTransit').map((x) => x.avgTransitSeconds)).toEqual(r.avgTransitSeconds === null ? [] : [String(r.avgTransitSeconds)]);
  });
});

describe('low stock: the total and the count per branch', () => {
  it('equal the report', async () => {
    const { ph, scoped } = await env();
    const r = await lowStockReport(scoped, ph, {}, { ...lowStockInput.parse({}), ...WHOLE });
    const { rows } = await fileOf('lowStock');
    expect(of(rows, 'row')).toHaveLength(r.rows.length);
    expect(of(rows, 'total').map((x) => x.count)).toEqual([String(r.total)]);
    expect(of(rows, 'branch').map((x) => [x.branch, x.count])).toEqual(r.byBranch.map((b) => [nm(b.branchId), String(b.count)]));
  });
});

describe('chain: valuation completeness and the margin left-out counts', () => {
  it('equal the dashboard, in every branch row and in the total', async () => {
    const { ph, scoped } = await env();
    const d = await chainDashboard(scoped, ph, { ...PERIOD }, NOW);
    const { rows } = await fileOf('chain', PERIOD);
    expect(d.total.stock.valuationComplete).toBe(false);
    const check = (row: Record<string, string>, f: { stock: { noCostRows?: number; valuationComplete?: boolean }; margin?: Array<{ currency: string; incompleteCostRows: number; mixedCurrencyRows: number }> }) => {
      expect([row.valuationComplete, row.noCostRows]).toEqual([f.stock.valuationComplete ? 'yes' : 'no', String(f.stock.noCostRows)]);
      for (const c of ['IQD', 'USD']) {
        const m = f.margin?.find((x) => x.currency === c);
        expect([row[`marginIncomplete_${c}`], row[`marginMixed_${c}`]], c).toEqual([String(m?.incompleteCostRows ?? 0), String(m?.mixedCurrencyRows ?? 0)]);
      }
    };
    for (const b of d.branches) check(of(rows, 'branch').find((x) => x.branch === b.name)!, b);
    check(of(rows, 'total')[0]!, d.total);
    const flagged = d.total.margin!.reduce((n, m) => n + m.incompleteCostRows + m.mixedCurrencyRows, 0);
    expect(flagged, 'the world has lines left out').toBeGreaterThan(0);
  });
});

describe('every export names its summary rows, CSV and XLSX alike', () => {
  it.each([['returns', PERIOD], ['discounts', PERIOD], ['margin', { ...PERIOD, groupBy: 'product' }], ['stockValuation', {}], ['expiry', {}], ['transfers', PERIOD], ['lowStock', {}], ['chain', PERIOD]] as Array<[string, Record<string, unknown>]>)('%s has a rowType column and a total or summary row', async (report, input) => {
    const csv = await fileOf(report, input);
    const xlsx = await fileOf(report, input, w.owner, 'xlsx');
    expect(xlsx.table).toEqual(csv.table);
    expect(csv.table[0]).toContain('rowType');
    expect(new Set(csv.rows.map((r) => r.rowType)).size, `${report} has more than one kind of row`).toBeGreaterThan(1);
  });
});

describe('the audit row says how many branches the file covered', () => {
  it('one when the export was narrowed to a branch, and all of them otherwise', async () => {
    const countOf = async (place: Record<string, unknown>) => {
      const known = new Set((await prisma().auditLog.findMany({ where: { restaurantId: w.a.id, action: 'pharmacy.report.export' }, select: { id: true } })).map((r) => r.id));
      dataOf(await ask(w.owner, exportQueries.report, { ...place, report: 'lowStock', format: 'csv' }));
      const fresh = (await prisma().auditLog.findMany({ where: { restaurantId: w.a.id, action: 'pharmacy.report.export' } })).filter((r) => !known.has(r.id));
      expect(fresh).toHaveLength(1);
      return (fresh[0]!.changes as any).branches.after;
    };
    expect(await countOf(at(w, w.b1))).toBe(1);
    expect(await countOf(at(w))).toBe(3);
  });

  it('a lapsed pharmacy still exports, and the audit row is written', async () => {
    const p = await pharmacy('LapsedAudit', { branches: 2, subscription: 'ACTIVE', periodEndsInDays: -30, graceDays: 7 });
    const owner = await person('ownerLapsedAudit', { membership: [p.id, 'OWNER'] });
    dataOf(await ask(owner, exportQueries.report, { restaurantId: p.id, report: 'sales', format: 'csv', ...PERIOD, groupBy: 'day' }));
    const rows = await prisma().auditLog.findMany({ where: { restaurantId: p.id, action: 'pharmacy.report.export' } });
    expect(rows).toHaveLength(1);
    expect((rows[0]!.changes as any).branches.after).toBe(2);
  });
});

describe('user names are looked up inside the business', () => {
  it('a seller of this business is named; a user of another business is not', async () => {
    const { ph, scoped } = await env();
    const other = await pharmacy('NamesElsewhere');
    const stranger = await person('strangerNames', { membership: [other.id, 'OWNER'] });
    const found = await userNamesFor(scoped, ph.restaurantId, [w.owner.userId, w.cashier1.userId, stranger.userId]);
    expect([...found.keys()].sort()).toEqual([w.owner.userId, w.cashier1.userId].sort());
  });
});

describe('the expiry export keeps the phase 2 limit and says so', () => {
  it('refuses at the phase 2 batch limit with its own code, the real limit and a hint that can be followed', async () => {
    const { ph, scoped } = await env();
    const run = () => exportReport(scoped, ph, {}, { report: 'expiry', format: 'csv' }, { now: NOW, expiryMaxBatches: 3 });
    await expect(run()).rejects.toMatchObject({ code: 'INVALID', fields: { phCode: 'EXPORT_EXPIRY_TOO_LARGE', limit: '3' } });
    const error = await run().catch((e: Error) => e);
    expect((error as Error).message).not.toMatch(/date/i);
    expect((error as Error).message).toMatch(/branch/i);
    expect((error as Error).message).toContain('20,000');
    // The default is the phase 2 number, 20,000.
    const ok = await exportReport(scoped, ph, {}, { report: 'expiry', format: 'csv' }, { now: NOW });
    expect(ok.rows).toBeGreaterThan(0);
  });

  it('the generic refusal of a report without dates does not tell the person to narrow the dates', async () => {
    const { ph, scoped } = await env();
    for (const report of ['stockValuation', 'lowStock'] as const) {
      const error = await exportReport(scoped, ph, {}, { report, format: 'csv' }, { now: NOW, maxRows: 1 }).catch((e: Error) => e);
      expect((error as any).fields.phCode).toBe('EXPORT_TOO_LARGE');
      expect((error as Error).message, report).not.toMatch(/date/i);
    }
    const dated = await exportReport(scoped, ph, {}, { report: 'returns', format: 'csv', ...PERIOD }, { now: NOW, maxRows: 1 }).catch((e: Error) => e);
    expect((dated as Error).message).toMatch(/dates/i);
  });
});

describe('the day in the file name is the day the figures use', () => {
  it('as-of-today reports are named for the UTC day their figures were computed for, even late in the Baghdad evening', async () => {
    const { ph, scoped } = await env();
    const late = new Date('2026-10-27T22:30:00.000Z');
    for (const report of ['expiry', 'lowStock'] as const) {
      const file = await exportReport(scoped, ph, {}, { report, format: 'csv' }, { now: late });
      expect(file.fileName, report).toBe(`pharmacy-${report}-2026-10-27.csv`);
    }
  });
});

describe('the chain dashboard filtered by currency', () => {
  it('shows stock and expiry values of that currency only', async () => {
    const { ph, scoped } = await env();
    const d = await chainDashboard(scoped, ph, { ...PERIOD, currency: 'IQD' }, NOW);
    const cards = [d.total, ...d.branches];
    const stockCurrencies = cards.flatMap((c) => c.stock.values ?? []).map((v) => v.currency);
    expect(stockCurrencies.length).toBeGreaterThan(0);
    expect(new Set(stockCurrencies)).toEqual(new Set(['IQD']));
    const expiryCurrencies = cards.flatMap((c) => [c.expiry.expired, c.expiry.d30]).flatMap((b) => b.values ?? []).map((v) => v.currency);
    expect(expiryCurrencies.length).toBeGreaterThan(0);
    expect(new Set(expiryCurrencies)).toEqual(new Set(['IQD']));
    const all = await chainDashboard(scoped, ph, { ...PERIOD }, NOW);
    expect(new Set(all.total.stock.values!.map((v) => v.currency))).toEqual(new Set(['IQD', 'USD']));
  });
});
