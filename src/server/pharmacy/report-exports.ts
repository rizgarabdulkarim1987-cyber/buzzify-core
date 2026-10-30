/* eslint-disable no-restricted-properties -- read-only label lookups: bound to the actor's restaurantId, and none of them writes */
import { z } from 'zod';
import type { ScopedClient } from '@/server/data/tenant-db';
import { baghdadDay } from '@/server/domain/pharmacy/reports-domain';
import { bpText, decimalText, exportCells, exportFileName, num, numOrBlank, type Cell } from '@/server/domain/pharmacy/export-sheet';
import { writeCsv, writeXlsx } from '@/server/sheets/write';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from './actor';
import { chainDashboard, chainInput } from './chain';
import { expiryInput, listExpiry } from './expiry';
import { mayViewCost } from './products';
import { discountsReport, returnsReport, salesReport } from './reports';
import { scopeOf, type Currency } from './reports-common';
import { discountsInput, marginInput, returnsInput, salesInput } from './reports-inputs';
import { damagedInput, damagedReport, transfersReport, transfersReportInput } from './reports-ledger';
import { marginReport } from './reports-margin';
import { lowStockInput, lowStockReport, stockValuation, valuationInput } from './reports-stock';

/**
 * Report exports (phase 6, task 5; R6-9): every report as a CSV (UTF-8 with a byte order mark) or an XLSX through the sheet
 * writers. The file is the report's own answer, fetched whole (never a page of it), for the branches the person works in:
 *  - the permission is the report's, and cost or margin columns are LEFT OUT (not blank) without `cost.view` / `profit.view`;
 *  - money is exact decimal text in major units with its currency in the next column, and is never summed across currencies;
 *    percentages are exact two-decimal text; dates are Baghdad dates;
 *  - a number is written as it is (a negative figure keeps its minus); every text cell goes through `escapeCell`, so nothing
 *    typed by a person is read as a formula (`exportCells` does both, and `num` refuses anything that is not a plain decimal);
 *  - more rows than the cap is REFUSED (`EXPORT_TOO_LARGE`), never cut;
 *  - the file name carries the report and the range, nothing else.
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
}

const CONTENT_TYPES = { csv: 'text/csv', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } as const;

interface Sheet {
  headers: string[];
  rows: Cell[][];
  range: { from: string; to: string } | null;
}

const tooLarge = (limit: number) => new StudioError('INVALID', 'This report has too many rows for one file. Narrow the dates or choose a branch.', { phCode: 'EXPORT_TOO_LARGE', limit: String(limit) });

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
const dateOf = (iso: string | null): string => (iso ? baghdadDay(new Date(iso)) : '');
const yesNo = (v: boolean) => (v ? 'yes' : 'no');

interface Labels {
  branch: Map<string, string>;
  product: Map<string, string>;
  category: Map<string, string>;
  user: Map<string, string>;
}

/** Names for the ids a report carries: branches of the actor, products and categories of the business, users who sold. */
async function labelsFor(scoped: ScopedClient, ids: { branches: readonly string[]; products?: Iterable<string>; categories?: Iterable<string>; users?: Iterable<string> }): Promise<Labels> {
  const [branches, products, categories, users] = await Promise.all([
    scoped.branch.findMany({ where: { id: { in: [...ids.branches] } }, select: { id: true, name: true } }),
    scoped.phProduct.findMany({ where: { id: { in: [...(ids.products ?? [])] } }, select: { id: true, tradeName: true } }),
    scoped.phCategory.findMany({ where: { id: { in: [...(ids.categories ?? [])] } }, select: { id: true, name: true } }),
    (async () => {
      const wanted = [...(ids.users ?? [])];
      if (wanted.length === 0) return [] as Array<{ id: string; name: string | null }>;
      return scoped.$queryRaw<Array<{ id: string; name: string | null }>>`SELECT "id", "name" FROM "user" WHERE "id" = ANY(${wanted}::text[])`;
    })(),
  ]);
  return {
    branch: new Map(branches.map((b) => [b.id, b.name])),
    product: new Map(products.map((p) => [p.id, p.tradeName])),
    category: new Map(categories.map((c) => [c.id, c.name])),
    user: new Map(users.map((u) => [u.id, u.name ?? ''])),
  };
}

