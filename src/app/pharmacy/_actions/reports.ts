'use server';

import { invokePhReport } from '@/server/pharmacy/invoke';
import * as chain from '@/server/pharmacy/queries/chain';
import * as exportsQueries from '@/server/pharmacy/queries/exports';
import * as reports from '@/server/pharmacy/queries/reports';

// The report screens' reads (phase 6, task 6). `invokePhReport` puts in the business of the chosen place and hands over the person and the pharmacy
// resolved for this request; the branch in the input is the person's own filter (ruling R6-15: the place's branch does not narrow a report). Every
// definition is a read for `report.view`, open while the pharmacy is read-only.

export async function salesReport(input: unknown) {
  return invokePhReport(reports.sales, input);
}

export async function returnsReport(input: unknown) {
  return invokePhReport(reports.returns, input);
}

export async function discountsReport(input: unknown) {
  return invokePhReport(reports.discounts, input);
}

export async function marginReport(input: unknown) {
  return invokePhReport(reports.margin, input);
}

export async function stockValuationReport(input: unknown) {
  return invokePhReport(reports.stockValuationQuery, input);
}

export async function expiryReport(input: unknown) {
  return invokePhReport(reports.expiry, input);
}

export async function damagedReport(input: unknown) {
  return invokePhReport(reports.damaged, input);
}

export async function transfersReport(input: unknown) {
  return invokePhReport(reports.transfers, input);
}

export async function lowStockReport(input: unknown) {
  return invokePhReport(reports.lowStock, input);
}

export async function chainDashboard(input: unknown) {
  return invokePhReport(chain.dashboard, input);
}

export async function exportReport(input: unknown) {
  return invokePhReport(exportsQueries.report, input);
}
