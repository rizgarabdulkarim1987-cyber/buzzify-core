/* eslint-disable @typescript-eslint/no-explicit-any -- the nine report shapes are read by the views that know them */
import { MAX_PAGES, type ReportFilters, type ReportSpec } from '@/app/pharmacy/_ui/reports-logic';
import { damaged, discounts, expiry, lowStock, margin, returns, sales, stockValuationQuery, transfers } from '@/server/pharmacy/queries/reports';
import { invokeQuery } from '@/server/studio/framework/invoke';
import type { QueryDef } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';

/**
 * Reads a report for a screen: the query for the report, the filters of the address as its input, and as many keyset pages as the
 * address asks for joined into one list ("Load more" adds to what is on screen). The person's branch FILTER is the only branch in
 * the input (the place's own branch does not narrow a report; "All my branches" is the default). Names of later pages are merged
 * into the first page's `labels`. A refusal comes back as it is, for the screen to say.
 */
const DEFS: Record<ReportSpec['id'], QueryDef<any, any>> = {
  sales,
  returns,
  discounts,
  margin,
  stockValuation: stockValuationQuery,
  expiry,
  damaged,
  transfers,
  lowStock,
};
/** The key under which a report keeps the rows that page. */
const ROWS: Partial<Record<ReportSpec['id'], string>> = { expiry: 'items', lowStock: 'rows' };

export function queryInput(spec: ReportSpec, filters: ReportFilters, restaurantId: string): Record<string, unknown> {
  return {
    restaurantId,
    ...(filters.branchId ? { branchId: filters.branchId } : {}),
    ...(spec.dated ? { from: filters.from, to: filters.to } : {}),
    ...(spec.groups && filters.groupBy ? { groupBy: filters.groupBy } : {}),
    ...(filters.currency ? { currency: filters.currency } : {}),
    ...(filters.status ? { status: filters.status } : {}),
  };
}

export async function loadReport(spec: ReportSpec, filters: ReportFilters, restaurantId: string): Promise<ActionResult<any>> {
  const def = DEFS[spec.id];
  const base = queryInput(spec, filters, restaurantId);
  const first = await invokeQuery(def, base);
  if (!first.ok || !spec.paged) return first;
  const rowsKey = ROWS[spec.id] ?? 'rows';
  let data = first.data;
  let rows: unknown[] = data[rowsKey];
  let cursor: string | null = data.nextCursor;
  const labels = { ...data.labels };
  for (let page = 1; page < Math.min(filters.pages, MAX_PAGES) && cursor; page += 1) {
    const next = await invokeQuery(def, { ...base, cursor });
    if (!next.ok) return next;
    rows = rows.concat(next.data[rowsKey]);
    for (const map of ['branch', 'product', 'category', 'user'] as const) Object.assign(labels[map], next.data.labels[map]);
    cursor = next.data.nextCursor;
    data = next.data;
  }
  return { ok: true, data: { ...first.data, [rowsKey]: rows, labels, nextCursor: cursor, hasMore: cursor !== null } };
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
