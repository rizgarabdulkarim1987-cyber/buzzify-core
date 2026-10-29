import { createHash } from 'node:crypto';
import { z } from 'zod';
import { baghdadDayOf } from '@/lib/baghdad';
import { scopedClient, type ScopedTx } from '@/server/data/tenant-db';
import { invoiceFingerprint, normalizeInvoiceNumber } from '@/server/domain/pharmacy/purchasing';
import { StudioError } from '@/server/studio/framework/result';
import { asRetryable, createDraft, INTAKE_KEY_PREFIX, receiptLineInput, type ReceiptInput } from '../receipts';
import { intakeClientKey, releaseFileKey } from './files';
import { approvalOf, lockBatch, recomputeBatch, verdictTokenOf, type StoredHeader } from './rows';
import type { IntakeStorage } from './storage';

/**
 * Invoice intake, approval into a DRAFT receipt, cancel and the expiry sweep (R5-1, R5-10, R5-11, R5-13, R5-14). Approval never
 * writes stock: it creates a DRAFT receipt through the receipt service (`createDraft`, so the receipt tables are still written
 * by that service alone), links it on the batch and closes the batch. The receipt is confirmed later by the normal receiving
 * path.
 *
 * Lock order (extends files.ts and extract.ts): client key (advisory, `NS_APPROVE_KEY` 7301 on `restaurantId:clientKey`, the
 * approval's own key) -> the batch row FOR UPDATE -> its file rows (by id) -> its line rows (by id) -> the invoice guard
 * (advisory, `NS_APPROVE_INVOICE` 7302 on `restaurantId:supplierId:invoice number`, so two batches of one invoice meet here)
 * -> the receipt service's own writes. A cancel takes the batch, then the files. Deadlock (40P01) and serialisation failure are
 * retryable conflicts in the action. The receipt for a batch has the key `intake-approve:<batchId>`: a batch makes one receipt.
 *
 * The audit entries hold ids, counts, statuses and flag codes: never a name, a lot, an amount, a currency, an invoice number, a
 * note or a reason.
 */

/** Advisory namespaces of the approval (unused by any other lock): its request key, and one supplier's invoice number. */
export const NS_APPROVE_KEY = 7301;
export const NS_APPROVE_INVOICE = 7302;

/** Time a sweep transaction may take (it deletes remote objects). */
const SWEEP_TIMEOUT_MS = 60_000;

/** An open batch not touched for this many days is cancelled by the sweep. */
export const EXPIRE_DAYS = 30;

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
const toJson = (value: unknown): { [key: string]: Json } => JSON.parse(JSON.stringify(value)) as { [key: string]: Json };
const asObject = (value: unknown): Record<string, unknown> => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

const notFound = () => new StudioError('NOT_FOUND', 'Batch not found');
const notOpen = () => new StudioError('CONFLICT', 'Only an open batch can be approved or cancelled', { phCode: 'NOT_OPEN' });
const stale = () => new StudioError('CONFLICT', 'Someone else changed this invoice: reload it', { phCode: 'VERSION_CONFLICT' });
const approvalStale = () => new StudioError('CONFLICT', 'The invoice is not what you reviewed: look at it again before you approve', { phCode: 'APPROVAL_STALE' });
const keyMismatch = () => new StudioError('CONFLICT', 'This key was already used for a different approval', { phCode: 'CLIENT_KEY_MISMATCH' });
const storageFailed = () => new StudioError('CONFLICT', 'The invoice files could not be deleted: try again', { phCode: 'STORAGE_FAILED' });

type Audit = (entry: { action: string; entityType: string; entityId: string; changes: Record<string, { before: unknown; after: unknown }> }) => void;

// Approval ---------------------------------------------------------------------------------------------------------------

export const approveInput = z.object({
  batchId: z.string().min(1).max(64),
  clientKey: intakeClientKey,
  /** The batch version and the verdict token `ph.intake.batch.get` returned: what the reviewer saw. */
  expectedVersion: z.number().int().min(1),
  verdictToken: z.string().min(1).max(100),
});

export interface Approved {
  batchId: string;
  receiptId: string;
  lineCount: number;
  replayed: boolean;
}

const payloadHash = (a: { batchId: string; expectedVersion: number; verdictToken: string }) => createHash('sha256').update(JSON.stringify([a.batchId, a.expectedVersion, a.verdictToken])).digest('hex');

/**
 * Approves an OPEN batch of the place's branch into one DRAFT receipt, or returns the receipt the same request already made
 * (`replayed`). Everything is decided from stored values under the locks; nothing is taken from the client but the key, the
 * version and the token.
 */
