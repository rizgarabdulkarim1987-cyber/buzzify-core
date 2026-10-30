import { z } from 'zod';
import type { ScopedClient } from '@/server/data/tenant-db';
import { canPh } from '@/server/domain/pharmacy/permissions';
import { baghdadWindow, ReportsError, validDay } from '@/server/domain/pharmacy/reports-domain';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from './actor';

/**
 * Reading prescriptions and the controlled register (phase 7). Patient and prescriber fields are returned only to a staff member
 * who holds `rx.dispense` (the key is absent otherwise); a support actor holds no role and so never gets them. The register
 * holds no patient field at all. Attachment bytes are never read here: only `readAttachment` (prescriptions.ts) returns them.
 */

const idText = z.string().min(1).max(64);

export const prescriptionListInput = z.object({
  saleId: idText.optional(),
  /** Only prescriptions not yet used by a sale. */
  unusedOnly: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).default(25),
  /** The id of the last row of the page before (newest first): the next page starts after it. */
  cursor: idText.nullish(),
});
export const prescriptionGetInput = z.object({ prescriptionId: idText });
export const registerListInput = z.object({
  productId: idText.optional(),
  limit: z.number().int().min(1).max(200).default(50),
  /** Baghdad days, both or neither (at most 366 days). */
  from: z.string().trim().refine(validDay, 'Enter a date as YYYY-MM-DD').optional(),
  to: z.string().trim().refine(validDay, 'Enter a date as YYYY-MM-DD').optional(),
  /** The id of the last row of the page before (newest first). */
  cursor: idText.nullish(),
});

export interface PrescriptionView {
  id: string;
  branchId: string;
  number: string;
  issuedOn: string;
  saleId: string | null;
  fileCount: number;
  createdAt: string;
  /** Present only with `rx.dispense`. */
  prescriberName?: string;
  prescriberLicense?: string | null;
  patientName?: string | null;
  patientIdNote?: string | null;
}

const mayHavePatient = (ph: PhActor): boolean => ph.role !== null && ph.support === null && canPh(ph.role, 'rx.dispense');

const SELECT = {
  id: true,
  branchId: true,
  number: true,
  issuedOn: true,
  saleId: true,
  createdAt: true,
  prescriberName: true,
  prescriberLicense: true,
  patientName: true,
  patientIdNote: true,
  _count: { select: { attachments: true } },
} as const;

interface Row {
  id: string;
  branchId: string;
  number: string;
  issuedOn: Date;
  saleId: string | null;
  createdAt: Date;
  prescriberName: string;
  prescriberLicense: string | null;
  patientName: string | null;
  patientIdNote: string | null;
  _count: { attachments: number };
}

function viewOf(row: Row, withPatient: boolean): PrescriptionView {
  return {
    id: row.id,
    branchId: row.branchId,
    number: row.number,
    issuedOn: row.issuedOn.toISOString().slice(0, 10),
    saleId: row.saleId,
    fileCount: row._count.attachments,
    createdAt: row.createdAt.toISOString(),
    ...(withPatient
      ? { prescriberName: row.prescriberName, prescriberLicense: row.prescriberLicense, patientName: row.patientName, patientIdNote: row.patientIdNote }
      : {}),
  };
}

export async function listPrescriptions(scoped: ScopedClient, ph: PhActor, input: z.infer<typeof prescriptionListInput>, branchId?: string): Promise<PrescriptionView[]> {
  let after: object = {};
  if (input.cursor) {
    const at = await scoped.phPrescription.findFirst({ where: { id: input.cursor }, select: { id: true, createdAt: true } });
    if (!at) throw new StudioError('INVALID', 'Check the highlighted fields', { cursor: 'This page of results is no longer available' });
    after = { OR: [{ createdAt: { lt: at.createdAt } }, { createdAt: at.createdAt, id: { lt: at.id } }] };
  }
  const rows = await scoped.phPrescription.findMany({
    where: { ...(branchId ? { branchId } : {}), ...(input.saleId ? { saleId: input.saleId } : {}), ...(input.unusedOnly ? { saleId: null } : {}), ...after },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: input.limit,
    select: SELECT,
  });
  const withPatient = mayHavePatient(ph);
  return rows.map((row) => viewOf(row, withPatient));
}