const named = (map: Map<string, string>, id: string) => map.get(id) ?? '';

// Each report ------------------------------------------------------------------------------------------------------------

async function salesSheet(scoped: ScopedClient, ph: PhActor, place: Place, raw: ExportReportInput, take: number): Promise<Sheet> {
  const input = parsedWhole(salesInput, { from: raw.from, to: raw.to, groupBy: raw.groupBy, currency: raw.currency }, take);
  const r = await salesReport(scoped, ph, place, input);
  if (r.hasMore) throw tooLarge(take - 1);
  const labels = await labelsFor(scoped, {
    branches: scopeOf(ph, place.branchId).branchIds,
    products: r.groupBy === 'product' ? r.rows.map((x) => x.key) : [],
    categories: r.groupBy === 'category' ? r.rows.map((x) => x.key) : [],
    users: r.groupBy === 'user' ? r.rows.map((x) => x.key) : [],
  });
  const label = (key: string) => (r.groupBy === 'branch' ? named(labels.branch, key) : r.groupBy === 'product' ? named(labels.product, key) : r.groupBy === 'category' ? named(labels.category, key) : r.groupBy === 'user' ? named(labels.user, key) : key);
  const rows: Cell[][] = r.rows.map((x) => [
    x.key, label(x.key), x.currency, num(String(x.count)), numOrBlank(x.qty === undefined ? null : String(x.qty)), money(x.grossMinor, x.currency), money(x.discountMinor, x.currency),
    x.roundingMinor === undefined ? '' : money(x.roundingMinor, x.currency), money(x.salesMinor, x.currency), money(x.refundsMinor, x.currency), money(x.netMinor, x.currency),
    x.avgTicketMinor === null ? '' : money(x.avgTicketMinor, x.currency), 'row',
  ]);
  for (const t of r.totals) {
    rows.push(['', '', t.currency, num(String(t.count)), '', money(t.grossMinor, t.currency), money(t.discountMinor, t.currency), money(t.roundingMinor, t.currency), money(t.salesMinor, t.currency), money(t.refundsMinor, t.currency), money(t.netMinor, t.currency), t.avgTicketMinor === null ? '' : money(t.avgTicketMinor, t.currency), 'total']);
  }
  return { headers: ['key', 'label', 'currency', 'count', 'qty', 'gross', 'discount', 'rounding', 'sales', 'refunds', 'net', 'avgTicket', 'rowType'], rows, range: { from: r.from, to: r.to } };
}

async function returnsSheet(scoped: ScopedClient, ph: PhActor, place: Place, raw: ExportReportInput, take: number): Promise<Sheet> {
  const input = parsedWhole(returnsInput, { from: raw.from, to: raw.to, userId: raw.userId, currency: raw.currency }, take);
  const r = await returnsReport(scoped, ph, place, input);
  if (r.hasMore) throw tooLarge(take - 1);
  const labels = await labelsFor(scoped, { branches: scopeOf(ph, place.branchId).branchIds });
  return {
    headers: ['number', 'saleNumber', 'date', 'branch', 'reason', 'approvedBy', 'method', 'currency', 'refund'],
    rows: r.rows.map((x) => [x.number ?? '', x.saleNumber ?? '', dateOf(x.createdAt), named(labels.branch, x.branchId), x.reason, x.approverName ?? '', x.method, x.currency, money(x.refundMinor, x.currency)]),
    range: { from: r.from, to: r.to },
  };
}

