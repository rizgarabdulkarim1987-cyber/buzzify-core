import type { PrismaClient } from '@/generated/prisma/client';
import { assertAuditSafe } from '@/server/domain/pharmacy/audit-fields';
import type { PhActor } from './actor';
import type { ReportExport } from './report-exports';

/**
 * The audit row of an export (phase 6, task 5; R6-9): who exported which report, in which format, for which range, and how many
 * rows. Counts and names of the report only: never a cell, a name, a product or an amount. It is the one write on the export
 * path (the export itself reads and builds, see report-exports.ts), and it also runs while the pharmacy is read-only, because
 * exporting stays open after the subscription lapses (spec 4.7); an audit row is not pharmacy data.
 */
export async function auditReportExport(prisma: PrismaClient, ph: PhActor, file: ReportExport): Promise<void> {
  const changes: Record<string, { before: null; after: string | number }> = {
    report: { before: null, after: file.report },
    format: { before: null, after: file.format },
    rows: { before: null, after: file.rows },
    branches: { before: null, after: ph.branchIds.length },
    ...(file.from !== null ? { from: { before: null, after: file.from } } : {}),
    ...(file.to !== null ? { to: { before: null, after: file.to } } : {}),
  };
  assertAuditSafe('PhReportExport', changes);
  await prisma.auditLog.create({
    data: {
      actorId: ph.userId,
      restaurantId: ph.restaurantId,
      action: 'pharmacy.report.export',
      entityType: 'PhReportExport',
      entityId: ph.restaurantId,
      changes,
    },
  });
}
