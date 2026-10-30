import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { exportReport } from '@/server/pharmacy/report-exports';
import * as exportQueries from '@/server/pharmacy/queries/exports';
import { phScopedClient } from '@/server/studio/framework/access';
import { asPh, grant, NOW, person, pharmacy, prisma, resetWorld, useTestDatabase } from './fixture';
import { ask, codeOf } from './stock-helpers';
import { at, dataOf, marginTruth } from './reports-world';
import { buildChain, type ChainBiz } from './chain-world';
import { expiryTruth, instantsOf, lowStockTruth, salesTruth, stockTruth } from './chain-truth';
import { parseCsv, readXlsx, records, type Table } from './sheet-read';

/* eslint-disable @typescript-eslint/no-explicit-any -- exported rows and report shapes are read off the wire and checked by value */

/**
 * Report exports (phase 6, task 5; R6-9). Every export is read back as a spreadsheet would read it and compared with plain code
 * over the rows (chain-truth.ts), with the report's own answer where the report is just a list, and CSV against XLSX.
 */

let w: ChainBiz;
const PERIOD = { from: '2026-10-27', to: '2026-10-28' };
const REPORTS: Array<[string, Record<string, unknown>]> = [
  ['sales', { ...PERIOD, groupBy: 'branch' }],
  ['returns', { ...PERIOD }],
  ['discounts', { ...PERIOD }],
  ['margin', { ...PERIOD, groupBy: 'product' }],
  ['stockValuation', { groupBy: 'product' }],
  ['expiry', {}],
  ['damaged', {}],
  ['transfers', { ...PERIOD }],
  ['lowStock', {}],
  ['chain', { ...PERIOD }],
];

beforeAll(async () => {
  useTestDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await resetWorld();
  w = await buildChain('X');
}, 240_000);
afterAll(() => {
  vi.useRealTimers();
});

/** The Baghdad days of the ledger rows (they take the database clock, so no test asks for "today"). */
async function ledgerDays() {
  const rows = await prisma().phStockMovement.findMany({ where: { restaurantId: w.a.id, type: { in: ['DAMAGE', 'ADJUST'] } }, select: { createdAt: true } });
  const days = rows.map((r) => new Date(r.createdAt.getTime() + 3 * 3_600_000).toISOString().slice(0, 10)).sort();
  return { from: days[0]!, to: days[days.length - 1]! };
}

async function fetchExport(who: Parameters<typeof ask>[0], report: string, format: 'csv' | 'xlsx', input: Record<string, unknown> = {}, place: Record<string, unknown> = at(w)) {
  const extra = report === 'damaged' ? await ledgerDays() : {};
  const result = await ask(who, exportQueries.report, { ...place, report, format, ...extra, ...input });
  return result;
}
async function table(who: Parameters<typeof ask>[0], report: string, format: 'csv' | 'xlsx', input: Record<string, unknown> = {}, place: Record<string, unknown> = at(w)): Promise<{ table: Table; data: any }> {
  const data = dataOf(await fetchExport(who, report, format, input, place)) as any;
  const bytes = new Uint8Array(Buffer.from(data.base64, 'base64'));
  return { table: format === 'csv' ? parseCsv(bytes) : await readXlsx(bytes), data };
}
const rowsOf = async (report: string, input: Record<string, unknown> = {}, who = w.owner) => records((await table(who, report, 'csv', input)).table);

