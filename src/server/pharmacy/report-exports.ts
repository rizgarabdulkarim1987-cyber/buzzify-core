/* eslint-disable no-restricted-properties -- read-only label lookups: bound to the actor's restaurantId, and none of them writes */
import { z } from 'zod';
import type { ScopedClient } from '@/server/data/tenant-db';
import { utcToday } from '@/server/domain/pharmacy/expiry';
import { baghdadDay } from '@/server/domain/pharmacy/reports-domain';
import { bpText, decimalText, exportCells, exportFileName, num, numOrBlank, type Cell } from '@/server/domain/pharmacy/export-sheet';
import { writeCsv, writeXlsx } from '@/server/sheets/write';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from './actor';
import { chainDashboard, chainInput } from './chain';
import { expiryInput, listExpiry, MAX_EXPIRY_ROWS } from './expiry';
import { mayViewCost } from './products';
import { discountsReport, returnsReport, salesReport } from './reports';
import { scopeOf, type Currency } from './reports-common';
import { discountsInput, marginInput, returnsInput, salesInput } from './reports-inputs';
import { damagedInput, damagedReport, transfersReport, transfersReportInput } from './reports-ledger';
import { marginReport } from './reports-margin';
import { expiryBandTotals, lowStockInput, lowStockReport, stockValuation, valuationInput, type ExpiryBandTotals } from './reports-stock';

/**
 * Report exports (phase 6, task 5; R6-9): every report as a CSV (UTF-8 with a byte order mark) or an XLSX through the sheet
 * writers. The file is the report's own answer, fetched whole (never a page of it), for the branches the person works in:
 *  - the permission is the report's, and cost or margin columns are LEFT OUT (not blank) without `cost.view` / `profit.view`;
 *  - the file carries every figure the report carries (R6-9, report 5b): the detail rows, then the totals and summary sections as
 *    rows of their own, told apart by the `rowType` column (`row` is a detail row; `total`, `branch`, `summary`, ... are the report's
 *    own figures). A margin file therefore always carries the counts and the excluded sales that mark it as an estimate;
 *  - money is exact decimal text in major units with its currency in the next column, and is never summed across currencies. In an
 *    XLSX it stays that exact text too (R6-9b); counts are numbers. Percentages are exact two-decimal text; dates are Baghdad dates;
 *  - a number is written as it is (a negative figure keeps its minus); every text cell goes through `escapeCell`, so nothing
 *    typed by a person is read as a formula (`exportCells` does both, and `num` refuses anything that is not a plain decimal);
 *  - more rows than the cap is REFUSED (`EXPORT_TOO_LARGE`), never cut. The reports are fetched with one row more than the cap, so
 *    a report that does not fit always shows up as too many rows in the final count and no per-report "has more" test is needed;
 *  - the expiry export keeps the phase 2 limit of 20,000 batches (R6-9a) and refuses past it with its own code and message;
 *  - the file name carries the report and the range (or, for the two reports "as of today", the UTC day their figures were
 *    computed for), nothing else.
 * The service reads and builds; the audit row of a successful export is written by `auditReportExport` (export-audit.ts).
 */

export const REPORT_EXPORT_MAX_ROWS = 50_000;
export const EXPORT_REPORTS = ['sales', 'returns', 'discounts', 'margin', 'stockValuation', 'expiry', 'damaged', 'transfers', 'lowStock', 'chain'] as const;
export type ExportReportName = (typeof EXPORT_REPORTS)[number];

const day = z.string().trim().max(10);
export const exportReportInput = z.object({
  report: z.enum(EXPORT_REPORTS, 'Choose a report'),
  format: z.enum(['csv', 'xlsx'], 'Choose CSV or XLSX'),
  from: day.optional(),
  to: day.optional(),
  groupBy: z.string().max(20).optional(),
  currency: z.enum(['IQD', 'USD'], 'Choose IQD or USD').optional(),
  userId: z.string().min(1).max(64).optional(),
  status: z.string().max(20).optional(),
  categoryId: z.string().min(1).max(64).optional(),
});
export type ExportReportInput = z.input<typeof exportReportInput>;

export interface ReportExport {
  fileName: string;
  contentType: string;
  /** The file, base64. */
  base64: string;
  /** Data rows (the header is not counted; total rows are). */
  rows: number;
  report: ExportReportName;
  format: 'csv' | 'xlsx';
  from: string | null;
  to: string | null;
  /** How many branches the file covers (the chosen branch narrows it to one). */
  branches: number;
}

const CONTENT_TYPES = { csv: 'text/csv', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } as const;

interface Sheet {
  headers: string[];
  rows: Cell[][];
  range: { from: string; to: string } | null;
  /** For the reports computed as of today: the day (UTC, the expiry rule) the figures were computed for, used in the file name. */
  day?: string;
}

const tooLarge = (limit: number, dated: boolean) =>
  new StudioError('INVALID', dated ? 'This report has too many rows for one file. Narrow the dates or choose a branch.' : 'This report has too many rows for one file. Choose a branch.', { phCode: 'EXPORT_TOO_LARGE', limit: String(limit) });
