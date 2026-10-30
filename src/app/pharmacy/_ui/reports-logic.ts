import { addDays, baghdadDay, baghdadWindow, ReportsError, validDay } from '@/server/domain/pharmacy/reports-domain';
import { dashboardWindow } from '@/server/domain/pharmacy/chain-domain';
import type { ExpiryReport, ValuationReport } from '@/server/pharmacy/reports-stock';
import type { MarginReport } from '@/server/pharmacy/reports-margin';
import type { TransfersReport } from '@/server/pharmacy/reports-ledger';

/**
 * Pure rules of the report screens (phase 6, task 6; R6-7..R6-9, R6-11). No DOM, no clock (the clock is an argument). The
 * filters live in the address (shareable); a stale or hand-edited address is read into `problems` that the screen says in words, and
 * is never sent to the server. Money is formatted from the exact strings the server sends (never through a float) and never summed here.
 */

export type ReportId = 'sales' | 'returns' | 'discounts' | 'margin' | 'stockValuation' | 'expiry' | 'damaged' | 'transfers' | 'lowStock';
export type Currency = 'IQD' | 'USD';
export const CURRENCIES: readonly Currency[] = ['IQD', 'USD'];

export interface ReportSpec {
  id: ReportId;
  /** The address segment: /pharmacy/reports/<slug>. */
  slug: string;
  /** A report over a date range (the others are as of now). */
  dated: boolean;
  currency: boolean;
  groups?: readonly string[];
  statuses?: readonly string[];
  /** Whether the rows page by keyset ("Load more"). */
  paged: boolean;
  /** Margin needs profit.view AND cost.view on top of report.view. */
  gated?: 'margin';
  /** `pharmacy.reports.<messageKey>.title` / `.about` */
  messageKey: string;
}

export const REPORT_SPECS: readonly ReportSpec[] = [
  { id: 'sales', slug: 'sales', dated: true, currency: true, groups: ['day', 'branch', 'user', 'method', 'product', 'category'], paged: true, messageKey: 'sales' },
  { id: 'returns', slug: 'returns', dated: true, currency: true, paged: true, messageKey: 'returns' },
  { id: 'discounts', slug: 'discounts', dated: true, currency: true, paged: true, messageKey: 'discounts' },
  { id: 'margin', slug: 'margin', dated: true, currency: true, groups: ['day', 'branch', 'category', 'product'], paged: true, gated: 'margin', messageKey: 'margin' },
  { id: 'stockValuation', slug: 'stock-valuation', dated: false, currency: false, groups: ['branch', 'category', 'product'], paged: true, messageKey: 'valuation' },
  { id: 'expiry', slug: 'expiry', dated: false, currency: false, paged: true, messageKey: 'expiry' },
  { id: 'damaged', slug: 'damaged', dated: true, currency: false, paged: false, messageKey: 'damaged' },
  { id: 'transfers', slug: 'transfers', dated: true, currency: false, statuses: ['REQUESTED', 'SENT', 'RECEIVED', 'PARTIAL', 'CANCELLED'], paged: true, messageKey: 'transfers' },
  { id: 'lowStock', slug: 'low-stock', dated: false, currency: false, paged: true, messageKey: 'lowStock' },
];

export function specOf(id: ReportId): ReportSpec {
  return REPORT_SPECS.find((s) => s.id === id)!;
}
export function specOfSlug(slug: string): ReportSpec | null {
  return REPORT_SPECS.find((s) => s.slug === slug) ?? null;
}
/** The reports a person is offered: margin only with both margin permissions. */
export function visibleReports(may: { profit: boolean; cost: boolean }): ReportSpec[] {
  return REPORT_SPECS.filter((s) => s.gated !== 'margin' || (may.profit && may.cost));
}
export function defaultGroup(spec: ReportSpec): string | null {
  return spec.groups?.[0] ?? null;
}

// Periods ------------------------------------------------------------------------------------------------------------------

export const PRESETS = ['today', 'yesterday', 'thisMonth', 'lastMonth', 'last30'] as const;
export type Preset = (typeof PRESETS)[number];
/** Over this many days a window may take a few seconds (ruling R6-10a): the screen says so before it is asked for. */
export const LONG_RANGE_DAYS = 90;

/** A preset as Baghdad days, `from..to` inclusive. */
export function presetRange(preset: Preset, now: Date): { from: string; to: string } {
  const today = baghdadDay(now);
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const y = addDays(today, -1);
      return { from: y, to: y };
    }
    case 'thisMonth':
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'lastMonth': {
      const first = `${today.slice(0, 7)}-01`;
      const to = addDays(first, -1);
      return { from: `${to.slice(0, 7)}-01`, to };
    }
    case 'last30':
      return dashboardWindow(now);
  }
}