async function discountsSheet(scoped: ScopedClient, ph: PhActor, place: Place, raw: ExportReportInput, take: number): Promise<Sheet> {
  const input = parsedWhole(discountsInput, { from: raw.from, to: raw.to, userId: raw.userId, currency: raw.currency }, take);
  const r = await discountsReport(scoped, ph, place, input);
  if (r.hasMore) throw tooLarge(take - 1);
  const labels = await labelsFor(scoped, { branches: scopeOf(ph, place.branchId).branchIds, users: r.rows.map((x) => x.soldById) });
  return {
    headers: ['number', 'date', 'branch', 'soldBy', 'currency', 'gross', 'discount', 'discountPercent', 'overLimit'],
    rows: r.rows.map((x) => [x.number ?? '', dateOf(x.completedAt), named(labels.branch, x.branchId), named(labels.user, x.soldById), x.currency, money(x.grossMinor, x.currency), money(x.discountMinor, x.currency), num(bpText(x.discountBp)), yesNo(x.overLimit)]),
    range: { from: r.from, to: r.to },
  };
}

async function marginSheet(scoped: ScopedClient, ph: PhActor, place: Place, raw: ExportReportInput, take: number): Promise<Sheet> {
  const input = parsedWhole(marginInput, { from: raw.from, to: raw.to, groupBy: raw.groupBy, currency: raw.currency }, take);
  // The margin report itself refuses without report.view + profit.view + cost.view: the export has no weaker door.
  const r = await marginReport(scoped, ph, place, input);
  if (r.hasMore) throw tooLarge(take - 1);
  const labels = await labelsFor(scoped, {
    branches: scopeOf(ph, place.branchId).branchIds,
    products: r.groupBy === 'product' ? r.rows.map((x) => x.key) : [],
    categories: r.groupBy === 'category' ? r.rows.map((x) => x.key) : [],
  });
  const label = (key: string) => (r.groupBy === 'branch' ? named(labels.branch, key) : r.groupBy === 'product' ? named(labels.product, key) : r.groupBy === 'category' ? named(labels.category, key) : key);
  const line = (key: string, text: string, m: { currency: Currency; netMinor: string; costMinor: string; marginMinor: string; marginBp: number | null }, type: string): Cell[] => [
    key, text, m.currency, money(m.netMinor, m.currency), money(m.costMinor, m.currency), money(m.marginMinor, m.currency), numOrBlank(m.marginBp === null ? null : bpText(m.marginBp)), type,
  ];
  return {
    headers: ['key', 'label', 'currency', 'net', 'cost', 'margin', 'marginPercent', 'rowType'],
    rows: [...r.rows.map((x) => line(x.key, label(x.key), x, 'row')), ...r.totals.map((t) => line('', '', t, 'total'))],
    range: { from: r.from, to: r.to },
  };
}

async function valuationSheet(scoped: ScopedClient, ph: PhActor, place: Place, raw: ExportReportInput, take: number): Promise<Sheet> {
  const input = parsedWhole(valuationInput, { groupBy: raw.groupBy, categoryId: raw.categoryId }, take);
  const r = await stockValuation(scoped, ph, place, input);
  if (r.hasMore) throw tooLarge(take - 1);
  const withCost = mayViewCost(ph);
  type Row = { key: string; label: string; available: number; reserved: number; quarantine: number; damaged: number; noCostRows?: number; valuationComplete?: boolean; values?: Array<{ currency: Currency; valueMinor: string; damagedValueMinor: string }> };
  const lines = (row: Row, type: string): Cell[][] => {
    const base: Cell[] = [row.key, row.label, num(String(row.available)), num(String(row.reserved)), num(String(row.quarantine)), num(String(row.damaged))];
    if (!withCost) return [[...base, type]];
    const tail = (currency: Cell, value: Cell, damaged: Cell): Cell[] => [currency, value, damaged, num(String(row.noCostRows ?? 0)), yesNo(row.valuationComplete ?? true), type];
    const values = row.values ?? [];
    if (values.length === 0) return [[...base, ...tail('', '', '')]];
    return values.map((v) => [...base, ...tail(v.currency, money(v.valueMinor, v.currency), money(v.damagedValueMinor, v.currency))]);
  };
  const out: Cell[][] = r.rows.flatMap((x) => lines({ ...x }, 'row'));
  out.push(...lines({ key: '', label: '', ...r.totals }, 'total'));
  const base = ['key', 'label', 'available', 'reserved', 'quarantine', 'damaged'];
  return { headers: withCost ? [...base, 'currency', 'value', 'damagedValue', 'noCostRows', 'valuationComplete', 'rowType'] : [...base, 'rowType'], rows: out, range: null };
}