const expiryTooLarge = (limit: number) =>
  new StudioError('INVALID', 'This chain has too many expiring batches for one file (the limit is 20,000). Choose one branch and export again.', { phCode: 'EXPORT_EXPIRY_TOO_LARGE', limit: String(limit) });

/** The report's own input schema, applied to the fields the export carries; a bad field is reported on that field. */
function parsed<S extends z.ZodType>(schema: S, raw: Record<string, unknown>): z.output<S> {
  const result = schema.safeParse(Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined)));
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) fields[String(issue.path[0] ?? 'report')] ??= issue.message;
  throw new StudioError('INVALID', 'Check the highlighted fields', fields);
}

/** The report's input with the export's own page size: the screens' limit on a page does not apply to a whole file. */
function parsedWhole<S extends z.ZodType>(schema: S, raw: Record<string, unknown>, take: number): z.output<S> & { take: number; cursor: null } {
  return { ...(parsed(schema, raw) as object), take, cursor: null } as z.output<S> & { take: number; cursor: null };
}

const money = (minor: string, currency: Currency): Cell => num(decimalText(BigInt(minor), currency));
const n = (v: number): Cell => num(String(v));
const nOrBlank = (v: number | undefined | null): Cell => (v === undefined || v === null ? '' : num(String(v)));
const pct = (bp: number | null): Cell => numOrBlank(bp === null ? null : bpText(bp));
const dateOf = (iso: string | null): string => (iso ? baghdadDay(new Date(iso)) : '');
const yesNo = (v: boolean) => (v ? 'yes' : 'no');
/** `count` empty cells. */
const gap = (count: number): Cell[] => Array.from({ length: count }, () => '');

interface Labels {
  branch: Map<string, string>;
  product: Map<string, string>;
  category: Map<string, string>;
  user: Map<string, string>;
}

/**
 * Names of users, looked up inside the business: a user is named only if they belong to it (a member, staff, or the seller of one
 * of its sales). The ids come from this business's report rows already; the join keeps the raw read bound all the same.
 */
export async function userNamesFor(scoped: ScopedClient, restaurantId: string, ids: readonly string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return new Map();
  const users = await scoped.$queryRaw<Array<{ id: string; name: string | null }>>`
    SELECT u."id", u."name" FROM "user" u
    WHERE u."id" = ANY(${wanted}::text[])
      AND (EXISTS (SELECT 1 FROM "Membership" m WHERE m."userId" = u."id" AND m."restaurantId" = ${restaurantId})
        OR EXISTS (SELECT 1 FROM "PhStaff" s WHERE s."userId" = u."id" AND s."restaurantId" = ${restaurantId})
        OR EXISTS (SELECT 1 FROM "PhSale" p WHERE p."soldById" = u."id" AND p."restaurantId" = ${restaurantId}))`;
  return new Map(users.map((u) => [u.id, u.name ?? '']));
}

/** Names for the ids a report carries: branches of the actor, products and categories of the business, users who sold. */
async function labelsFor(scoped: ScopedClient, ph: PhActor, ids: { branches: readonly string[]; products?: Iterable<string>; categories?: Iterable<string>; users?: Iterable<string> }): Promise<Labels> {
  const [branches, products, categories, user] = await Promise.all([
    scoped.branch.findMany({ where: { id: { in: [...ids.branches] } }, select: { id: true, name: true } }),
    scoped.phProduct.findMany({ where: { id: { in: [...(ids.products ?? [])] } }, select: { id: true, tradeName: true } }),
    scoped.phCategory.findMany({ where: { id: { in: [...(ids.categories ?? [])] } }, select: { id: true, name: true } }),
    userNamesFor(scoped, ph.restaurantId, [...(ids.users ?? [])]),
  ]);
  return {
    branch: new Map(branches.map((b) => [b.id, b.name])),
    product: new Map(products.map((p) => [p.id, p.tradeName])),
    category: new Map(categories.map((c) => [c.id, c.name])),
    user,
  };
}

const named = (map: Map<string, string>, id: string) => map.get(id) ?? '';

// Each report ------------------------------------------------------------------------------------------------------------

