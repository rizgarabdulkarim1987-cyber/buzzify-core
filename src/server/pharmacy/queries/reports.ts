import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { reportLabels } from '@/server/pharmacy/report-labels';
import { discountsReport, returnsReport, salesReport } from '@/server/pharmacy/reports';
import { marginReport } from '@/server/pharmacy/reports-margin';
import { discountsInput, marginInput, returnsInput, salesInput } from '@/server/pharmacy/reports-inputs';
import { damagedInput, damagedReport, transfersReport, transfersReportInput } from '@/server/pharmacy/reports-ledger';
import { expiryReport, expiryReportInput, lowStockInput, lowStockReport, stockValuation, valuationInput } from '@/server/pharmacy/reports-stock';
import { defineQuery } from '@/server/studio/framework/query';

/**
 * Reports (phase 6, task 4; R6-7). Every one is a read for `report.view` (OWNER, BRANCH_MANAGER, PHARMACIST_IN_CHARGE,
 * ACCOUNTANT), open while the pharmacy is read-only like the other reads and closed once it is archived. A support actor and a
 * role without the permission read nothing. The place's branch narrows a report to that branch; without one a person
 * gets the branches they work in. Margin also needs `profit.view` and `cost.view` (checked in its service); the cost keys of the others exist only with `cost.view`.
 *
 * Each answer also carries `labels` (task 6): the names of the branches of the report and of the products, categories and sellers its
 * rows name, so a screen never shows an id (report-labels.ts).
 */

export const sales = defineQuery({
  name: 'ph.reports.sales',
  permission: null,
  ph: 'report.view',
  allowReadOnly: true,
  input: salesInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    const report = await salesReport(scoped, ph, input, input);
    const keys = report.rows.map((r) => r.key);
    const labels = await reportLabels(scoped, ph, input, {
      products: report.groupBy === 'product' ? keys : [],
      categories: report.groupBy === 'category' ? keys : [],
      users: report.groupBy === 'user' ? keys : [],
    });
    return { ...report, labels };
  },
});

export const returns = defineQuery({
  name: 'ph.reports.returns',
  permission: null,
  ph: 'report.view',
  allowReadOnly: true,
  input: returnsInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    const report = await returnsReport(scoped, ph, input, input);
    return { ...report, labels: await reportLabels(scoped, ph, input) };
  },
});

export const discounts = defineQuery({
  name: 'ph.reports.discounts',
  permission: null,
  ph: 'report.view',
  allowReadOnly: true,
  input: discountsInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    const report = await discountsReport(scoped, ph, input, input);
    return { ...report, labels: await reportLabels(scoped, ph, input, { users: report.rows.map((r) => r.soldById) }) };
  },
});

export const margin = defineQuery({
  name: 'ph.reports.margin',
  permission: null,
  // Like every report it is gated on `report.view`; the margin itself also needs `profit.view` AND `cost.view`, checked in the service
  // (the figures are cost-derived), so a role that holds only one of them is refused there.
  ph: 'report.view',
  allowReadOnly: true,
  input: marginInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    const report = await marginReport(scoped, ph, input, input);
    const keys = report.rows.map((r) => r.key);
    const labels = await reportLabels(scoped, ph, input, { products: report.groupBy === 'product' ? keys : [], categories: report.groupBy === 'category' ? keys : [] });
    return { ...report, labels };
  },
});

export const stockValuationQuery = defineQuery({
  name: 'ph.reports.stockValuation',
  permission: null,
  ph: 'report.view',
  allowReadOnly: true,
  input: valuationInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    const report = await stockValuation(scoped, ph, input, input);
    return { ...report, labels: await reportLabels(scoped, ph, input) };
  },
});

export const expiry = defineQuery({
  name: 'ph.reports.expiry',
  permission: null,
  ph: 'report.view',
  allowReadOnly: true,
  input: expiryReportInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    const report = await expiryReport(scoped, ph, input, input);
    return { ...report, labels: await reportLabels(scoped, ph, input) };
  },
});

export const damaged = defineQuery({
  name: 'ph.reports.damaged',
  permission: null,
  ph: 'report.view',
  allowReadOnly: true,
  input: damagedInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    const report = await damagedReport(scoped, ph, input, input);
    return { ...report, labels: await reportLabels(scoped, ph, input) };
  },
});

export const transfers = defineQuery({
  name: 'ph.reports.transfers',
  permission: null,
  ph: 'report.view',
  allowReadOnly: true,
  input: transfersReportInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    const report = await transfersReport(scoped, ph, input, input);
    return { ...report, labels: await reportLabels(scoped, ph, input) };
  },
});

export const lowStock = defineQuery({
  name: 'ph.reports.lowStock',
  permission: null,
  ph: 'report.view',
  allowReadOnly: true,
  input: lowStockInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    const report = await lowStockReport(scoped, ph, input, input);
    return { ...report, labels: await reportLabels(scoped, ph, input) };
  },
});