async function expirySheet(scoped: ScopedClient, ph: PhActor, place: Place, take: number): Promise<Sheet> {
  const labels = await labelsFor(scoped, { branches: scopeOf(ph, place.branchId).branchIds });
  const list = await listExpiry(scoped, ph, { ...expiryInput.parse({ days: 90, includeExpired: true }), pageSize: take, cursor: null, ...(place.branchId ? { branchId: place.branchId } : {}) }).catch((error: unknown) => {
    // The phase 2 list refuses a chain with too many batches in reach: the file cannot hold them either.
    if (error instanceof StudioError && error.code === 'CONFLICT' && error.fields?.phCode === 'TOO_MANY') throw tooLarge(take - 1);
    throw error;
  });
  if (list.nextCursor !== null) throw tooLarge(take - 1);
  const withCost = mayViewCost(ph);
  return {
    headers: ['product', 'strength', 'form', 'lot', 'expiryDate', 'branch', 'available', 'reserved', 'quarantine', 'band', 'daysToExpiry', 'action', ...(withCost ? ['unitCost', 'costCurrency'] : [])],
    rows: list.items.map((x) => [
      x.product.tradeName, x.product.strength, x.product.form, x.batch.lot, x.batch.expiryDate, named(labels.branch, x.branchId), num(String(x.buckets.available)), num(String(x.buckets.reserved)), num(String(x.buckets.quarantine)),
      x.band, num(String(x.daysToExpiry)), x.action.status,
      ...(withCost ? [x.unitCostMinor && x.currency ? money(x.unitCostMinor, x.currency) : '', x.currency ?? ''] : []),
    ]),
    range: null,
  };
}

