import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ScopedClient, ScopedTx } from '@/server/data/tenant-db';
import { baghdadDay } from '@/server/domain/pharmacy/reports-domain';
import { canPh } from '@/server/domain/pharmacy/permissions';
import {
  checkIssuedOn,
  checkPatientIdNote,
  controlledQtyCheck,
  duplicateWindowStart,
  isDuplicateUse,
  normalizeRxNumber,
  type RxLevel,
} from '@/server/domain/pharmacy/prescriptions';
import { sniffMediaType } from '@/server/domain/media-type';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from './actor';
import { getIntakeStorage, intakeKey, IntakeStorageNotConfiguredError, type IntakeStorage } from './intake/storage';

/**
 * Prescriptions and the controlled-drug register (phase 7, R7-1 to R7-4). This file owns the writes of PhPrescription,
 * PhRxAttachment and PhControlledEntry (enforcement rule 8): sales.ts and returns.ts call it, they never write these tables.
 *
 * A prescription is recorded as a DRAFT before the sale (no `saleId`); the sale that uses it links it, in the sale's own
 * transaction, and writes one register row per batch a controlled line took from. A return of a controlled line writes
 * reversing rows (negative quantity). The register is append-only: there is no update or delete anywhere (a trigger refuses it
 * too), and no function in this file reads or writes it any other way.
 *
 * Lock order (a sale takes these in this order, after its key and its shift): the prescription row `FOR UPDATE` -> the
 * business-wide prescription-number lock (advisory, namespace 7142) -> the stock rows (sales.ts). Creating a prescription takes
 * only its key (advisory, namespace 7141). The bytes of an attachment are written to the private store BEFORE and OUTSIDE any
 * transaction, and read back only by `readAttachment`, which checks `rx.attachment.view` itself.
 *
 * Patient, prescriber and number fields never reach an audit row, a log or a message: the audit carries ids, counts and statuses.
 */

const NS_RX_KEY = 7141;
const NS_RX_NUMBER = 7142;
/** The largest file kept with a prescription. */
export const RX_FILE_MAX_BYTES = 5 * 1024 * 1024;

// Input ---------------------------------------------------------------------------------------------------------------

const clientKeyText = z.string().trim().min(8, 'Use at least 8 characters').max(100, 'Use at most 100 characters');
const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .optional()
    .transform((value) => (value === undefined || value === '' ? undefined : value));

export const prescriptionInput = z.object({
  clientKey: clientKeyText,
  /** What the paper says. */
  number: z.string().trim().min(1, 'Enter the prescription number').max(40, 'Use at most 40 characters'),
  prescriberName: z.string().trim().min(1, 'Enter the prescriber’s name').max(120, 'Use at most 120 characters'),
  prescriberLicense: optionalText(40, 'Use at most 40 characters'),
  patientName: optionalText(120, 'Use at most 120 characters'),
  /** The type of the identity document and at most the last 4 characters of its number. */
  patientIdNote: optionalText(60, 'Use at most 60 characters'),
  issuedOn: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date'),
});
export type PrescriptionInput = z.infer<typeof prescriptionInput>;

const idText = z.string().min(1).max(64);
export const prescriptionIdInput = z.object({ prescriptionId: idText });
export const attachmentIdInput = z.object({ id: idText });

// Refusals ------------------------------------------------------------------------------------------------------------

const invalid = (field: string, message: string, phCode?: string) => new StudioError('INVALID', message, { [field]: message, ...(phCode ? { phCode } : {}) });
const conflict = (phCode: string, message: string, extra: Record<string, string> = {}) => new StudioError('CONFLICT', message, { phCode, ...extra });
const notFound = () => new StudioError('NOT_FOUND', 'Prescription not found', { phCode: 'PRESCRIPTION_NOT_FOUND' });
const NOTE_REFUSAL = 'Write the document type and at most the last 4 characters of its number';

/** Anyone but a staff member holding `rx.dispense`: a support actor has no role, so never. */
function assertMayDispense(ph: PhActor): void {
  if (ph.role === null || ph.support !== null || !canPh(ph.role, 'rx.dispense')) throw new StudioError('FORBIDDEN');
}