export async function getPrescription(scoped: ScopedClient, ph: PhActor, input: z.infer<typeof prescriptionGetInput>) {
  const row = await scoped.phPrescription.findFirst({
    where: { id: input.prescriptionId },
    select: { ...SELECT, attachments: { orderBy: { createdAt: 'asc' }, select: { id: true, mime: true, sizeBytes: true, createdAt: true } } },
  });
  if (!row) throw new StudioError('NOT_FOUND', 'Prescription not found', { phCode: 'PRESCRIPTION_NOT_FOUND' });
  return {
    ...viewOf(row, mayHavePatient(ph)),
    // File ids and kinds only: the bytes are read through `readAttachment`.
    files: row.attachments.map((a) => ({ id: a.id, mime: a.mime, sizeBytes: a.sizeBytes, createdAt: a.createdAt.toISOString() })),
  };
}

export interface RegisterRow {
  id: string;
  branchId: string;
  saleId: string;
  productId: string;
  productName: string;
  batchId: string;
  lot: string;
  baseQty: number;
  kind: 'SALE' | 'RETURN';
  dispensedById: string;
  createdAt: string;
}

/** The controlled register, newest first, of the actor's branches: no patient field, no prescription number. */
export async function listRegister(scoped: ScopedClient, input: z.infer<typeof registerListInput>, branchId?: string): Promise<RegisterRow[]> {
  let range: object = {};
  if ((input.from === undefined) !== (input.to === undefined)) throw new StudioError('INVALID', 'Check the highlighted fields', { from: 'Enter a date as YYYY-MM-DD' });
  if (input.from !== undefined && input.to !== undefined) {
    try {
      const w = baghdadWindow(input.from, input.to);
      range = { createdAt: { gte: w.start, lt: w.endExclusive } };
    } catch (error) {
      if (error instanceof ReportsError) {
        const message = error.code === 'RANGE_TOO_LONG' ? 'Use a range of at most one year' : error.code === 'FROM_AFTER_TO' ? 'The start date is after the end date' : 'Enter a date as YYYY-MM-DD';
        throw new StudioError('INVALID', message, { [error.code === 'FROM_AFTER_TO' ? 'from' : 'to']: message });
      }
      throw error;
    }
  }
  let after: object = {};
  if (input.cursor) {
    const at = await scoped.phControlledEntry.findFirst({ where: { id: input.cursor }, select: { id: true, createdAt: true } });
    if (!at) throw new StudioError('INVALID', 'Check the highlighted fields', { cursor: 'This page of results is no longer available' });
    after = { AND: [{ OR: [{ createdAt: { lt: at.createdAt } }, { createdAt: at.createdAt, id: { lt: at.id } }] }] };
  }
  const rows = await scoped.phControlledEntry.findMany({
    where: { ...(branchId ? { branchId } : {}), ...(input.productId ? { productId: input.productId } : {}), ...range, ...after },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: input.limit,
    select: {
      id: true,
      branchId: true,
      saleId: true,
      productId: true,
      batchId: true,
      baseQty: true,
      kind: true,
      dispensedById: true,
      createdAt: true,
      product: { select: { tradeName: true } },
      batch: { select: { lot: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    branchId: r.branchId,
    saleId: r.saleId,
    productId: r.productId,
    productName: r.product.tradeName,
    batchId: r.batchId,
    lot: r.batch.lot,
    baseQty: r.baseQty,
    kind: r.kind,
    dispensedById: r.dispensedById,
    createdAt: r.createdAt.toISOString(),
  }));
}