async function damagedSheet(scoped: ScopedClient, ph: PhActor, place: Place, raw: ExportReportInput): Promise<Sheet> {
  const input = parsed(damagedInput, { from: raw.from, to: raw.to });
  const r = await damagedReport(scoped, ph, place, input);
  const labels = await labelsFor(scoped, { branches: scopeOf(ph, place.branchId).branchIds });
  const withCost = mayViewCost(ph);
  const q = (n: number) => num(String(n));
  // One table, one block per section; the columns a section does not use stay empty.
  const row = (c: { section: string; type?: string; branch?: string; toBranch?: string; reason?: string; damaged?: number; quarantine?: number; units?: number; lost?: number; currency?: string; damagedValue?: string; quarantineValue?: string; value?: string; lostValue?: string }): Cell[] => [
    c.section, c.type ?? '', c.branch ?? '', c.toBranch ?? '', c.reason ?? '',
    c.damaged === undefined ? '' : q(c.damaged), c.quarantine === undefined ? '' : q(c.quarantine), c.units === undefined ? '' : q(c.units), c.lost === undefined ? '' : q(c.lost),
    ...(withCost ? [c.currency ?? '', numOrBlank(c.damagedValue), numOrBlank(c.quarantineValue), numOrBlank(c.value), numOrBlank(c.lostValue)] : []),
  ];
  const rows: Cell[][] = [];
  for (const b of r.current.byBranch) rows.push(row({ section: 'current', branch: named(labels.branch, b.branchId), damaged: b.damaged, quarantine: b.quarantine }));
  rows.push(row({ section: 'current', damaged: r.current.totals.damaged, quarantine: r.current.totals.quarantine }));
  for (const v of r.current.totals.values ?? []) rows.push(row({ section: 'current', currency: v.currency, damagedValue: decimalText(BigInt(v.damagedValueMinor), v.currency), quarantineValue: decimalText(BigInt(v.quarantineValueMinor), v.currency) }));
  for (const b of r.movements.byBranch) rows.push(row({ section: 'movements', type: b.type, branch: named(labels.branch, b.branchId), units: b.units }));
  for (const t of r.movements.totals) {
    rows.push(row({ section: 'movements', type: t.type, units: t.units }));
    for (const v of t.values ?? []) rows.push(row({ section: 'movements', type: t.type, currency: v.currency, value: decimalText(BigInt(v.valueMinor), v.currency) }));
  }
  for (const x of r.movements.reasons) rows.push(row({ section: 'movementReasons', type: x.type, reason: x.reason, units: x.units }));
  for (const x of r.transfers.byRoute) rows.push(row({ section: 'transfers', branch: named(labels.branch, x.fromBranchId), toBranch: named(labels.branch, x.toBranchId), damaged: x.damagedQty, lost: x.lostQty }));
  rows.push(row({ section: 'transfers', damaged: r.transfers.totals.damagedQty, lost: r.transfers.totals.lostQty }));
  for (const v of r.transfers.totals.values ?? []) rows.push(row({ section: 'transfers', currency: v.currency, damagedValue: decimalText(BigInt(v.damagedValueMinor), v.currency), lostValue: decimalText(BigInt(v.lostValueMinor), v.currency) }));
  return {
    headers: ['section', 'type', 'branch', 'toBranch', 'reason', 'damaged', 'quarantine', 'units', 'lost', ...(withCost ? ['currency', 'damagedValue', 'quarantineValue', 'value', 'lostValue'] : [])],
    rows,
    range: { from: r.from, to: r.to },
  };
}

async function transfersSheet(scoped: ScopedClient, ph: PhActor, place: Place, raw: ExportReportInput, take: number): Promise<Sheet> {
  const input = parsedWhole(transfersReportInput, { from: raw.from, to: raw.to, status: raw.status }, take);
  const r = await transfersReport(scoped, ph, place, input);
  if (r.hasMore) throw tooLarge(take - 1);
  return {
    headers: ['number', 'from', 'to', 'status', 'requestedDate', 'sentDate', 'receivedDate', 'requested', 'sent', 'received', 'lost', 'damaged'],
    rows: r.rows.map((x) => [x.number ?? '', x.fromBranchName, x.toBranchName, x.status, dateOf(x.requestedAt), dateOf(x.sentAt), dateOf(x.receivedAt), num(String(x.requestedQty)), num(String(x.sentQty)), num(String(x.receivedQty)), num(String(x.lostQty)), num(String(x.damagedQty))]),
    range: { from: r.from, to: r.to },
  };
}