async function salesSheet(scoped: ScopedClient, ph: PhActor, place: Place, raw: ExportReportInput, take: number): Promise<Sheet> {
  const input = parsedWhole(salesInput, { from: raw.from, to: raw.to, groupBy: raw.groupBy, currency: raw.currency }, take);
  const r = await salesReport(scoped, ph, place, input);
  const labels = await labelsFor(scoped, ph, {
    branches: scopeOf(ph, place.branchId).branchIds,
    products: r.groupBy === 'product' ? r.rows.map((x) => x.key) : [],
    categories: r.groupBy === 'category' ? r.rows.map((x) => x.key) : [],
    users: r.groupBy === 'user' ? r.rows.map((x) => x.key) : [],
  });
  const label = (key: string) => (r.groupBy === 'branch' ? named(labels.branch, key) : r.groupBy === 'product' ? named(labels.product, key) : r.groupBy === 'category' ? named(labels.category, key) : r.groupBy === 'user' ? named(labels.user, key) : key);
  const rows: Cell[][] = r.rows.map((x) => [
    x.key, label(x.key), x.currency, n(x.count), nOrBlank(x.qty), money(x.grossMinor, x.currency), money(x.discountMinor, x.currency),
    x.roundingMinor === undefined ? '' : money(x.roundingMinor, x.currency), money(x.salesMinor, x.currency), money(x.refundsMinor, x.currency), money(x.netMinor, x.currency),
    x.avgTicketMinor === null ? '' : money(x.avgTicketMinor, x.currency), 'row',
  ]);
  for (const t of r.totals) {
    rows.push(['', '', t.currency, n(t.count), '', money(t.grossMinor, t.currency), money(t.discountMinor, t.currency), money(t.roundingMinor, t.currency), money(t.salesMinor, t.currency), money(t.refundsMinor, t.currency), money(t.netMinor, t.currency), t.avgTicketMinor === null ? '' : money(t.avgTicketMinor, t.currency), 'total']);
  }
  return { headers: ['key', 'label', 'currency', 'count', 'qty', 'gross', 'discount', 'rounding', 'sales', 'refunds', 'net', 'avgTicket', 'rowType'], rows, range: { from: r.from, to: r.to } };
}

async function returnsSheet(scoped: ScopedClient, ph: PhActor, place: Place, raw: ExportReportInput, take: number): Promise<Sheet> {
  const input = parsedWhole(returnsInput, { from: raw.from, to: raw.to, userId: raw.userId, currency: raw.currency }, take);
  const r = await returnsReport(scoped, ph, place, input);
  const labels = await labelsFor(scoped, ph, { branches: scopeOf(ph, place.branchId).branchIds });
  // number, saleNumber, date, branch, reason, approvedBy, method, currency, refund, credit, count, rowType
  const line = (c: { branch?: string; reason?: string; method?: string; currency?: Currency; refund?: string; credit?: string; count?: number }, type: string): Cell[] => [
    '', '', '', c.branch ?? '', c.reason ?? '', '', c.method ?? '', c.currency ?? '', c.refund !== undefined && c.currency ? money(c.refund, c.currency) : '', c.credit !== undefined && c.currency ? money(c.credit, c.currency) : '', nOrBlank(c.count), type,
  ];
  return {
    headers: ['number', 'saleNumber', 'date', 'branch', 'reason', 'approvedBy', 'method', 'currency', 'refund', 'credit', 'count', 'rowType'],
    rows: [
      ...r.rows.map((x): Cell[] => [x.number ?? '', x.saleNumber ?? '', dateOf(x.createdAt), named(labels.branch, x.branchId), x.reason, x.approverName ?? '', x.method, x.currency, money(x.refundMinor, x.currency), money(x.creditMinor, x.currency), '', 'row']),
      ...r.totals.map((t) => line({ currency: t.currency, refund: t.refundMinor, credit: t.creditMinor, count: t.count }, 'total')),
      ...r.byBranch.map((t) => line({ branch: named(labels.branch, t.branchId), currency: t.currency, refund: t.refundMinor, credit: t.creditMinor, count: t.count }, 'branch')),
      ...r.byReason.map((t) => line({ reason: t.reason, count: t.count }, 'reason')),
      ...r.byMethod.map((t) => line({ method: t.method, currency: t.currency, refund: t.refundMinor, count: t.count }, 'method')),
    ],
    range: { from: r.from, to: r.to },
  };
}