export async function approveBatch(
  tx: ScopedTx,
  a: { restaurantId: string; branchId: string; userId: string; batchId: string; clientKey: string; expectedVersion: number; verdictToken: string; now: Date; audit: Audit },
): Promise<Approved> {
  // eslint-disable-next-line no-restricted-properties -- an advisory lock touches no tenant rows: it only serialises one request key
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NS_APPROVE_KEY}::int, hashtext(${`${a.restaurantId}:${a.clientKey}`}))`;
  const hash = payloadHash(a);
  const prior = await tx.phIntakeBatch.findFirst({
    where: { header: { path: ['approval', 'clientKey'], equals: a.clientKey } },
    select: { id: true, branchId: true, receiptId: true, approvedById: true, header: true },
  });
  if (prior) {
    const stored = asObject(asObject(prior.header).approval);
    if (prior.id !== a.batchId || prior.branchId !== a.branchId || prior.approvedById !== a.userId || stored.payloadHash !== hash || !prior.receiptId) throw keyMismatch();
    return { batchId: prior.id, receiptId: prior.receiptId, lineCount: await tx.phReceiptLine.count({ where: { receiptId: prior.receiptId } }), replayed: true };
  }

  const found = await tx.phIntakeBatch.findFirst({ where: { id: a.batchId, branchId: a.branchId }, select: { id: true } });
  if (!found) throw notFound();
  await lockBatch(tx, a.restaurantId, a.batchId);
  const batch = await tx.phIntakeBatch.findFirst({ where: { id: a.batchId }, select: { status: true, version: true, supplierId: true, header: true } });
  if (!batch) throw notFound();
  if (batch.status !== 'OPEN') throw notOpen();
  if (batch.version !== a.expectedVersion) throw stale();

  // The files, then the lines, locked in id order; a file still being read may still bring lines.
  // eslint-disable-next-line no-restricted-properties -- row locks on the batch's files and lines, in id order (the lock order of this phase)
  await tx.$queryRaw`SELECT "id" FROM "PhIntakeFile" WHERE "batchId" = ${a.batchId} AND "restaurantId" = ${a.restaurantId} ORDER BY "id" COLLATE "C" FOR UPDATE`;
  // eslint-disable-next-line no-restricted-properties -- see above
  await tx.$queryRaw`SELECT r."id" FROM "PhIntakeRow" r JOIN "PhIntakeFile" f ON f."id" = r."fileId" WHERE f."batchId" = ${a.batchId} AND r."restaurantId" = ${a.restaurantId} ORDER BY r."id" COLLATE "C" FOR UPDATE OF r`;
  const files = await tx.phIntakeFile.findMany({ where: { batchId: a.batchId }, select: { id: true, status: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  const processing = files.filter((f) => f.status === 'UPLOADED' || f.status === 'EXTRACTING').length;
  if (processing > 0) throw new StudioError('CONFLICT', 'Some files are still being read: wait for them', { phCode: 'FILES_STILL_PROCESSING', files: String(processing) });

  // Flags, differences and the header arithmetic again, from the stored values.
  const { rows, header } = await recomputeBatch(tx, a.batchId, a.now);
  if (verdictTokenOf({ version: batch.version, supplierId: batch.supplierId, files, rows, header }) !== a.verdictToken) throw approvalStale();

  const live = rows.filter((r) => !r.removed);
  const verdict = approvalOf(rows, header, 0);
  if (!verdict.ok) {
    const reasons = verdict.reasons.flatMap((r): Array<Record<string, unknown>> => {
      if (r.code === 'OPEN_FLAG') return [{ code: r.code, rowId: live[r.rowIndex]!.id, flag: r.flag }];
      if (r.code === 'NO_ROWS' || r.code === 'HEADER_MISMATCH') return [{ code: r.code }];
      return [];
    });
    throw notApprovable(reasons);
  }
  if (!batch.supplierId) throw new StudioError('INVALID', 'Choose the supplier before you approve', { supplierId: 'Choose the supplier before you approve', phCode: 'SUPPLIER_REQUIRED' });
  const supplier = await tx.phSupplier.findFirst({ where: { id: batch.supplierId }, select: { active: true } });
  if (!supplier) throw new StudioError('NOT_FOUND', 'Supplier not found');
  if (!supplier.active) throw new StudioError('CONFLICT', 'This supplier is archived', { phCode: 'SUPPLIER_ARCHIVED' });
  const currency = header.values.currency;
  if (!currency) throw new StudioError('INVALID', 'Choose the invoice currency first', { currency: 'Choose the invoice currency first', phCode: 'CURRENCY_REQUIRED' });

  // The receipt's lines are the effective rows, checked by the receipt's own rules.
  const lines: ReceiptInput['lines'] = [];
  const unusable: Array<{ code: string; rowId: string }> = [];
  for (const r of live) {
    if (r.line.unitCost !== null && !Number.isSafeInteger(r.line.unitCost)) {
      unusable.push({ code: 'INVALID_LINE', rowId: r.id });
      continue;
    }
    const parsed = receiptLineInput.safeParse({
      productId: r.matchedProductId,
      unitId: r.matchedUnitId,
      qty: r.line.quantity,
      bonusQty: r.line.bonus ?? 0,
      lot: r.line.lot,
      // a month on the invoice stays a month on the receipt
      expiry: r.expiry === null ? null : r.expiry.precision === 'MONTH' ? `${r.expiry.date.slice(5, 7)}/${r.expiry.date.slice(0, 4)}` : r.expiry.date,
      unitCostMinor: r.line.unitCost === null ? null : BigInt(r.line.unitCost),
      currency,
      freeOfCharge: r.line.freeOfCharge,
      acceptExpired: r.derived.includes('EXPIRED'),
    });
    if (parsed.success) lines.push(parsed.data);
    else unusable.push({ code: 'INVALID_LINE', rowId: r.id });
  }
  if (unusable.length > 0) throw notApprovable(unusable);

  // The same invoice is entered once, so it must have a number to be compared by: the guard is never skipped.
  const number = header.values.invoiceNumber;
  const numberKey = number === null ? null : safeNumber(number);
  if (number === null || numberKey === null) {
    throw new StudioError('INVALID', 'Enter the invoice number before you approve', { invoiceNumber: 'Enter the invoice number before you approve', phCode: 'INVOICE_NUMBER_REQUIRED' });
  }
  // By the supplier's number (however it is spelled) or its fingerprint, among the supplier invoices and among the batches
  // already approved, in EVERY branch of the business (an invoice photographed in two branches is one invoice). The guard lock
  // makes two batches of one invoice meet; it has no branch in its key.
  // eslint-disable-next-line no-restricted-properties -- an advisory lock touches no tenant rows: it only serialises one supplier's invoice number
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NS_APPROVE_INVOICE}::int, hashtext(${`${a.restaurantId}:${batch.supplierId}:${numberKey}`}))`;
  const fingerprint =
    header.values.invoiceDate !== null && header.values.total !== null
      ? invoiceFingerprint({ supplierId: batch.supplierId, number: numberKey, date: header.values.invoiceDate, currency, totalMinor: BigInt(header.values.total) })
      : null;
  const twin = await tx.phSupplierInvoice.findFirst({ where: { OR: [{ supplierId: batch.supplierId, number: numberKey }, ...(fingerprint ? [{ fingerprint }] : [])] }, select: { id: true } });
  if (twin) throw new StudioError('CONFLICT', 'This invoice was already entered', { phCode: 'DUPLICATE_INVOICE', existingInvoiceId: twin.id });
  // The batch table is branch-scoped through `tx`, so this read is raw and filtered by the business alone (only ids come back).
  // A batch whose receipt was voided no longer holds its invoice.
  // eslint-disable-next-line no-restricted-properties -- business-wide duplicate check across branches; the business is part of the match
  const siblings = await tx.$queryRaw<{ id: string }[]>`
    SELECT b."id" FROM "PhIntakeBatch" b LEFT JOIN "PhReceipt" r ON r."id" = b."receiptId" AND r."restaurantId" = b."restaurantId"
    WHERE b."restaurantId" = ${a.restaurantId} AND b."supplierId" = ${batch.supplierId} AND b."status" = 'APPROVED' AND b."id" <> ${a.batchId}
      AND COALESCE(r."status"::text, '') <> 'VOID'
      AND (b."header"->'approval'->>'invoiceKey' = ${numberKey} OR (${fingerprint}::text IS NOT NULL AND b."header"->'approval'->>'fingerprint' = ${fingerprint}::text))
    ORDER BY b."id" LIMIT 1`;
  if (siblings[0]) throw new StudioError('CONFLICT', 'This invoice was already entered', { phCode: 'DUPLICATE_INVOICE', batchId: siblings[0].id });

  const receipt = await createDraft(tx, {
    restaurantId: a.restaurantId,
    branchId: a.branchId,
    clientKey: `${INTAKE_KEY_PREFIX}${a.batchId}`,
    userId: a.userId,
    input: {
      supplierName: '',
      supplierId: batch.supplierId,
      reference: number.slice(0, 100),
      receivedOn: baghdadDayOf(a.now),
      note: '',
      lines,
    },
  });

  const stored = asObject((await tx.phIntakeBatch.findFirst({ where: { id: a.batchId }, select: { header: true } }))?.header) as StoredHeader;
  const won = await tx.phIntakeBatch.updateMany({
    where: { id: a.batchId, status: 'OPEN', version: batch.version },
    data: {
      status: 'APPROVED',
      receiptId: receipt.id,
      approvedAt: a.now,
      approvedById: a.userId,
      version: { increment: 1 },
      header: toJson({ ...stored, approval: { clientKey: a.clientKey, payloadHash: hash, invoiceKey: numberKey, fingerprint } }),
    },
  });
  if (won.count !== 1) throw stale();

  const acknowledged = [...new Set(live.flatMap((r) => r.derived.filter((f) => !r.open.includes(f))))].sort();
  a.audit({
    action: 'ph.intake.approve',
    entityType: 'PhIntakeBatch',
    entityId: a.batchId,
    changes: {
      status: { before: 'OPEN', after: 'APPROVED' },
      receiptId: { before: null, after: receipt.id },
      lineCount: { before: null, after: lines.length },
      fileCount: { before: null, after: files.length },
      acknowledgedFlags: { before: null, after: acknowledged },
    },
  });
  a.audit({
    action: 'ph.receipt.create',
    entityType: 'PhReceipt',
    entityId: receipt.id,
    changes: {
      status: { before: null, after: 'DRAFT' },
      branchId: { before: null, after: a.branchId },
      lineCount: { before: null, after: lines.length },
    },
  });
  return { batchId: a.batchId, receiptId: receipt.id, lineCount: lines.length, replayed: false };
}