/** Minor units as the sheet writes them: IQD whole, USD with two decimals. */
const fmt = (minor: bigint, currency: string): string => {
  if (currency === 'IQD') return minor.toString();
  const abs = minor < 0n ? -minor : minor;
  return `${minor < 0n ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
};

describe('the files', () => {
  it.each(REPORTS)('%s: a UTF-8 CSV with a byte order mark and an XLSX hold exactly the same cells', async (report, input) => {
    const csv = await table(w.owner, report, 'csv', input);
    const xlsx = await table(w.owner, report, 'xlsx', input);
    expect(csv.table.length, `${report} has rows`).toBeGreaterThan(1);
    expect(xlsx.table).toEqual(csv.table);
    const raw = Buffer.from(csv.data.base64, 'base64');
    expect([...raw.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(raw.subarray(0, 0).length).toBe(0);
    expect([...Buffer.from(xlsx.data.base64, 'base64').subarray(0, 2)]).toEqual([0x50, 0x4b]);
    expect(csv.data.contentType).toBe('text/csv');
    expect(xlsx.data.contentType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(csv.data.rows).toBe(csv.table.length - 1);
  });

  it('the file name carries the report and the range or the day, and nothing else: no business name, no free text', async () => {
    const sales = dataOf(await fetchExport(w.owner, 'sales', 'csv', { ...PERIOD, groupBy: 'day' })) as any;
    expect(sales.fileName).toBe('pharmacy-sales-2026-10-27_2026-10-28.csv');
    const low = dataOf(await fetchExport(w.owner, 'lowStock', 'xlsx')) as any;
    expect(low.fileName).toBe('pharmacy-lowStock-2026-10-27.xlsx');
    for (const [report, input] of REPORTS) {
      const { fileName } = dataOf(await fetchExport(w.owner, report, 'csv', input)) as any;
      expect(fileName, report).toMatch(/^pharmacy-[A-Za-z]+-\d{4}-\d{2}-\d{2}(_\d{4}-\d{2}-\d{2})?\.csv$/);
    }
  });
});

describe('the content is what the report says, and what the rows say', () => {
  it('sales by branch: every row and the totals of each currency equal the sales and returns in the database', async () => {
    const out = await rowsOf('sales', { ...PERIOD, groupBy: 'branch' });
    const truth = await salesTruth(w.a.id, [w.b1, w.b2, w.b3], PERIOD.from, PERIOD.to);
    const rows = out.filter((r) => r.rowType === 'row');
    expect(rows).toHaveLength(truth.size);
    for (const [k, f] of truth) {
      const [branchId, currency] = k.split('|') as [string, string];
      const r = rows.find((x) => x.key === branchId && x.currency === currency)!;
      expect(r, k).toBeDefined();
      expect([r.count, r.gross, r.discount, r.sales, r.refunds, r.net], k).toEqual([String(f.count), fmt(f.gross, currency), fmt(f.discount, currency), fmt(f.sales, currency), fmt(f.refunds, currency), fmt(f.sales - f.refunds, currency)]);
      expect(r.label).toBe((await prisma().branch.findUniqueOrThrow({ where: { id: branchId } })).name);
    }
    for (const currency of ['IQD', 'USD']) {
      const total = out.find((r) => r.rowType === 'total' && r.currency === currency)!;
      const parts = [...truth].filter(([k]) => k.endsWith(`|${currency}`)).map(([, f]) => f);
      expect(total.sales).toBe(fmt(parts.reduce((n, f) => n + f.sales, 0n), currency));
      expect(total.net).toBe(fmt(parts.reduce((n, f) => n + f.sales - f.refunds, 0n), currency));
      expect(total.count).toBe(String(parts.reduce((n, f) => n + f.count, 0)));
    }
    expect(out.filter((r) => r.rowType === 'total')).toHaveLength(2);
  });

  it('money is exact decimal text with the currency beside it: USD has two decimals, IQD none, and no row mixes the two', async () => {
    const out = await rowsOf('sales', { ...PERIOD, groupBy: 'branch' });
    for (const r of out) {
      const pattern = r.currency === 'USD' ? /^-?\d+\.\d{2}$/ : /^-?\d+$/;
      for (const column of ['gross', 'discount', 'sales', 'refunds', 'net']) expect(r[column], `${r.currency} ${column}`).toMatch(pattern);
    }
    expect(new Set(out.map((r) => r.currency))).toEqual(new Set(['IQD', 'USD']));
  });

  it('a negative figure is written as a number, not escaped as a formula', async () => {
    // Window of the return day: the cashier of branch 1 sold on the 27th and 28th, and two returns of their sales are made on the 28th.
    const out = await rowsOf('sales', { from: '2026-10-28', to: '2026-10-28', groupBy: 'user', currency: 'IQD' }, w.manager1);
    const negative = out.filter((r) => r.rowType === 'row' && r.net.startsWith('-'));
    expect(negative.length).toBeGreaterThan(0);
    for (const r of negative) expect(r.net).toMatch(/^-\d+$/);
    expect(JSON.stringify(out)).not.toContain("'-");
  });

  it('returns: one row per return with its refund, equal to the returns in the database', async () => {
    const out = await rowsOf('returns', { ...PERIOD });
    const truth = await prisma().phReturn.findMany({ where: { restaurantId: w.a.id }, include: { sale: true } });
    expect(truth.length).toBe(2);
    expect(out).toHaveLength(truth.length);
    expect(out.map((r) => r.refund).sort()).toEqual(truth.map((r) => fmt(r.refundMinor, r.currency)).sort());
    expect(out.every((r) => r.date === '2026-10-28')).toBe(true);
    expect(new Set(out.map((r) => r.method))).toEqual(new Set(['CASH', 'TRANSFER_MANUAL']));
  });

  it('discounts: the discounted sales, with the discount in money and the percent from the gross', async () => {
    const out = await rowsOf('discounts', { ...PERIOD });
    const truth = await prisma().phSale.findMany({ where: { restaurantId: w.a.id, discountMinor: { gt: 0 } } });
    expect(out).toHaveLength(truth.length);
    expect(out.map((r) => r.discount).sort()).toEqual(truth.map((s) => fmt(s.discountMinor, s.currency)).sort());
    const tenPercent = out.find((r) => r.discountPercent === '10.00');
    expect(tenPercent, 'the 10 percent staff discount').toBeDefined();
  });

  it('margin by product: totals equal the plain-code margin, with the percent exact', async () => {
    const out = await rowsOf('margin', { ...PERIOD, groupBy: 'product' });
    const { start, end } = instantsOf(PERIOD.from, PERIOD.to);
    const truth = await marginTruth(w.a.id, [w.b1, w.b2, w.b3], start, end);
    for (const [currency, v] of truth.totals) {
      const total = out.find((r) => r.rowType === 'total' && r.currency === currency)!;
      expect([total.net, total.cost, total.margin]).toEqual([fmt(v.net, currency), fmt(v.cost, currency), fmt(v.net - v.cost, currency)]);
      const bp = ((v.net - v.cost) * 20_000n + v.net) / (2n * v.net);
      expect(total.marginPercent).toBe(`${bp / 100n}.${(bp % 100n).toString().padStart(2, '0')}`);
    }
    expect(out.filter((r) => r.rowType === 'row').length).toBeGreaterThan(1);
  });

  it('stock valuation by branch: buckets and value per currency equal the balances at batch cost', async () => {
    const out = await rowsOf('stockValuation', { groupBy: 'branch' });
    const truth = await stockTruth(w.a.id, [w.b1, w.b2, w.b3]);
    for (const [branchId, f] of truth) {
      const mine = out.filter((r) => r.rowType === 'row' && r.key === branchId);
      expect([mine[0]!.available, mine[0]!.reserved, mine[0]!.quarantine, mine[0]!.damaged]).toEqual([String(f.available), String(f.reserved), String(f.quarantine), String(f.damaged)]);
      for (const [currency, value] of f.values) expect(mine.find((r) => r.currency === currency)!.value, `${branchId} ${currency}`).toBe(fmt(value, currency));
      expect(mine[0]!.noCostRows).toBe(String(f.noCost));
      expect(mine[0]!.valuationComplete).toBe(f.noCost === 0 ? 'yes' : 'no');
    }
    for (const currency of ['IQD', 'USD'] as const) {
      const total = out.find((r) => r.rowType === 'total' && r.currency === currency)!;
      expect(total.value).toBe(fmt([...truth.values()].reduce((n, f) => n + (f.values.get(currency) ?? 0n), 0n), currency));
    }
  });

  it('expiry: one row per batch and branch in reach, expired first, with the band', async () => {
    const out = await rowsOf('expiry');
    const e1 = out.find((r) => r.lot === 'E1')!;
    expect([e1.band, e1.available, e1.expiryDate]).toEqual(['expired', '10', '2026-10-01']);
    // (E5 at branch 3 was sent away whole by transfer T4, first expiry first: it has no stock left to list.)
    const e2 = out.find((r) => r.lot === 'E2')!;
    expect([e2.band, e2.available]).toEqual(['d30', '17']);
    expect(out.find((r) => r.lot === 'E5')).toBeUndefined();
    const truth = await expiryTruth(w.a.id, [w.b1, w.b2, w.b3], '2026-10-27');
    const expired = out.filter((r) => r.band === 'expired').reduce((n, r) => n + Number(r.available) + Number(r.reserved) + Number(r.quarantine), 0);
    expect(expired).toBe([...truth.values()].reduce((n, f) => n + f.expired, 0));
    expect(out[0]!.band).toBe('expired');
  });

  it('damaged: current buckets per branch and the write-offs in the range', async () => {
    const out = await rowsOf('damaged');
    const truth = await stockTruth(w.a.id, [w.b1, w.b2, w.b3]);
    const current = out.filter((r) => r.section === 'current' && r.branch !== '');
    expect(current.reduce((n, r) => n + Number(r.damaged), 0)).toBe([...truth.values()].reduce((n, f) => n + f.damaged, 0));
    const damage = out.filter((r) => r.section === 'movements' && r.type === 'DAMAGE' && r.branch !== '');
    expect(damage.reduce((n, r) => n + Number(r.units), 0)).toBe(3);
    const adjust = out.filter((r) => r.section === 'movements' && r.type === 'ADJUST' && r.branch !== '');
    expect(adjust.reduce((n, r) => n + Number(r.units), 0)).toBe(4);
    const lost = out.filter((r) => r.section === 'transfers' && r.branch !== '');
    expect(lost.reduce((n, r) => n + Number(r.lost), 0)).toBe(4);
  });

  it('transfers: the transfers of the range with their quantities, equal to the database', async () => {
    const out = await rowsOf('transfers', { ...PERIOD });
    const { start, end } = instantsOf(PERIOD.from, PERIOD.to);
    const truth = await prisma().phTransfer.findMany({ where: { restaurantId: w.a.id, requestedAt: { gte: start, lt: end } }, include: { lines: true } });
    expect(out).toHaveLength(truth.length);
    for (const t of truth) {
      const r = out.find((x) => x.number === t.number)!;
      const sent = t.lines.filter((l) => l.requestLineId !== null);
      expect([r.status, r.sent, r.received, r.lost, r.damaged]).toEqual([t.status, String(sent.reduce((n, l) => n + l.sentQty, 0)), String(sent.reduce((n, l) => n + l.receivedQty, 0)), String(sent.reduce((n, l) => n + l.lostQty, 0)), String(sent.reduce((n, l) => n + l.damagedQty, 0))]);
    }
    expect(out.find((r) => r.status === 'PARTIAL')!.lost).toBe('4');
  });

  it('low stock: the products below their minimum, equal to the count worked out apart', async () => {
    const out = await rowsOf('lowStock');
    const truth = await lowStockTruth(w.a.id, [w.b1, w.b2, w.b3], '2026-10-27');
    expect(out).toHaveLength([...truth.values()].reduce((n, c) => n + c, 0));
    for (const [branchId, count] of truth) {
      const name = (await prisma().branch.findUniqueOrThrow({ where: { id: branchId } })).name;
      expect(out.filter((r) => r.branch === name)).toHaveLength(count);
    }
    expect(out.every((r) => Number(r.sellable) < Number(r.minQty) && Number(r.deficit) === Number(r.minQty) - Number(r.sellable))).toBe(true);
  });

  it('chain: one row per branch and a total row equal to the sum, per currency in its own columns', async () => {
    const out = await rowsOf('chain', { ...PERIOD });
    const truth = await salesTruth(w.a.id, [w.b1, w.b2, w.b3], PERIOD.from, PERIOD.to);
    const rows = out.filter((r) => r.rowType === 'branch');
    const total = out.filter((r) => r.rowType === 'total');
    expect(rows).toHaveLength(3);
    expect(total).toHaveLength(1);
    for (const currency of ['IQD', 'USD']) {
      for (const [i, b] of [w.b1, w.b2, w.b3].entries()) {
        const f = truth.get(`${b}|${currency}`);
        expect(rows[i]![`net_${currency}`], `${b} ${currency}`).toBe(fmt(f ? f.sales - f.refunds : 0n, currency));
        expect(rows[i]![`salesCount_${currency}`]).toBe(String(f?.count ?? 0));
      }
      const parts = [...truth].filter(([k]) => k.endsWith(`|${currency}`)).map(([, f]) => f);
      expect(total[0]![`net_${currency}`]).toBe(fmt(parts.reduce((n, f) => n + f.sales - f.refunds, 0n), currency));
      expect(total[0]![`discount_${currency}`]).toBe(fmt(parts.reduce((n, f) => n + f.discount, 0n), currency));
    }
    expect(total[0]!.inTransitOnce).toBe('22');
    expect(total[0]!.openRequestedOnce).toBe('2');
    expect(total[0]!.openSentOnce).toBe('3');
    expect(rows.reduce((n, r) => n + Number(r.inTransitIncoming) + Number(r.inTransitOutgoing), 0)).toBe(44);
    expect(total[0]!.lowStock).toBe(String(rows.reduce((n, r) => n + Number(r.lowStock), 0)));
  });
});

describe('a spreadsheet never reads a cell as a formula', () => {
  it.each([['='], ['+'], ['-'], ['@'], ['\t'], ['\r']])('a product name starting with %j is written as text, in CSV and in XLSX', async (lead) => {
    const name = `${lead}HYPERLINK("x")`;
    await prisma().phProduct.update({ where: { id: w.P.id }, data: { tradeName: name } });
    try {
      for (const format of ['csv', 'xlsx'] as const) {
        const { table: t } = await table(w.owner, 'lowStock', format);
        const cells = t.flat().filter((c) => c.includes('HYPERLINK'));
        expect(cells.length, `${format} has the product`).toBeGreaterThan(0);
        // (an XLSX file stores a carriage return as a line feed; the quote in front is what protects the cell)
        const lf = (s: string) => s.split(String.fromCharCode(13)).join(String.fromCharCode(10));
        for (const c of cells) expect(format === 'xlsx' ? lf(c) : c).toBe(format === 'xlsx' ? lf(`'${name}`) : `'${name}`);
      }
    } finally {
      await prisma().phProduct.update({ where: { id: w.P.id }, data: { tradeName: `PanadolX` } });
    }
  });

  it('a branch name and a reason are text cells too', async () => {
    const original = (await prisma().branch.findUniqueOrThrow({ where: { id: w.b2 } })).name;
    await prisma().branch.update({ where: { id: w.b2 }, data: { name: '=cmd|x' } });
    try {
      const { table: t } = await table(w.owner, 'sales', 'csv', { ...PERIOD, groupBy: 'branch' });
      expect(t.flat()).toContain("'=cmd|x");
      expect(t.flat()).not.toContain('=cmd|x');
    } finally {
      await prisma().branch.update({ where: { id: w.b2 }, data: { name: original } });
    }
  });
});

describe('the most rows', () => {
  it('a report above the cap is refused with a typed code, not cut; at the cap it is written', async () => {
    const ph = (await asPh(w.owner.userId, w.a.id))!;
    const scoped = phScopedClient(prisma(), ph);
    const cases: Array<[string, Record<string, unknown>, number]> = [
      ['returns', { ...PERIOD }, 2],
      ['lowStock', {}, 2],
      ['transfers', { ...PERIOD }, 3],
      ['sales', { ...PERIOD, groupBy: 'day' }, 2],
      ['expiry', {}, 4],
      ['discounts', { ...PERIOD }, 2],
    ];
    for (const [report, input, rows] of cases) {
      const run = (maxRows: number) => exportReport(scoped, ph, {}, { report, format: 'csv', ...input } as any, { maxRows, now: NOW });
      const ok = await run(1000);
      expect(ok.rows, report).toBeGreaterThanOrEqual(rows);
      await expect(run(ok.rows - 1), `${report} one below its size`).rejects.toMatchObject({ code: 'INVALID', fields: { phCode: 'EXPORT_TOO_LARGE' } });
      await expect(run(ok.rows), `${report} at its size`).resolves.toMatchObject({ rows: ok.rows });
    }
  });
});

describe('who gets which file', () => {
  it('a branch-limited person exports their branches only: no id and no name of the other branch in the file', async () => {
    const otherName = (await prisma().branch.findUniqueOrThrow({ where: { id: w.b2 } })).name;
    for (const [report, input] of REPORTS.filter(([r]) => r !== 'chain' && r !== 'transfers' && r !== 'damaged')) {
      const { table: t } = await table(w.manager13, report, 'csv', input);
      const text = JSON.stringify(t);
      expect(text, `${report} names branch 2`).not.toContain(w.b2);
      expect(text, `${report} names branch 2 by its name`).not.toContain(otherName);
      expect(t.length, `${report} is not empty`).toBeGreaterThan(1);
    }
    const all = await rowsOf('sales', { ...PERIOD, groupBy: 'branch' });
    const mine = await rowsOf('sales', { ...PERIOD, groupBy: 'branch' }, w.manager13);
    expect(mine.length).toBeLessThan(all.length);
    expect(new Set(mine.filter((r) => r.rowType === 'row').map((r) => r.key))).toEqual(new Set([w.b1, w.b3]));
  });

  it('the chain export of a person with one branch is refused with the same typed code as the dashboard', async () => {
    const result = await fetchExport(w.manager1, 'chain', 'csv', { ...PERIOD });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.fields?.phCode).toBe('CHAIN_NEEDS_MANY_BRANCHES');
  });

  it('a cashier, a pharmacist and a stock keeper are refused every export; a support actor too', async () => {
    const admin = await person('supportExport', { superAdmin: true });
    await grant(admin, w.a.id, { scopes: ['catalog.read', 'stock.read', 'sales.read'] });
    for (const [report, input] of REPORTS) {
      for (const who of [w.cashier1, w.pharmacist, w.stockP, admin]) expect(codeOf(await fetchExport(who, report, 'csv', input)), `${report}`).toBe('FORBIDDEN');
    }
  });

  it('another business cannot export this one', async () => {
    const other = await pharmacy('Elsewhere');
    const owner = await person('ownerElsewhere', { membership: [other.id, 'OWNER'] });
    for (const [report, input] of REPORTS) expect(codeOf(await fetchExport(owner, report, 'csv', input)), report).not.toBe('OK');
  });

  it('the margin export is the margin report: refused without its permissions (see report-exports-gating.test.ts) and for a bad range', async () => {
    const bad = await fetchExport(w.owner, 'sales', 'csv', { from: '2026-10-28', to: '2026-10-27' });
    expect(bad.ok).toBe(false);
    const missing = await fetchExport(w.owner, 'sales', 'csv', {});
    expect(missing.ok).toBe(false);
  });

  it('works while the subscription is lapsed (read-only mode)', async () => {
    const p = await pharmacy('LapsedExport', { branches: 2, subscription: 'ACTIVE', periodEndsInDays: -30, graceDays: 7 });
    const owner = await person('ownerLapsed', { membership: [p.id, 'OWNER'] });
    const data = dataOf(await ask(owner, exportQueries.report, { restaurantId: p.id, report: 'sales', format: 'csv', ...PERIOD, groupBy: 'day' })) as any;
    expect(parseCsv(new Uint8Array(Buffer.from(data.base64, 'base64')))).toHaveLength(1);
  });
});

describe('every export is audited, by counts only', () => {
  it('writes one audit row with the report, the format, the range and the row count, and no cell content', async () => {
    const known = new Set((await prisma().auditLog.findMany({ where: { restaurantId: w.a.id, action: 'pharmacy.report.export' }, select: { id: true } })).map((r) => r.id));
    const { data } = await table(w.owner, 'sales', 'csv', { ...PERIOD, groupBy: 'branch' });
    // (the test clock is frozen, so rows share one timestamp: the new row is the one not seen before)
    const fresh = (await prisma().auditLog.findMany({ where: { restaurantId: w.a.id, action: 'pharmacy.report.export' } })).filter((r) => !known.has(r.id));
    expect(fresh).toHaveLength(1);
    const last = fresh[0]!;
    expect(last.actorId).toBe(w.owner.userId);
    const changes = last.changes as Record<string, { before: unknown; after: unknown }>;
    expect(changes.report!.after).toBe('sales');
    expect(changes.format!.after).toBe('csv');
    expect(changes.rows!.after).toBe(data.rows);
    expect(changes.from!.after).toBe(PERIOD.from);
    const text = JSON.stringify(last);
    for (const name of [`Aspirin`, `Panadol`, `branch 1`, `branch 2`]) expect(text).not.toContain(name);
  });

  it('a refused export writes nothing', async () => {
    const before = await prisma().auditLog.count({ where: { restaurantId: w.a.id, action: 'pharmacy.report.export' } });
    await fetchExport(w.cashier1, 'sales', 'csv', { ...PERIOD });
    await fetchExport(w.manager1, 'chain', 'csv', { ...PERIOD });
    expect(await prisma().auditLog.count({ where: { restaurantId: w.a.id, action: 'pharmacy.report.export' } })).toBe(before);
  });
});