/** Calendar days from..to inclusive (both valid). */
export function rangeDays(from: string, to: string): number {
  return baghdadWindow(from, to).days;
}
export const isLongRange = (from: string, to: string): boolean => validDay(from) && validDay(to) && from <= to && rangeDays(from, to) > LONG_RANGE_DAYS;

// Filters ------------------------------------------------------------------------------------------------------------------

export const MAX_PAGES = 20;
type Raw = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export interface ReportFilters {
  from: string;
  to: string;
  branchId: string | null;
  currency: Currency | null;
  groupBy: string | null;
  status: string | null;
  pages: number;
}
export interface FilterProblem {
  field: 'from' | 'to' | 'branch' | 'currency' | 'groupBy' | 'status';
  code: 'badDate' | 'fromAfterTo' | 'tooLong' | 'foreignBranch' | 'badChoice';
}
export const filterMessageKey = (p: FilterProblem): string => `pharmacy.reports.filter.problem.${p.code}`;

function periodProblem(from: string, to: string): FilterProblem | null {
  try {
    baghdadWindow(from, to);
    return null;
  } catch (error) {
    if (!(error instanceof ReportsError)) throw error;
    // The same fields the server names: a bad date on the date that is bad, a reversed range on the start, a long range on the end.
    if (error.code === 'FROM_AFTER_TO') return { field: 'from', code: 'fromAfterTo' };
    if (error.code === 'RANGE_TOO_LONG') return { field: 'to', code: 'tooLong' };
    return { field: validDay(from) ? 'to' : 'from', code: 'badDate' };
  }
}

function pagesOf(text: string | undefined): number {
  if (text === undefined || !/^\d{1,3}$/.test(text)) return 1;
  return Math.max(1, Math.min(Number(text), MAX_PAGES));
}

/** Reads an address into filters. A bad value is a problem (and the screen fetches nothing); the typed text is kept so the form shows it. */
export function parseFilters(spec: ReportSpec, raw: Raw, ctx: { now: Date; branchIds: readonly string[] }): { filters: ReportFilters; problems: FilterProblem[] } {
  const problems: FilterProblem[] = [];
  const fallback = presetRange('last30', ctx.now);
  const from = spec.dated ? (one(raw.from) ?? fallback.from) : '';
  const to = spec.dated ? (one(raw.to) ?? fallback.to) : '';
  if (spec.dated) {
    const problem = periodProblem(from, to);
    if (problem) problems.push(problem);
  }
  const branch = one(raw.branch);
  let branchId: string | null = null;
  if (branch) {
    if (ctx.branchIds.includes(branch)) branchId = branch;
    else problems.push({ field: 'branch', code: 'foreignBranch' });
  }
  let currency: Currency | null = null;
  const currencyText = spec.currency ? one(raw.currency) : undefined;
  if (currencyText) {
    if (currencyText === 'IQD' || currencyText === 'USD') currency = currencyText;
    else problems.push({ field: 'currency', code: 'badChoice' });
  }
  let groupBy = defaultGroup(spec);
  const groupText = spec.groups ? one(raw.group) : undefined;
  if (groupText) {
    if (spec.groups!.includes(groupText)) groupBy = groupText;
    else problems.push({ field: 'groupBy', code: 'badChoice' });
  }
  let status: string | null = null;
  const statusText = spec.statuses ? one(raw.status) : undefined;
  if (statusText) {
    if (spec.statuses!.includes(statusText)) status = statusText;
    else problems.push({ field: 'status', code: 'badChoice' });
  }
  return { filters: { from, to, branchId, currency, groupBy, status, pages: spec.paged ? pagesOf(one(raw.pages)) : 1 }, problems };
}

/** The address of a report with these filters; `over` replaces parameters (a changed filter starts again at the first page). Defaults are left out, the dates are always carried. */
export function reportHref(spec: ReportSpec, filters: ReportFilters, over: Record<string, string | undefined> = {}): string {
  const q = new URLSearchParams();
  const values: Record<string, string | undefined> = {
    from: spec.dated ? filters.from : undefined,
    to: spec.dated ? filters.to : undefined,
    branch: filters.branchId ?? undefined,
    currency: filters.currency ?? undefined,
    group: filters.groupBy !== null && filters.groupBy !== defaultGroup(spec) ? filters.groupBy : undefined,
    status: filters.status ?? undefined,
    pages: filters.pages > 1 ? String(filters.pages) : undefined,
  };
  const changed = Object.keys(over).some((k) => k !== 'pages');
  if (changed) values.pages = undefined;
  for (const [k, v] of Object.entries({ ...values, ...over })) if (v) q.set(k, v);
  const text = q.toString();
  return `/pharmacy/reports/${spec.slug}${text ? `?${text}` : ''}`;
}