async function discountsSheet(scoped: ScopedClient, ph: PhActor, place: Place, raw: ExportReportInput, take: number): Promise<Sheet> {
  const input = parsedWhole(discountsInput, { from: raw.from, to: raw.to, userId: raw.userId, currency: raw.currency }, take);
  const r = await discountsReport(scoped, ph, place, input);
  const labels = await labelsFor(scoped, ph, { branches: scopeOf(ph, place.branchId).branchIds, users: r.rows.map((x) => x.soldById) });
  // number, date, branch, soldBy, currency, gross, discount, discountPercent, overLimit, salesCount, discountedCount, rowType
  const sum = (c: { branch?: string; soldBy?: string; currency: Currency; gross: string; discount: string; bp: number | null; salesCount?: number; discountedCount: number }, type: string): Cell[] => [
    '', '', c.branch ?? '', c.soldBy ?? '', c.currency, money(c.gross, c.currency), money(c.discount, c.currency), pct(c.bp), '', nOrBlank(c.salesCount), n(c.discountedCount), type,
  ];
  return {
    headers: ['number', 'date', 'branch', 'soldBy', 'currency', 'gross', 'discount', 'discountPercent', 'overLimit', 'salesCount', 'discountedCount', 'rowType'],
    rows: [
      ...r.rows.map((x): Cell[] => [x.number ?? '', dateOf(x.completedAt), named(labels.branch, x.branchId), named(labels.user, x.soldById), x.currency, money(x.grossMinor, x.currency), money(x.discountMinor, x.currency), num(bpText(x.discountBp)), yesNo(x.overLimit), '', '', 'row']),
      ...r.totals.map((t) => sum({ currency: t.currency, gross: t.grossMinor, discount: t.discountMinor, bp: t.discountBp, salesCount: t.salesCount, discountedCount: t.discountedCount }, 'total')),
      ...r.byBranch.map((t) => sum({ branch: named(labels.branch, t.branchId), currency: t.currency, gross: t.grossMinor, discount: t.discountMinor, bp: t.discountBp, salesCount: t.salesCount, discountedCount: t.discountedCount }, 'branch')),
      ...r.topUsers.map((u) => sum({ soldBy: u.userName ?? '', currency: u.currency, gross: u.grossMinor, discount: u.discountMinor, bp: u.discountBp, discountedCount: u.discountedCount }, 'topUser')),
      ...(r.maxDiscountPercent === null ? [] : [[...gap(7), num(String(r.maxDiscountPercent)), ...gap(3), 'limit'] as Cell[]]),
    ],
    range: { from: r.from, to: r.to },
  };
}

async function marginSheet(scoped: ScopedClient, ph: PhActor, place: Place, raw: ExportReportInput, take: number): Promise<Sheet> {
  const input = parsedWhole(marginInput, { from: raw.from, to: raw.to, groupBy: raw.groupBy, currency: raw.currency }, take);
  // The margin report itself refuses without report.view + profit.view + cost.view: the export has no weaker door.
  const r = await marginReport(scoped, ph, place, input);
  const labels = await labelsFor(scoped, ph, {
    branches: scopeOf(ph, place.branchId).branchIds,
    products: r.groupBy === 'product' ? r.rows.map((x) => x.key) : [],
    categories: r.groupBy === 'category' ? r.rows.map((x) => x.key) : [],
  });
  const label = (key: string) => (r.groupBy === 'branch' ? named(labels.branch, key) : r.groupBy === 'product' ? named(labels.product, key) : r.groupBy === 'category' ? named(labels.category, key) : key);
  // key, label, currency, net, cost, margin, marginPercent, incompleteCostRows, mixedCurrencyRows, rowType
  const line = (key: string, text: string, m: { currency: Currency; netMinor: string; costMinor: string; marginMinor: string; marginBp: number | null }, type: string, counts?: { incompleteCostRows: number; mixedCurrencyRows: number }): Cell[] => [
    key, text, m.currency, money(m.netMinor, m.currency), money(m.costMinor, m.currency), money(m.marginMinor, m.currency), pct(m.marginBp), nOrBlank(counts?.incompleteCostRows), nOrBlank(counts?.mixedCurrencyRows), type,
  ];
  return {
    headers: ['key', 'label', 'currency', 'net', 'cost', 'margin', 'marginPercent', 'incompleteCostRows', 'mixedCurrencyRows', 'rowType'],
    rows: [
      ...r.rows.map((x) => line(x.key, label(x.key), x, 'row')),
      ...r.totals.map((t) => line('', '', t, 'total')),
      ...r.byBranch.map((b) => line(b.branchId, named(labels.branch, b.branchId), b, 'branch', b)),
      // The caveat of an estimate: lines left out for want of a cost (or for a cost in another currency), and the sales they carried.
      [...gap(7), n(r.incompleteCostRows), n(r.mixedCurrencyRows), 'summary'],
      ...r.excluded.map((e): Cell[] => ['', '', e.currency, money(e.netMinor, e.currency), ...gap(5), 'excluded']),
    ],
    range: { from: r.from, to: r.to },
  };
}