async function lowStockSheet(scoped: ScopedClient, ph: PhActor, place: Place, take: number): Promise<Sheet> {
  const r = await lowStockReport(scoped, ph, place, parsedWhole(lowStockInput, {}, take));
  if (r.hasMore) throw tooLarge(take - 1);
  const labels = await labelsFor(scoped, { branches: scopeOf(ph, place.branchId).branchIds });
  return {
    headers: ['branch', 'product', 'strength', 'form', 'minQty', 'sellable', 'deficit', 'reorderQty'],
    rows: r.rows.map((x) => [named(labels.branch, x.branchId), x.tradeName, x.strength, x.form, num(String(x.minQty)), num(String(x.sellable)), num(String(x.deficit)), num(String(x.reorderQty))]),
    range: null,
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
    'openIncomingRequested', 'openIncomingSent', 'openOutgoingRequested', 'openOutgoingSent', 'openRequestedOnce', 'openSentOnce', 'lowStock', 'rowType',
  ];
  type Figures = (typeof d.branches)[number] | typeof d.total;
  const expiry = (f: Figures) => ('unavailable' in f.expiry ? ['', ''] : [num(String(f.expiry.expired.units)), num(String(f.expiry.d30.units))]);
  const money0 = (minor: string | undefined, c: Currency): Cell => money(minor ?? '0', c);
  const perCurrency = (f: Figures, rankOf: (c: Currency) => number | null): Cell[] =>
    currencies.flatMap((c) => {
      const s = f.sales.find((x) => x.currency === c);
      const m = f.margin?.find((x) => x.currency === c);
      return [
        num(String(s?.count ?? 0)), money0(s?.netMinor, c), money0(s?.discountMinor, c), money0(s?.refundsMinor, c),
        ...(withMargin ? [numOrBlank(m?.marginBp === undefined || m.marginBp === null ? null : bpText(m.marginBp))] : []),
        ...(withCost ? [money0(f.stock.values?.find((v) => v.currency === c)?.valueMinor, c)] : []),
        numOrBlank(rankOf(c) === null ? null : String(rankOf(c))),
      ];
    });
  const rankIn = (branchId: string) => (c: Currency) => d.comparison.find((g) => g.currency === c)?.rows.find((x) => x.branchId === branchId)?.rank ?? null;
  const n = (v: number): Cell => num(String(v));
  const rows: Cell[][] = d.branches.map((b) => [
    b.name,
    ...perCurrency(b, rankIn(b.branchId)),
    ...expiry(b), n(b.transit.incoming.units), n(b.transit.outgoing.units), '',
    n(b.openTransfers.incoming.requested), n(b.openTransfers.incoming.sent), n(b.openTransfers.outgoing.requested), n(b.openTransfers.outgoing.sent), '', '',
    n(b.lowStock), 'branch',
  ]);
  rows.push([
    '', ...perCurrency(d.total, () => null), ...expiry(d.total), '', '', n(d.total.transit.units),
    '', '', '', '', n(d.total.openTransfers.requested), n(d.total.openTransfers.sent), n(d.total.lowStock), 'total',
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
  options: { maxRows?: number; now?: Date } = {},
): Promise<ReportExport> {
  const maxRows = options.maxRows ?? REPORT_EXPORT_MAX_ROWS;
  const now = options.now ?? new Date();
  const take = maxRows + 1;
  const valid = parsed(exportReportInput, { ...input });
  scopeOf(ph, place.branchId);
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
      sheet = await expirySheet(scoped, ph, place, take);
      break;
    case 'damaged':
      sheet = await damagedSheet(scoped, ph, place, valid);
      break;
    case 'transfers':
      sheet = await transfersSheet(scoped, ph, place, valid, take);
      break;
    case 'lowStock':
      sheet = await lowStockSheet(scoped, ph, place, take);
      break;
    case 'chain':
      sheet = await chainSheet(scoped, ph, valid, now);
      break;
  }
  // The cap counts every row of the file (total rows included); a report that is bigger is refused, never cut.
  if (sheet.rows.length > maxRows) throw tooLarge(maxRows);
  const cells = exportCells([sheet.headers, ...sheet.rows]);
  const body = valid.format === 'csv' ? writeCsv(cells) : await writeXlsx(cells, valid.report);
  return {
    fileName: exportFileName(valid.report, sheet.range ?? { on: baghdadDay(now) }, valid.format),
    contentType: CONTENT_TYPES[valid.format],
    base64: Buffer.from(body).toString('base64'),
    rows: sheet.rows.length,
    report: valid.report,
    format: valid.format,
    from: sheet.range?.from ?? null,
    to: sheet.range?.to ?? null,
  };
}