const safeNumber = (raw: string): string | null => {
  try {
    return normalizeInvoiceNumber(raw);
  } catch {
    return null;
  }
};

/** A deadlock or serialisation failure in an approval or a cancel: its own sentence (the receipt one speaks of a receipt). */
export function retryable(error: unknown): unknown {
  const e = asRetryable(error);
  return e === error ? error : new StudioError('CONFLICT', 'Someone else is changing this invoice: try again', { phCode: 'RETRY' });
}

/** Row ids and flag codes only: the reasons are machine readable and carry no value of the invoice. */
function notApprovable(reasons: ReadonlyArray<Record<string, unknown>>): StudioError {
  return new StudioError('CONFLICT', 'The invoice still has open items: check them before you approve', { phCode: 'NOT_APPROVABLE', reasons: JSON.stringify(reasons) });
}

// Cancel ------------------------------------------------------------------------------------------------------------------

export const cancelInput = z.object({
  batchId: z.string().min(1).max(64),
  /** Stored on the batch, never in the audit. */
  reason: z.string().trim().max(500, 'Use at most 500 characters').optional(),
});

export interface Cancelled {
  batchId: string;
  status: 'CANCELLED';
  releasedFiles: number;
  replayed: boolean;
}

/**
 * Lets go of every file of a batch the caller holds locked and closes the batch as CANCELLED. Each file's object is deleted
 * first (`releaseFileKey`), so a store that refuses leaves everything as it was (the transaction rolls back).
 */