async function valuationSheet(scoped: ScopedClient, ph: PhActor, place: Place, raw: ExportReportInput, take: number): Promise<Sheet> {
  const input = parsedWhole(valuationInput, { groupBy: raw.groupBy, categoryId: raw.categoryId }, take);
  const r = await stockValuation(scoped, ph, place, input);
  const labels = await labelsFor(scoped, ph, { branches: scopeOf(ph, place.branchId).branchIds });
  const withCost = mayViewCost(ph);
  type Row = { key: string; label: string; available: number; reserved: number; quarantine: number; damaged: number; noCostRows?: number; valuationComplete?: boolean; values?: Array<{ currency: Currency; valueMinor: string; damagedValueMinor: string }> };
  // key, label, available, reserved, quarantine, damaged, [currency, value, damagedValue, noCostRows, valuationComplete], inTransitUnits, inTransitTransfers, rowType
  const lines = (row: Row, type: string): Cell[][] => {
    const base: Cell[] = [row.key, row.label, n(row.available), n(row.reserved), n(row.quarantine), n(row.damaged)];
    if (!withCost) return [[...base, '', '', type]];
    const tail = (currency: Cell, value: Cell, damaged: Cell): Cell[] => [currency, value, damaged, n(row.noCostRows ?? 0), yesNo(row.valuationComplete ?? true), '', '', type];
    const values = row.values ?? [];
    if (values.length === 0) return [[...base, ...tail('', '', '')]];
    return values.map((v) => [...base, ...tail(v.currency, money(v.valueMinor, v.currency), money(v.damagedValueMinor, v.currency))]);
  };
  const out: Cell[][] = r.rows.flatMap((x) => lines({ ...x }, 'row'));
  out.push(...r.byBranch.flatMap((b) => lines({ key: b.branchId, label: named(labels.branch, b.branchId), ...b }, 'branch')));
  out.push(...lines({ key: '', label: '', ...r.totals }, 'total'));
  // What is on the road now (not stock of any branch yet): units and transfers, its value per currency, and the destinations.
  const costGap = withCost ? gap(5) : [];
  out.push([...gap(2), ...gap(4), ...costGap, n(r.inTransit.units), n(r.inTransit.transfers), 'inTransit']);
  if (withCost) for (const v of r.inTransit.values ?? []) out.push([...gap(2), ...gap(4), v.currency, money(v.valueMinor, v.currency), ...gap(3), '', '', 'inTransit']);
  // A transfer on the road may be headed to a branch the person does not work in: its units stay, its id and name do not.
  const mine = new Set(scopeOf(ph, place.branchId).branchIds);
  for (const d of r.inTransit.byDestination) out.push([mine.has(d.branchId) ? d.branchId : '', named(labels.branch, d.branchId), ...gap(4), ...costGap, n(d.units), '', 'inTransitBranch']);
  const base = ['key', 'label', 'available', 'reserved', 'quarantine', 'damaged'];
  return { headers: [...base, ...(withCost ? ['currency', 'value', 'damagedValue', 'noCostRows', 'valuationComplete'] : []), 'inTransitUnits', 'inTransitTransfers', 'rowType'], rows: out, range: null };
}

async function expirySheet(scoped: ScopedClient, ph: PhActor, place: Place, now: Date, maxBatches: number): Promise<Sheet> {
  const scope = scopeOf(ph, place.branchId);
  const withCost = mayViewCost(ph);
  const labels = await labelsFor(scoped, ph, { branches: scope.branchIds });
  // The phase 2 list refuses a chain with more batches in reach than its limit (20,000): the file cannot hold them either, and the
  // person is told to choose a branch. The band totals below are an aggregate with no such limit.
  const list = await listExpiry(scoped, ph, { ...expiryInput.parse({ days: 90, includeExpired: true }), pageSize: REPORT_EXPORT_MAX_ROWS + 1, cursor: null, maxRows: maxBatches, ...(place.branchId ? { branchId: place.branchId } : {}) }).catch((error: unknown) => {
    if (error instanceof StudioError && error.code === 'CONFLICT' && error.fields?.phCode === 'TOO_MANY') throw expiryTooLarge(maxBatches);
    throw error;
  });
  const bands = await expiryBandTotals(scoped, scope, withCost);
  // product, strength, form, lot, expiryDate, branch, available, reserved, quarantine, band, daysToExpiry, action, [unitCost, costCurrency], stockRows, units, [value, noCostRows], rowType
  const head = (o: { branch?: string; band: string }): Cell[] => ['', '', '', '', '', o.branch ?? '', '', '', '', o.band, '', ''];
  const bandRows = (branch: string, bs: ExpiryBandTotals[]): Cell[][] =>
    bs.flatMap((b) => {
      const values = b.values ?? [];
      const line = (currency: Currency | '', value: string | null): Cell[] => [
        ...head({ branch, band: b.band }), ...(withCost ? ['', currency] : []), n(b.rows), n(b.units), ...(withCost ? [value === null || currency === '' ? '' : money(value, currency), n(b.noCostRows ?? 0)] : []), 'bandTotal',
      ];
      return withCost && values.length > 0 ? values.map((v) => line(v.currency, v.valueMinor)) : [line('', null)];
    });
  const rows: Cell[][] = list.items.map((x) => [
    x.product.tradeName, x.product.strength, x.product.form, x.batch.lot, x.batch.expiryDate, named(labels.branch, x.branchId), n(x.buckets.available), n(x.buckets.reserved), n(x.buckets.quarantine),
    x.band, n(x.daysToExpiry), x.action.status,
    ...(withCost ? [x.unitCostMinor && x.currency ? money(x.unitCostMinor, x.currency) : '', x.currency ?? ''] : []),
    '', '', ...(withCost ? ['', ''] : []), 'row',
  ]);
  rows.push(...bandRows('', bands.totals));
  for (const b of bands.byBranch) rows.push(...bandRows(named(labels.branch, b.branchId), b.bands));
  // The phase 2 list's own counts of stock rows per band (the horizon is 90 days; d180 is not on this list).
  for (const [band, count] of Object.entries(list.totals)) rows.push([...head({ band }), ...(withCost ? ['', ''] : []), n(count), '', ...(withCost ? ['', ''] : []), 'listTotal']);
  return {
    headers: ['product', 'strength', 'form', 'lot', 'expiryDate', 'branch', 'available', 'reserved', 'quarantine', 'band', 'daysToExpiry', 'action', ...(withCost ? ['unitCost', 'costCurrency'] : []), 'stockRows', 'units', ...(withCost ? ['value', 'noCostRows'] : []), 'rowType'],
    rows,
    range: null,
    day: utcToday(now),
  };
}