/** What the export button sends: the SAME filters as the screen (the server input names), nothing the report does not have. */
export function exportParams(spec: ReportSpec, filters: ReportFilters, format: 'csv' | 'xlsx'): Record<string, string> {
  const out: Record<string, string> = { report: spec.id, format };
  if (spec.dated) {
    out.from = filters.from;
    out.to = filters.to;
  }
  if (spec.groups && filters.groupBy) out.groupBy = filters.groupBy;
  if (filters.currency) out.currency = filters.currency;
  if (filters.status) out.status = filters.status;
  if (filters.branchId) out.branch = filters.branchId;
  return out;
}

// Chain ------------------------------------------------------------------------------------------------------------------

export interface ChainFilters {
  from: string;
  to: string;
  currency: Currency | null;
}
export function parseChainFilters(raw: Raw, now: Date): { filters: ChainFilters; problems: FilterProblem[] } {
  const fallback = presetRange('last30', now);
  const from = one(raw.from) ?? fallback.from;
  const to = one(raw.to) ?? fallback.to;
  const problems: FilterProblem[] = [];
  const problem = periodProblem(from, to);
  if (problem) problems.push(problem);
  const text = one(raw.currency);
  let currency: Currency | null = null;
  if (text) {
    if (text === 'IQD' || text === 'USD') currency = text;
    else problems.push({ field: 'currency', code: 'badChoice' });
  }
  return { filters: { from, to, currency }, problems };
}
export function chainHref(filters: ChainFilters): string {
  const q = new URLSearchParams({ from: filters.from, to: filters.to });
  if (filters.currency) q.set('currency', filters.currency);
  return `/pharmacy/chain?${q.toString()}`;
}

// Numbers ------------------------------------------------------------------------------------------------------------------

const DIGITS: Record<Currency, number> = { IQD: 0, USD: 2 };
const group3 = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** An amount in minor units as exact text with grouping and the currency's own exponent: "1,234,567 IQD", "12,345.67 USD". Latin digits in every language (the receipt's). */
export function formatMinor(minor: string | bigint, currency: Currency): string {
  const value = typeof minor === 'bigint' ? minor : BigInt(minor);
  const negative = value < 0n;
  const digits = DIGITS[currency];
  const abs = (negative ? -value : value).toString().padStart(digits + 1, '0');
  const whole = group3(digits === 0 ? abs : abs.slice(0, -digits));
  const body = digits === 0 ? whole : `${whole}.${abs.slice(-digits)}`;
  return `${negative ? '-' : ''}${body} ${currency}`;
}

/** Basis points as a percent with two decimals, exactly; null stays null (the screen says "no sales to compare"). */
export function bpPercent(bp: number | null): string | null {
  if (bp === null) return null;
  const abs = Math.abs(bp).toString().padStart(3, '0');
  return `${bp < 0 ? '-' : ''}${abs.slice(0, -2)}.${abs.slice(-2)}%`;
}

// Notices ------------------------------------------------------------------------------------------------------------------

export interface Notice {
  /** `pharmacy.reports.notice.<key>` */
  key: string;
  tone: 'warn' | 'info';
  count?: number;
}

export function marginNotices(r: Pick<MarginReport, 'incompleteCostRows' | 'mixedCurrencyRows'>): Notice[] {
  const out: Notice[] = [{ key: 'margin.estimated', tone: 'info' }];
  if (r.incompleteCostRows > 0) out.push({ key: 'margin.costMissing', tone: 'warn', count: r.incompleteCostRows });
  if (r.mixedCurrencyRows > 0) out.push({ key: 'margin.otherCurrency', tone: 'warn', count: r.mixedCurrencyRows });
  return out;
}
export function valuationNotices(r: Pick<ValuationReport, 'totals'>): Notice[] {
  const out: Notice[] = [{ key: 'valuation.reserved', tone: 'info' }];
  if (r.totals.valuationComplete === false) out.push({ key: 'valuation.incomplete', tone: 'warn', count: r.totals.noCostRows ?? 0 });
  return out;
}
export function expiryNotices(r: Pick<ExpiryReport, 'listTruncated'>): Notice[] {
  return r.listTruncated ? [{ key: 'expiry.truncated', tone: 'warn' }] : [];
}
export function transfersNotices(_r: Pick<TransfersReport, 'scope'>): Notice[] {
  return [{ key: 'transfers.scope', tone: 'info' }];
}