async function releaseBatch(tx: ScopedTx, storage: IntakeStorage, a: { restaurantId: string; batchId: string; version: number; header: unknown; now: Date; note: Record<string, Json> }): Promise<number> {
  // eslint-disable-next-line no-restricted-properties -- row locks on the batch's files, in id order (the lock order of this phase)
  await tx.$queryRaw`SELECT "id" FROM "PhIntakeFile" WHERE "batchId" = ${a.batchId} AND "restaurantId" = ${a.restaurantId} ORDER BY "id" COLLATE "C" FOR UPDATE`;
  const files = await tx.phIntakeFile.findMany({ where: { batchId: a.batchId, status: { not: 'PURGED' } }, select: { id: true, sha256: true, storageKey: true }, orderBy: { id: 'asc' } });
  try {
    for (const file of files) await releaseFileKey(tx, storage, file);
  } catch (error) {
    if (error instanceof StudioError) throw error;
    console.error(`[intake] could not delete the files of batch ${a.batchId}`);
    throw storageFailed();
  }
  const won = await tx.phIntakeBatch.updateMany({
    where: { id: a.batchId, status: 'OPEN', version: a.version },
    data: { status: 'CANCELLED', cancelledAt: a.now, version: { increment: 1 }, header: toJson({ ...asObject(a.header), cancelled: a.note }) },
  });
  if (won.count !== 1) throw stale();
  return files.length;
}