async function damagedSheet(scoped: ScopedClient, ph: PhActor, place: Place, raw: ExportReportInput): Promise<Sheet> {
  const input = parsed(damagedInput, { from: raw.from, to: raw.to });
  const r = await damagedReport(scoped, ph, place, input);
  const labels = await labelsFor(scoped, ph, { branches: scopeOf(ph, place.branchId).branchIds });
  const withCost = mayViewCost(ph);
  const q = (v: number) => n(v);
  // One table, one block per section; the columns a section does not use stay empty.
  const row = (c: { section: string; rowType: string; type?: string; branch?: string; toBranch?: string; reason?: string; damaged?: number; quarantine?: number; units?: number; lost?: number; currency?: Currency; damagedValue?: string; quarantineValue?: string; value?: string; lostValue?: string }): Cell[] => {
    const amount = (minor: string | undefined): Cell => (minor !== undefined && c.currency ? money(minor, c.currency) : '');
    return [
      c.section, c.type ?? '', c.branch ?? '', c.toBranch ?? '', c.reason ?? '',
      c.damaged === undefined ? '' : q(c.damaged), c.quarantine === undefined ? '' : q(c.quarantine), c.units === undefined ? '' : q(c.units), c.lost === undefined ? '' : q(c.lost),
      ...(withCost ? [c.currency ?? '', amount(c.damagedValue), amount(c.quarantineValue), amount(c.value), amount(c.lostValue)] : []),
      c.rowType,
    ];
  };
  const rows: Cell[][] = [];
  for (const b of r.current.byBranch) rows.push(row({ section: 'current', rowType: 'branch', branch: named(labels.branch, b.branchId), damaged: b.damaged, quarantine: b.quarantine }));
  rows.push(row({ section: 'current', rowType: 'total', damaged: r.current.totals.damaged, quarantine: r.current.totals.quarantine }));
  for (const v of r.current.totals.values ?? []) rows.push(row({ section: 'current', rowType: 'value', currency: v.currency, damagedValue: v.damagedValueMinor, quarantineValue: v.quarantineValueMinor }));
  for (const b of r.movements.byBranch) rows.push(row({ section: 'movements', rowType: 'branch', type: b.type, branch: named(labels.branch, b.branchId), units: b.units }));
  for (const t of r.movements.totals) {
    rows.push(row({ section: 'movements', rowType: 'total', type: t.type, units: t.units }));
    for (const v of t.values ?? []) rows.push(row({ section: 'movements', rowType: 'value', type: t.type, currency: v.currency, value: v.valueMinor }));
  }
  for (const x of r.movements.reasons) rows.push(row({ section: 'movementReasons', rowType: 'reason', type: x.type, reason: x.reason, units: x.units }));
  for (const x of r.transfers.byRoute) rows.push(row({ section: 'transfers', rowType: 'route', branch: named(labels.branch, x.fromBranchId), toBranch: named(labels.branch, x.toBranchId), damaged: x.damagedQty, lost: x.lostQty }));
  rows.push(row({ section: 'transfers', rowType: 'total', damaged: r.transfers.totals.damagedQty, lost: r.transfers.totals.lostQty }));
  for (const v of r.transfers.totals.values ?? []) rows.push(row({ section: 'transfers', rowType: 'value', currency: v.currency, damagedValue: v.damagedValueMinor, lostValue: v.lostValueMinor }));
  return {
    headers: ['section', 'type', 'branch', 'toBranch', 'reason', 'damaged', 'quarantine', 'units', 'lost', ...(withCost ? ['currency', 'damagedValue', 'quarantineValue', 'value', 'lostValue'] : []), 'rowType'],
    rows,
    range: { from: r.from, to: r.to },
  };
}

