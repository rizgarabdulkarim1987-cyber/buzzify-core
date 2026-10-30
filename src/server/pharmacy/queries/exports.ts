import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { auditReportExport } from '@/server/pharmacy/export-audit';
import { exportInput, exportProducts } from '@/server/pharmacy/exports';
import { pharmacyOf } from '@/server/pharmacy/products';
import { exportReport, exportReportInput } from '@/server/pharmacy/report-exports';
import { defineQuery } from '@/server/studio/framework/query';
import { StudioError } from '@/server/studio/framework/result';

/**
 * Exports (`catalog.view`), open while the pharmacy is read-only and closed once it is archived, like every pharmacy
 * query. A support actor with a `catalog.read` grant may export too: the framework audits that read like any other.
 */

export const products = defineQuery({
  name: 'ph.exports.products',
  permission: null,
  ph: 'catalog.view',
  allowReadOnly: true,
  input: exportInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    // The place's branch, when chosen, is the one whose minimum quantities are shown (the framework checked it is theirs).
    if (input.branchId !== undefined && !ph.branchIds.includes(input.branchId)) throw new StudioError('FORBIDDEN');
    return exportProducts(scoped, ph, input, { visibleBranchIds: input.branchId !== undefined ? [input.branchId] : ph.branchIds });
  },
});

/**
 * Any report as a file (phase 6, task 5; R6-9): `report.view` like the reports themselves (the margin export also needs the margin
 * permissions, checked by the margin report), open while the pharmacy is read-only, the branches of the person. A successful
 * export files one audit row of counts (report, format, range, rows); a refusal files none.
 */
export const report = defineQuery({
  name: 'ph.exports.report',
  permission: null,
  ph: 'report.view',
  allowReadOnly: true,
  input: exportReportInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    const file = await exportReport(scoped, ph, input, input);
    await auditReportExport(ctx.db, ph, file);
    return { fileName: file.fileName, contentType: file.contentType, base64: file.base64, rows: file.rows };
  },
});