/** Cancels an OPEN batch of the place's branch. A batch that is already cancelled answers the same way again (`replayed`). */
export async function cancelBatch(
  tx: ScopedTx,
  storage: IntakeStorage,
  a: { restaurantId: string; branchId: string; batchId: string; reason?: string; now: Date; audit: Audit },
): Promise<Cancelled> {
  const found = await tx.phIntakeBatch.findFirst({ where: { id: a.batchId, branchId: a.branchId }, select: { id: true } });
  if (!found) throw notFound();
  await lockBatch(tx, a.restaurantId, a.batchId);
  const batch = await tx.phIntakeBatch.findFirst({ where: { id: a.batchId }, select: { status: true, version: true, header: true } });
  if (!batch) throw notFound();
  if (batch.status === 'CANCELLED') return { batchId: a.batchId, status: 'CANCELLED', releasedFiles: 0, replayed: true };
  if (batch.status !== 'OPEN') throw notOpen();
  const released = await releaseBatch(tx, storage, { restaurantId: a.restaurantId, batchId: a.batchId, version: batch.version, header: batch.header, now: a.now, note: a.reason ? { reason: a.reason } : {} });
  a.audit({
    action: 'ph.intake.cancel',
    entityType: 'PhIntakeBatch',
    entityId: a.batchId,
    changes: { status: { before: 'OPEN', after: 'CANCELLED' }, releasedFiles: { before: null, after: released } },
  });
  return { batchId: a.batchId, status: 'CANCELLED', releasedFiles: released, replayed: false };
}

// Expiry --------------------------------------------------------------------------------------------------------------------

/**
 * Cancels the OPEN batches nobody touched for `olderThanDays` (default 30), across every business, one transaction each. A
 * batch is looked at again under its lock: one edited, approved or cancelled meanwhile is left alone. A batch whose files could
 * not be deleted stays as it was (the next run retries it) and is counted in `failed`; only its id is logged. Returns counts
 * only. Scheduling it is a launch step.
 */
export async function expireOpenBatches(
  everyone: Parameters<typeof scopedClient>[0],
  args: { now: Date; olderThanDays?: number; limit?: number; storage: IntakeStorage },
): Promise<{ cancelled: number; failed: number }> {
  const cutoff = new Date(args.now.getTime() - (args.olderThanDays ?? EXPIRE_DAYS) * 86_400_000);
  const limit = args.limit ?? 500;
  let cancelled = 0;
  let failed = 0;
  const businesses = await everyone.restaurant.findMany({ where: { phIntakeBatches: { some: { status: 'OPEN', updatedAt: { lt: cutoff } } } }, select: { id: true }, orderBy: { id: 'asc' } });
  for (const { id: restaurantId } of businesses) {
    if (cancelled + failed >= limit) break;
    const scoped = scopedClient(everyone, { restaurantId, allBranches: true });
    const due = await scoped.phIntakeBatch.findMany({ where: { status: 'OPEN', updatedAt: { lt: cutoff } }, select: { id: true }, orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }], take: limit - cancelled - failed });
    for (const { id } of due) {
      try {
        const done = await scoped.$transaction(
          async (tx) => {
            await lockBatch(tx, restaurantId, id);
            const batch = await tx.phIntakeBatch.findFirst({ where: { id }, select: { status: true, version: true, header: true, updatedAt: true } });
            if (!batch || batch.status !== 'OPEN' || batch.updatedAt >= cutoff) return null;
            // Worked on lately: a file waiting to be read or being read keeps the batch alive (uploads, reads and edits also touch the batch).
            const active = await tx.phIntakeFile.count({
              where: { batchId: id, status: { in: ['UPLOADED', 'EXTRACTING'] } },
            });
            if (active > 0) return null;
            return releaseBatch(tx, args.storage, { restaurantId, batchId: id, version: batch.version, header: batch.header, now: args.now, note: { expired: true } });
          },
          { timeout: SWEEP_TIMEOUT_MS },
        );
        if (done !== null) {
          cancelled += 1;
          // The system acts: no actor, ids and counts only.
          await everyone.auditLog.create({
            data: { restaurantId, action: 'ph.intake.expire', entityType: 'PhIntakeBatch', entityId: id, changes: { status: { before: 'OPEN', after: 'CANCELLED' }, releasedFiles: { before: null, after: done } } },
          });
        }
      } catch {
        failed += 1;
        console.error(`[intake] could not expire batch ${id}`);
      }
    }
  }
  return { cancelled, failed };
}