async function transfersSheet(scoped: ScopedClient, ph: PhActor, place: Place, raw: ExportReportInput, take: number): Promise<Sheet> {
  const input = parsedWhole(transfersReportInput, { from: raw.from, to: raw.to, status: raw.status }, take);
  const r = await transfersReport(scoped, ph, place, input);
  const labels = await labelsFor(scoped, ph, { branches: scopeOf(ph, place.branchId).branchIds });
  const b = (id: string) => named(labels.branch, id);
  // number, from, to, status, requestedDate, sentDate, receivedDate, requested, sent, received, lost, damaged, count, units, reason, avgTransitSeconds, rowType
  const sum = (c: { from?: string; to?: string; status?: string; lost?: number; damaged?: number; count?: number; units?: number; reason?: string; avg?: number }, type: string): Cell[] => [
    '', c.from ?? '', c.to ?? '', c.status ?? '', '', '', '', '', '', '', nOrBlank(c.lost), nOrBlank(c.damaged), nOrBlank(c.count), nOrBlank(c.units), c.reason ?? '', nOrBlank(c.avg), type,
  ];
  return {
    headers: ['number', 'from', 'to', 'status', 'requestedDate', 'sentDate', 'receivedDate', 'requested', 'sent', 'received', 'lost', 'damaged', 'count', 'units', 'reason', 'avgTransitSeconds', 'rowType'],
    rows: [
      ...r.rows.map((x): Cell[] => [x.number ?? '', x.fromBranchName, x.toBranchName, x.status, dateOf(x.requestedAt), dateOf(x.sentAt), dateOf(x.receivedAt), n(x.requestedQty), n(x.sentQty), n(x.receivedQty), n(x.lostQty), n(x.damagedQty), '', '', '', '', 'row']),
      sum({ count: r.total }, 'total'),
      ...r.byStatus.map((s) => sum({ status: s.status, count: s.count }, 'status')),
      ...r.byBranch.map((x) => sum({ from: b(x.branchId), count: x.count }, 'branch')),
      ...r.byRoute.map((x) => sum({ from: b(x.fromBranchId), to: b(x.toBranchId), status: x.status, count: x.count }, 'route')),
      sum({ units: r.inTransit.units, count: r.inTransit.transfers }, 'inTransit'),
      ...r.inTransit.byRoute.map((x) => sum({ from: b(x.fromBranchId), to: b(x.toBranchId), units: x.units }, 'inTransitRoute')),
      sum({ lost: r.lost.lostQty, damaged: r.lost.damagedQty }, 'lost'),
      ...r.lost.byReason.map((x) => sum({ reason: x.reason, lost: x.lostQty }, 'lostReason')),
      ...(r.avgTransitSeconds === null ? [] : [sum({ avg: r.avgTransitSeconds }, 'avgTransit')]),
    ],
    range: { from: r.from, to: r.to },
  };
}

async function lowStockSheet(scoped: ScopedClient, ph: PhActor, place: Place, now: Date, take: number): Promise<Sheet> {
  const r = await lowStockReport(scoped, ph, place, parsedWhole(lowStockInput, {}, take));
  const labels = await labelsFor(scoped, ph, { branches: scopeOf(ph, place.branchId).branchIds });
  return {
    headers: ['branch', 'product', 'strength', 'form', 'minQty', 'sellable', 'deficit', 'reorderQty', 'count', 'rowType'],
    rows: [
      ...r.rows.map((x): Cell[] => [named(labels.branch, x.branchId), x.tradeName, x.strength, x.form, n(x.minQty), n(x.sellable), n(x.deficit), n(x.reorderQty), '', 'row']),
      [...gap(8), n(r.total), 'total'],
      ...r.byBranch.map((x): Cell[] => [named(labels.branch, x.branchId), ...gap(7), n(x.count), 'branch']),
    ],
    range: null,
    day: utcToday(now),
  };
}