const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const dateAt = (day: string) => new Date(`${day}T00:00:00.000Z`);

// Creating a prescription ---------------------------------------------------------------------------------------------

function inputHash(input: PrescriptionInput): string {
  const canonical = [input.clientKey, normalizeRxNumber(input.number), input.prescriberName, input.prescriberLicense ?? null, input.patientName ?? null, input.patientIdNote ?? null, input.issuedOn];
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export interface PrescriptionCreated {
  id: string;
  branchId: string;
  issuedOn: string;
  saleId: string | null;
  replayed: boolean;
}

/**
 * Records a prescription in `branchId` (a draft: no sale yet), or returns the one the same `clientKey` already made. A repeat must
 * come from the same person, for the same branch, with the same content: anything else is `CLIENT_KEY_MISMATCH`. The date must not
 * be in the future nor older than the longest validity (180 days); the stricter 30 days of a controlled drug is judged by the sale.
 */
export async function createPrescription(
  tx: ScopedTx,
  args: { ph: PhActor; branchId: string; input: PrescriptionInput; now?: Date },
): Promise<{ result: PrescriptionCreated; audit: { branchId: string } | null }> {
  const { ph, branchId, input } = args;
  assertMayDispense(ph);
  const now = args.now ?? new Date();
  const hash = inputHash(input);
  // eslint-disable-next-line no-restricted-properties -- an advisory lock touches no tenant rows: it only serialises one prescription key
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NS_RX_KEY}::int, hashtext(${`${ph.restaurantId}:${input.clientKey}`}))`;
  const earlier = await tx.phPrescription.findFirst({
    where: { clientKey: input.clientKey },
    select: { id: true, branchId: true, issuedOn: true, saleId: true, createdById: true, payloadHash: true },
  });
  if (earlier) {
    if (earlier.branchId !== branchId || earlier.createdById !== ph.userId || earlier.payloadHash !== hash) {
      throw conflict('CLIENT_KEY_MISMATCH', 'This key was already used for a different prescription');
    }
    return { result: { id: earlier.id, branchId: earlier.branchId, issuedOn: dayOf(earlier.issuedOn), saleId: earlier.saleId, replayed: true }, audit: null };
  }

  const dated = checkIssuedOn(input.issuedOn, baghdadDay(now), 'RX');
  if (!dated.ok) {
    if (dated.reason === 'FUTURE') throw invalid('issuedOn', 'The prescription date is in the future', 'RX_DATE_FUTURE');
    if (dated.reason === 'EXPIRED') throw invalid('issuedOn', 'This prescription is too old to use', 'RX_EXPIRED');
    throw invalid('issuedOn', 'Enter a valid date');
  }
  let patientIdNote: string | null = null;
  if (input.patientIdNote !== undefined) {
    const note = checkPatientIdNote(input.patientIdNote);
    if (!note.ok) throw invalid('patientIdNote', NOTE_REFUSAL, note.reason === 'TOO_LONG' ? 'ID_NOTE_TOO_LONG' : 'ID_NOTE_SHAPE');
    patientIdNote = note.value;
  }
  const made = await tx.phPrescription.create({
    data: {
      restaurantId: ph.restaurantId,
      branchId,
      number: normalizeRxNumber(input.number),
      prescriberName: input.prescriberName,
      prescriberLicense: input.prescriberLicense ?? null,
      patientName: input.patientName ?? null,
      patientIdNote,
      issuedOn: dateAt(input.issuedOn),
      clientKey: input.clientKey,
      payloadHash: hash,
      createdById: ph.userId,
      createdAt: now,
    },
    select: { id: true },
  });
  return { result: { id: made.id, branchId, issuedOn: input.issuedOn, saleId: null, replayed: false }, audit: { branchId } };
}

// Files ---------------------------------------------------------------------------------------------------------------

/** The type the bytes really have among the four a prescription file may be, or null: never what a browser said. */
export function sniffRxType(bytes: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf' | null {
  if (bytes.length >= 5 && String.fromCharCode(...bytes.subarray(0, 5)) === '%PDF-') return 'application/pdf';
  const type = sniffMediaType(bytes.subarray(0, 4096));
  return type === 'image/jpeg' || type === 'image/png' || type === 'image/webp' ? type : null;
}

export interface PreparedRxFile {
  mime: string;
  bytes: Uint8Array;
  sha256: string;
}

/** Checks one upload (type from its bytes, size 1 byte to 5 MB) and hashes it. No database. */
export function prepareRxFile(bytes: Uint8Array): PreparedRxFile {
  if (bytes.length === 0) throw invalid('file', 'The file is empty', 'EMPTY');
  if (bytes.length > RX_FILE_MAX_BYTES) throw invalid('file', 'The file is larger than 5 MB', 'TOO_LARGE');
  const mime = sniffRxType(bytes);
  if (mime === null) throw invalid('file', 'The file must be a JPEG, PNG, WebP or PDF', 'UNSUPPORTED_TYPE');
  return { mime, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

/** The private store, or the typed state when production has none (upload is then off, never a fallback). */
export function rxStorage(): IntakeStorage {
  try {
    return getIntakeStorage();
  } catch (error) {
    if (error instanceof IntakeStorageNotConfiguredError) throw conflict(error.code, 'Prescription files cannot be stored yet');
    throw error;
  }
}

/** The key an attachment is stored under: made from ids only. */
export const rxStorageKey = (restaurantId: string, attachmentId: string): string => intakeKey(restaurantId, `rx-${attachmentId}`);

/** A new attachment id, made before the object is written so the object's key is known first. */
export const newAttachmentId = (): string => randomUUID();

export interface AttachmentAdded {
  id: string;
  prescriptionId: string;
  mime: string;
  sizeBytes: number;
}

/** Whether the branch's prescription exists for the actor: a look without a lock, before any object is written. */
export async function assertPrescriptionHere(view: ScopedClient | ScopedTx, branchId: string, prescriptionId: string): Promise<void> {
  const found = await view.phPrescription.findFirst({ where: { id: prescriptionId, branchId }, select: { id: true } });
  if (!found) throw notFound();
}

/** Records the stored object of a prescription (the caller wrote it first and deletes it when this throws). */
export async function recordAttachment(
  tx: ScopedTx,
  args: { ph: PhActor; branchId: string; prescriptionId: string; id: string; storageKey: string; file: PreparedRxFile; now?: Date },
): Promise<AttachmentAdded> {
  assertMayDispense(args.ph);
  await assertPrescriptionHere(tx, args.branchId, args.prescriptionId);
  await tx.phRxAttachment.create({
    data: {
      id: args.id,
      restaurantId: args.ph.restaurantId,
      branchId: args.branchId,
      prescriptionId: args.prescriptionId,
      storageKey: args.storageKey,
      mime: args.file.mime,
      sizeBytes: args.file.bytes.length,
      sha256: args.file.sha256,
      uploadedById: args.ph.userId,
      createdAt: args.now ?? new Date(),
    },
    select: { id: true },
  });
  return { id: args.id, prescriptionId: args.prescriptionId, mime: args.file.mime, sizeBytes: args.file.bytes.length };
}

/**
 * The bytes of one attachment, for the person who may see them: a staff member holding `rx.attachment.view` (the framework checked
 * the permission; this checks it again, and refuses a support actor, who holds no role). An attachment of another business or of a
 * branch the actor does not reach is `File not found`, like a missing one.
 */
export async function readAttachment(
  scoped: ScopedClient,
  ph: PhActor,
  storage: IntakeStorage,
  id: string,
): Promise<{ id: string; prescriptionId: string; mime: string; sizeBytes: number; bytes: Uint8Array }> {
  if (ph.role === null || ph.support !== null || !canPh(ph.role, 'rx.attachment.view')) throw new StudioError('FORBIDDEN');
  const gone = () => new StudioError('NOT_FOUND', 'File not found');
  const row = await scoped.phRxAttachment.findFirst({ where: { id }, select: { id: true, prescriptionId: true, storageKey: true, mime: true, sizeBytes: true } });
  if (!row) throw gone();
  const stored = await storage.get(row.storageKey);
  if (!stored) throw gone();
  return { id: row.id, prescriptionId: row.prescriptionId, mime: row.mime, sizeBytes: row.sizeBytes, bytes: stored.bytes };
}

// The sale ------------------------------------------------------------------------------------------------------------

export interface ControlledLine {
  productId: string;
  tradeName: string;
  baseQty: number;
}

export interface ClaimedPrescription {
  id: string;
}

/**
 * Judges the prescription a sale carries and takes it (its row, then the number lock) until the sale commits. Called by
 * `createSale` before it takes stock locks. `restricted` is the sale's controlled lines; `prescriptionId` may be absent only when
 * there are none. Returns null when the sale uses no prescription.
 *
 * Refusals: the prescription is missing, of another business or branch (`PRESCRIPTION_NOT_FOUND`); already used by a sale
 * (`PRESCRIPTION_USED`); not yet or no longer valid (`RX_DATE_FUTURE`, `RX_EXPIRED`: 30 days for a controlled drug, else 180);
 * for a controlled drug, no patient name (`PATIENT_REQUIRED`), more than `maxQty` of one product (`CONTROLLED_QTY_LIMIT`), or the
 * same number already dispensed for the same product within the window, in any branch of the business (`DUPLICATE_PRESCRIPTION`).
 */
export async function claimPrescription(
  tx: ScopedTx,
  args: { restaurantId: string; branchId: string; prescriptionId: string | undefined; restricted: readonly ControlledLine[]; maxQty: number; now: Date },
): Promise<ClaimedPrescription | null> {
  const { restaurantId, branchId, restricted } = args;
  if (args.prescriptionId === undefined) {
    if (restricted.length === 0) return null;
    throw invalid('prescriptionId', 'Choose the prescription for this sale', 'PRESCRIPTION_REQUIRED');
  }
  const id = args.prescriptionId;
  // eslint-disable-next-line no-restricted-properties -- a row lock on one prescription of this business and branch (two sales of one prescription queue up)
  const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "PhPrescription" WHERE "id" = ${id} AND "restaurantId" = ${restaurantId} AND "branchId" = ${branchId} FOR UPDATE`;
  if (locked.length === 0) throw notFound();
  const rx = await tx.phPrescription.findFirst({ where: { id, branchId }, select: { id: true, number: true, issuedOn: true, patientName: true, saleId: true } });
  if (!rx) throw notFound();
  if (rx.saleId !== null) throw conflict('PRESCRIPTION_USED', 'This prescription was already used for a sale');

  const level: RxLevel = restricted.length > 0 ? 'RESTRICTED' : 'RX';
  // The date on the paper is the pharmacist's local day (Baghdad, UTC+3), not the UTC day: between 00:00 and 03:00 local a prescription
  // dated today must not read as the future.
  const today = baghdadDay(args.now);
  const dated = checkIssuedOn(dayOf(rx.issuedOn), today, level);
  if (!dated.ok) {
    if (dated.reason === 'FUTURE') throw invalid('prescriptionId', 'The prescription date is in the future', 'RX_DATE_FUTURE');
    throw invalid('prescriptionId', 'This prescription is too old to use', 'RX_EXPIRED');
  }
  if (restricted.length === 0) return { id };

  if (rx.patientName === null || rx.patientName.trim() === '') throw invalid('prescriptionId', 'A controlled medicine needs the patient’s name', 'PATIENT_REQUIRED');
  const qty = controlledQtyCheck(args.maxQty, restricted);
  if (!qty.ok) {
    const name = restricted.find((l) => l.productId === qty.productId)?.tradeName ?? '';
    throw conflict('CONTROLLED_QTY_LIMIT', 'This is more of a controlled medicine than one sale may carry', { productId: qty.productId, productName: name, max: String(qty.max), total: String(qty.total) });
  }

  // The same number twice: serialised by the number across the whole business, then looked for in every branch (raw, because the
  // scoped client shows a branch-limited seller only their own branches).
  // eslint-disable-next-line no-restricted-properties -- an advisory lock touches no tenant rows: it only serialises one prescription number
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NS_RX_NUMBER}::int, hashtext(${`${restaurantId}:${rx.number.toLowerCase()}`}))`;
  const start = duplicateWindowStart(today);
  // eslint-disable-next-line no-restricted-properties -- a business-wide read of the register for one number, filtered by the actor's business
  const earlier = await tx.$queryRaw<{ productId: string; number: string; issuedOn: string }[]>`
    SELECT DISTINCT e."productId", p."number", to_char(p."issuedOn", 'YYYY-MM-DD') AS "issuedOn"
    FROM "PhControlledEntry" e
    JOIN "PhPrescription" p ON p."restaurantId" = e."restaurantId" AND p."id" = e."prescriptionId"
    WHERE e."restaurantId" = ${restaurantId} AND e."kind" = 'SALE' AND e."productId" = ANY(${restricted.map((l) => l.productId)})
      AND p."id" <> ${id} AND lower(p."number") = lower(${rx.number}) AND p."issuedOn" >= ${start}::date`;
  for (const line of restricted) {
    if (isDuplicateUse({ number: rx.number, productId: line.productId }, earlier, today)) {
      throw conflict('DUPLICATE_PRESCRIPTION', 'This prescription number was already used for this medicine', { productId: line.productId, productName: line.tradeName });
    }
  }
  return { id };
}

/**
 * Links the prescription to the sale that has just been written and writes the register: one SALE row for each batch a controlled
 * line took from (`entries`), in the same transaction. A guarded update links it (it must still have no sale), so a prescription
 * can never serve two sales.
 */
export async function recordControlledSale(
  tx: ScopedTx,
  args: {
    restaurantId: string;
    branchId: string;
    saleId: string;
    userId: string;
    prescriptionId: string;
    entries: readonly { saleLineId: string; productId: string; batchId: string; baseQty: number }[];
    now: Date;
  },
): Promise<void> {
  const linked = await tx.phPrescription.updateMany({ where: { id: args.prescriptionId, branchId: args.branchId, saleId: null }, data: { saleId: args.saleId } });
  if (linked.count !== 1) throw conflict('PRESCRIPTION_USED', 'This prescription was already used for a sale');
  if (args.entries.length === 0) return;
  await tx.phControlledEntry.createMany({
    data: args.entries.map((e) => ({
      restaurantId: args.restaurantId,
      branchId: args.branchId,
      saleId: args.saleId,
      saleLineId: e.saleLineId,
      productId: e.productId,
      batchId: e.batchId,
      prescriptionId: args.prescriptionId,
      baseQty: e.baseQty,
      kind: 'SALE' as const,
      dispensedById: args.userId,
      createdAt: args.now,
    })),
  });
}

/**
 * A return of controlled lines: one RETURN row per returned batch with the quantity negative, so the register of the sale nets
 * to what is still dispensed. The units themselves go to quarantine in returns.ts as for any return.
 */
export async function recordControlledReturn(
  tx: ScopedTx,
  args: {
    restaurantId: string;
    branchId: string;
    saleId: string;
    userId: string;
    entries: readonly { saleLineId: string; productId: string; batchId: string; baseQty: number }[];
    now: Date;
  },
): Promise<void> {
  if (args.entries.length === 0) return;
  const rx = await tx.phPrescription.findFirst({ where: { saleId: args.saleId, branchId: args.branchId }, select: { id: true } });
  if (!rx) throw new Error('A sale of a controlled medicine has no prescription');
  await tx.phControlledEntry.createMany({
    data: args.entries.map((e) => ({
      restaurantId: args.restaurantId,
      branchId: args.branchId,
      saleId: args.saleId,
      saleLineId: e.saleLineId,
      productId: e.productId,
      batchId: e.batchId,
      prescriptionId: rx.id,
      baseQty: -e.baseQty,
      kind: 'RETURN' as const,
      dispensedById: args.userId,
      createdAt: args.now,
    })),
  });
}
