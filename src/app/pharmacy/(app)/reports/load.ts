/* eslint-disable @typescript-eslint/no-explicit-any -- the nine report shapes are read by the views that know them */
import { redirect } from 'next/navigation';
import { callPlan, type ReportFilters, type ReportSpec } from '@/app/pharmacy/_ui/reports-logic';
import { chainDashboard, damagedReport, discountsReport, expiryReport, lowStockReport, marginReport, returnsReport, salesReport, stockValuationReport, transfersReport } from '@/app/pharmacy/_actions/reports';
import { SIGN_IN_PATH, TWO_FACTOR_SETUP_PATH } from '@/server/studio/framework/paths';
import type { ActionResult } from '@/server/studio/framework/result';

/**
 * Reads a report for a screen through the report wrappers (`_actions/reports.ts`: the person and the pharmacy are resolved once for the request,
 * not once per call). The address's filters are the input; the person's branch FILTER is the only branch in it (the place's own branch does not
 * narrow a report, ruling R6-15). "Load more" asks for more rows in as few calls as the report allows (`callPlan`): one call for the reports the
 * server aggregates in memory, a few big keyset calls carried on by the cursor for the others, never one call per page. Names of later calls are
 * merged into the first call's `labels`. A signed-out or two-factor refusal redirects like every pharmacy page; any other refusal comes back as
 * it is, for the screen to say.
 */
const CALLS: Record<ReportSpec['id'], (input: unknown) => Promise<ActionResult<any>>> = {
  sales: salesReport,
  returns: returnsReport,
  discounts: discountsReport,
  margin: marginReport,
  stockValuation: stockValuationReport,
  expiry: expiryReport,
  damaged: damagedReport,
  transfers: transfersReport,
  lowStock: lowStockReport,
};
/** The key under which a report keeps the rows that page. */
const ROWS: Partial<Record<ReportSpec['id'], string>> = { expiry: 'items', lowStock: 'rows' };

/** A refusal that means "sign in again" leaves the page; everything else is for the screen. */
export function settle<T>(result: ActionResult<T>): ActionResult<T> {
  if (!result.ok) {
    if (result.error.code === 'UNAUTHENTICATED') redirect(SIGN_IN_PATH);
    if (result.error.code === 'TWO_FACTOR_REQUIRED') redirect(TWO_FACTOR_SETUP_PATH);
  }
  return result;
}

export function queryInput(spec: ReportSpec, filters: ReportFilters): Record<string, unknown> {
  return {
    ...(filters.branchId ? { branchId: filters.branchId } : {}),
    ...(spec.dated ? { from: filters.from, to: filters.to } : {}),
    ...(spec.groups && filters.groupBy ? { groupBy: filters.groupBy } : {}),
    ...(filters.currency ? { currency: filters.currency } : {}),
    ...(filters.status ? { status: filters.status } : {}),
  };
}

export async function loadReport(spec: ReportSpec, filters: ReportFilters): Promise<ActionResult<any>> {
  const call = CALLS[spec.id];
  const base = queryInput(spec, filters);
  if (!spec.paged) return settle(await call(base));
  const [firstTake, ...later] = callPlan(spec, filters.pages);
  const first = settle(await call({ ...base, take: firstTake }));
  if (!first.ok) return first;
  const rowsKey = ROWS[spec.id] ?? 'rows';
  let rows: unknown[] = first.data[rowsKey];
  let cursor: string | null = first.data.nextCursor;
  const labels = { ...first.data.labels };
  for (const take of later) {
    if (!cursor) break;
    const next = settle(await call({ ...base, take, cursor }));
    if (!next.ok) return next;
    rows = rows.concat(next.data[rowsKey]);
    for (const map of ['branch', 'product', 'category', 'user'] as const) Object.assign(labels[map], next.data.labels[map]);
    cursor = next.data.nextCursor;
  }
  return { ok: true, data: { ...first.data, [rowsKey]: rows, labels, nextCursor: cursor, hasMore: cursor !== null } };
}

/** The chain dashboard through its wrapper, with the same sign-in redirects. */
export async function loadChain(input: Record<string, unknown>): Promise<ActionResult<any>> {
  return settle(await chainDashboard(input));
}

/** Whether a report has nothing to show for its filters (the empty state, naming the filters). */
export function isEmpty(spec: ReportSpec, data: any): boolean {
  switch (spec.id) {
    case 'sales':
      return data.totals.length === 0 && data.rows.length === 0;
    case 'returns':
      return data.totals.length === 0 && data.rows.length === 0;
    case 'discounts':
      return data.totals.length === 0 && data.rows.length === 0;
    case 'margin':
      return data.totals.length === 0 && data.byBranch.length === 0 && data.rows.length === 0 && data.excluded.length === 0;
    case 'stockValuation':
      return data.rows.length === 0 && data.totals.available + data.totals.reserved + data.totals.quarantine + data.totals.damaged === 0 && data.inTransit.units === 0;
    case 'expiry':
      return data.items.length === 0 && data.totals.every((b: { units: number }) => b.units === 0);
    case 'damaged':
      return data.current.totals.damaged === 0 && data.current.totals.quarantine === 0 && data.movements.totals.every((m: { units: number }) => m.units === 0) && data.transfers.totals.lostQty === 0 && data.transfers.totals.damagedQty === 0;
    case 'transfers':
      return data.total === 0 && data.rows.length === 0 && data.inTransit.units === 0;
    case 'lowStock':
      return data.total === 0;
  }
}