async function chainSheet(scoped: ScopedClient, ph: PhActor, raw: ExportReportInput, now: Date): Promise<Sheet> {
  const input = parsed(chainInput, { from: raw.from, to: raw.to, currency: raw.currency });
  const d = await chainDashboard(scoped, ph, input, now);
  const withMargin = d.estimatedMargin === true;
  const withCost = mayViewCost(ph);
  const currencies: Currency[] = input.currency ? [input.currency] : ['IQD', 'USD'];
  const headers = [
    'branch',
    ...currencies.flatMap((c) => [`salesCount_${c}`, `net_${c}`, `discount_${c}`, `refunds_${c}`, ...(withMargin ? [`marginPercent_${c}`] : []), ...(withCost ? [`stockValue_${c}`] : []), `rank_${c}`]),
    'expiredUnits', 'expiring30Units', 'inTransitIncoming', 'inTransitOutgoing', 'inTransitOnce',
    'openIncomingRequested', 'openIncomingSent', 'openOutgoingRequested', 'openOutgoingSent', 'openRequestedOnce', 'openSentOnce', 'lowStock',
    // Whether the stock value is complete (some stock has no cost) and the margin's left-out lines: the caveats of the figures above.
    ...(withCost ? ['noCostRows', 'valuationComplete'] : []),
    ...(withMargin ? currencies.flatMap((c) => [`marginIncomplete_${c}`, `marginMixed_${c}`]) : []),
    'rowType',
  ];
  type Figures = (typeof d.branches)[number] | typeof d.total;
  const expiry = (f: Figures) => [n(f.expiry.expired.units), n(f.expiry.d30.units)];
  const money0 = (minor: string | undefined, c: Currency): Cell => money(minor ?? '0', c);
  const perCurrency = (f: Figures, rankOf: (c: Currency) => number | null): Cell[] =>
    currencies.flatMap((c) => {
      const s = f.sales.find((x) => x.currency === c);
      const m = f.margin?.find((x) => x.currency === c);
      return [
        n(s?.count ?? 0), money0(s?.netMinor, c), money0(s?.discountMinor, c), money0(s?.refundsMinor, c),
        ...(withMargin ? [pct(m?.marginBp ?? null)] : []),
        ...(withCost ? [money0(f.stock.values?.find((v) => v.currency === c)?.valueMinor, c)] : []),
        nOrBlank(rankOf(c)),
      ];
    });
  const caveats = (f: Figures): Cell[] => [
    ...(withCost ? [n(f.stock.noCostRows ?? 0), yesNo(f.stock.valuationComplete ?? true)] : []),
    ...(withMargin ? currencies.flatMap((c) => [n(f.margin?.find((x) => x.currency === c)?.incompleteCostRows ?? 0), n(f.margin?.find((x) => x.currency === c)?.mixedCurrencyRows ?? 0)]) : []),
  ];
  const rankIn = (branchId: string) => (c: Currency) => d.comparison.find((g) => g.currency === c)?.rows.find((x) => x.branchId === branchId)?.rank ?? null;
  const rows: Cell[][] = d.branches.map((b) => [
    b.name,
    ...perCurrency(b, rankIn(b.branchId)),
    ...expiry(b), n(b.transit.incoming.units), n(b.transit.outgoing.units), '',
    n(b.openTransfers.incoming.requested), n(b.openTransfers.incoming.sent), n(b.openTransfers.outgoing.requested), n(b.openTransfers.outgoing.sent), '', '',
    n(b.lowStock), ...caveats(b), 'branch',
  ]);
  rows.push([
    '', ...perCurrency(d.total, () => null), ...expiry(d.total), '', '', n(d.total.transit.units),
    '', '', '', '', n(d.total.openTransfers.requested), n(d.total.openTransfers.sent), n(d.total.lowStock), ...caveats(d.total), 'total',
  ]);
  return { headers, rows, range: { from: d.from, to: d.to } };
}

// The export ---------------------------------------------------------------------------------------------------------------

type Place = { branchId?: string | undefined };

export async function exportReport(
  scoped: ScopedClient,
  ph: PhActor,
  place: Place,
  input: ExportReportInput,
  /** `maxRows` and `expiryMaxBatches` are seams for the tests (the cap of a file and the phase 2 batch limit of the expiry list). */
  options: { maxRows?: number; now?: Date; expiryMaxBatches?: number } = {},
): Promise<ReportExport> {
  const maxRows = options.maxRows ?? REPORT_EXPORT_MAX_ROWS;
  const now = options.now ?? new Date();
  const take = maxRows + 1;
  const valid = parsed(exportReportInput, { ...input });
  const scope = scopeOf(ph, place.branchId);
  let sheet: Sheet;
  switch (valid.report) {
    case 'sales':
      sheet = await salesSheet(scoped, ph, place, valid, take);
      break;
    case 'returns':
      sheet = await returnsSheet(scoped, ph, place, valid, take);
      break;
    case 'discounts':
      sheet = await discountsSheet(scoped, ph, place, valid, take);
      break;
    case 'margin':
      sheet = await marginSheet(scoped, ph, place, valid, take);
      break;
    case 'stockValuation':
      sheet = await valuationSheet(scoped, ph, place, valid, take);
      break;
    case 'expiry':
      sheet = await expirySheet(scoped, ph, place, now, options.expiryMaxBatches ?? MAX_EXPIRY_ROWS);
      break;
    case 'damaged':
      sheet = await damagedSheet(scoped, ph, place, valid);
      break;
    case 'transfers':
      sheet = await transfersSheet(scoped, ph, place, valid, take);
      break;
    case 'lowStock':
      sheet = await lowStockSheet(scoped, ph, place, now, take);
      break;
    case 'chain':
      sheet = await chainSheet(scoped, ph, valid, now);
      break;
  }
  // The cap counts every row of the file (total rows included); a report that is bigger is refused, never cut.
  if (sheet.rows.length > maxRows) throw tooLarge(maxRows, sheet.range !== null);
  const cells = exportCells([sheet.headers, ...sheet.rows]);
  const body = valid.format === 'csv' ? writeCsv(cells) : await writeXlsx(cells, valid.report);
  return {
    fileName: exportFileName(valid.report, sheet.range ?? { on: sheet.day ?? baghdadDay(now) }, valid.format),
    contentType: CONTENT_TYPES[valid.format],
    base64: Buffer.from(body).toString('base64'),
    rows: sheet.rows.length,
    report: valid.report,
    format: valid.format,
    from: sheet.range?.from ?? null,
    to: sheet.range?.to ?? null,
    branches: scope.branchIds.length,
  };
}
