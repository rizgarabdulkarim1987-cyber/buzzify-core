import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { delegates, scopedClient, type ScopedClient, type ScopedDb, type ScopedTx } from '@/server/data/tenant-db';
import { countPdfPages, intakeFileAcceptable, STORAGE, type FileRefusal, type QualityReason } from '@/server/domain/pharmacy/intake';
import { sniffMediaType } from '@/server/domain/media-type';
import { limitsOf } from '@/server/domain/pharmacy/limits';
import { canPh } from '@/server/domain/pharmacy/permissions';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from '../actor';
import { assertStaff } from '../receipts';
import { NS_CLIENT_KEY } from '../suppliers';
import { ImageUnreadableError, assessQuality, type QualityAssessment } from './quality';
import type { IntakeStorage } from './storage';

/**
 * Invoice intake, step one (R5-4, R5-5, R5-6, R5-13): batches of uploaded supplier invoices, their private storage, the size
 * and type rules, the quality gate, de-duplication and the 30-day purge. Intake never writes stock. The services take the
 * transaction of the action that calls them; the actions audit ids and counts only (never the file, its text or its name).
 *
 * Lock order of this phase (header comment of every service that locks): client key (advisory, namespace 7201) -> the
 * business's upload lock (advisory, namespace 7210, `hashtext(restaurantId)`: file count, stored bytes and the SHA-256 slot are
 * counted under it) -> the batch row FOR UPDATE -> (later tasks: file rows, then the budget row). An upload writes its object
 * BEFORE and OUTSIDE these locks (a slow store must not queue the business's uploads) and `commitFile` then records it in a
 * short locked step; the purge takes one file row at a time. `releaseFileKey` takes no lock of its own: the caller holds the
 * file row.
 *
 * Files and rows carry no branch of their own: they are reached through their batch, which is confined to the actor's
 * branches by the scoped client, so a file id of another branch behaves like one that does not exist.
 */

/** The advisory-lock namespace of the business's intake uploads. */
export const NS_INTAKE_UPLOAD = 7210;

/** Files are kept this long, then purged (their rows stay). */
export const RETENTION_DAYS = 30;
const DAY_MS = 86_400_000;

export const intakeClientKey = z.string().trim().min(8, 'Use at least 8 characters').max(100, 'Use at most 100 characters');

const keyMismatch = () => new StudioError('CONFLICT', 'This key was already used for a different batch', { phCode: 'CLIENT_KEY_MISMATCH' });
const batchNotFound = () => new StudioError('NOT_FOUND', 'Batch not found');
const refusal = (message: string, phCode: string) => new StudioError('INVALID', message, { file: message, phCode });

/** Starting or feeding a batch takes both `ai.use` and `purchase.manage` (R5-14). The framework checks the second; this the first. */
export function assertMayIntake(ph: PhActor): void {
  assertStaff(ph);
  if (!canPh(ph.role!, 'ai.use')) throw new StudioError('FORBIDDEN');
}

// Batches ---------------------------------------------------------------------------------------------------------------

export interface BatchCreated {
  id: string;
  status: 'OPEN' | 'APPROVED' | 'CANCELLED';
  branchId: string;
  supplierId: string | null;
  replayed: boolean;
}

const batchHash = (branchId: string, supplierId: string | null) => createHash('sha256').update(JSON.stringify([branchId, supplierId])).digest('hex');

/**
 * A new OPEN batch in `branchId`, or the one the same `clientKey` already made. A repeat must come from the same person, for
 * the same branch, with the same supplier: anything else is `CLIENT_KEY_MISMATCH`.
 */
export async function createBatch(
  tx: ScopedTx,
  args: { restaurantId: string; branchId: string; userId: string; clientKey: string; supplierId?: string | null },
): Promise<BatchCreated> {
  const supplierId = args.supplierId ?? null;
  const hash = batchHash(args.branchId, supplierId);
  // eslint-disable-next-line no-restricted-properties -- an advisory lock touches no tenant rows: it only serialises one client key
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NS_CLIENT_KEY}::int, hashtext(${`${args.restaurantId}:${args.clientKey}`}))`;
  const earlier = await tx.phIntakeBatch.findFirst({
    where: { clientKey: args.clientKey },
    select: { id: true, status: true, branchId: true, supplierId: true, createdById: true, payloadHash: true },
  });
  if (earlier) {
    if (earlier.branchId !== args.branchId || earlier.createdById !== args.userId || earlier.payloadHash !== hash) throw keyMismatch();
    return { id: earlier.id, status: earlier.status, branchId: earlier.branchId, supplierId: earlier.supplierId, replayed: true };
  }
  if (supplierId !== null) {
    const supplier = await tx.phSupplier.findFirst({ where: { id: supplierId }, select: { active: true } });
    if (!supplier) throw new StudioError('NOT_FOUND', 'Supplier not found');
    if (!supplier.active) throw new StudioError('CONFLICT', 'This supplier is archived', { phCode: 'SUPPLIER_ARCHIVED' });
  }
  const made = await tx.phIntakeBatch.create({
    data: { restaurantId: args.restaurantId, branchId: args.branchId, supplierId, clientKey: args.clientKey, payloadHash: hash, createdById: args.userId },
    select: { id: true },
  });
  return { id: made.id, status: 'OPEN', branchId: args.branchId, supplierId, replayed: false };
}

// Files -----------------------------------------------------------------------------------------------------------------

const REFUSALS: Record<FileRefusal, [string, string]> = {
  UNSUPPORTED_TYPE: ['The file must be a JPEG, PNG, WebP or PDF', 'UNSUPPORTED_TYPE'],
  EMPTY: ['The file is empty', 'EMPTY'],
  TOO_LARGE: ['The file is larger than 8 MB', 'TOO_LARGE'],
  TYPE_MISMATCH: ['The file is not the type it claims to be', 'TYPE_MISMATCH'],
  PAGES_UNKNOWN: ['The PDF could not be read: send photos or another PDF', 'PDF_UNREADABLE'],
  TOO_MANY_PAGES: ['A PDF can have at most 10 pages', 'TOO_MANY_PAGES'],
};

/** An upload checked outside any transaction: type, size, pages, hash and (for an image) quality. */
export interface PreparedFile {
  mediaType: string;
  bytes: Uint8Array;
  sha256: string;
  pages: number;
  quality: QualityAssessment;
}

/** The type the bytes really have among the four intake accepts, or null: never what a browser or a form field said. */
export function sniffIntakeType(bytes: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf' | null {
  if (bytes.length >= 5 && String.fromCharCode(...bytes.subarray(0, 5)) === '%PDF-') return 'application/pdf';
  const type = sniffMediaType(bytes.subarray(0, 4096));
  return type === 'image/jpeg' || type === 'image/png' || type === 'image/webp' ? type : null;
}

/**
 * Checks one upload against the per-file rules (the type is the one the bytes really have, never the header's word), hashes
 * it and measures an image's quality. Pure CPU, no database: the action does it before it opens the transaction, so the
 * business's upload lock is not held while an image decodes.
 */
export async function prepareFile(input: { bytes: Uint8Array }): Promise<PreparedFile> {
  const mediaType = sniffIntakeType(input.bytes) ?? 'application/octet-stream';
  const pages = mediaType === 'application/pdf' ? countPdfPages(input.bytes) : null;
  const verdict = intakeFileAcceptable({ mediaType, bytes: input.bytes, pages });
  if (!verdict.ok) {
    const [message, phCode] = REFUSALS[verdict.reason];
    throw refusal(message, phCode);
  }
  let quality: QualityAssessment;
  try {
    quality = await assessQuality(input.bytes, mediaType);
  } catch (error) {
    if (error instanceof ImageUnreadableError) throw refusal('The image could not be read', 'IMAGE_UNREADABLE');
    throw error;
  }
  return {
    mediaType,
    bytes: input.bytes,
    sha256: createHash('sha256').update(input.bytes).digest('hex'),
    pages: pages ?? 1,
    quality,
  };
}

export interface FileAdded {
  fileId: string;
  batchId: string;
  status: 'UPLOADED' | 'REJECTED_QUALITY' | 'EXTRACTING' | 'EXTRACTED' | 'FAILED' | 'PURGED';
  /** True when the same file was already in the business's live files: nothing was stored. */
  duplicate: boolean;
  mediaType: string;
  pages: number;
  bytes: number;
  reasons: QualityReason[];
  expiresAt: Date;
}

const reasonsOf = (failureCode: string | null, status: string): QualityReason[] =>
  status === 'REJECTED_QUALITY' && failureCode ? (failureCode.split(',') as QualityReason[]) : [];

/** What a prepared file would become in a batch right now. */
export type Admission =
  | { kind: 'duplicate'; added: FileAdded }
  /** A poor image: stored as REJECTED_QUALITY with its reasons and NO object (privacy). */
  | { kind: 'rejected' }
  /** Good to keep: the caller writes the object, then `commitFile` records it. */
  | { kind: 'store' };

/**
 * Decides, from the rows `view` can see, what a prepared file would become in the OPEN batch of `branchId`, or throws why not.
 * In order: the batch is open; the same bytes already live in this branch return that file (`duplicate`), in another branch
 * they are refused without saying where; at most 20 files; a poor image is `rejected`; the business's stored bytes must fit
 * its plan. It takes no lock, so on a plain client it is the cheap look before the object is written (no object is written for
 * a file that would be refused); `commitFile` runs it again under the locks, where it is final.
 */
export async function admitFile(
  view: ScopedDb,
  args: { restaurantId: string; branchId: string; batchId: string; file: PreparedFile; now: Date },
): Promise<Admission> {
  const { file } = args;
  const batch = await view.phIntakeBatch.findFirst({ where: { id: args.batchId, branchId: args.branchId }, select: { id: true, status: true } });
  if (!batch) throw batchNotFound();
  if (batch.status !== 'OPEN') throw new StudioError('CONFLICT', 'Only an open batch can take files', { phCode: 'BATCH_NOT_OPEN' });

  const existing = await view.phIntakeFile.findFirst({
    where: { sha256: file.sha256 },
    select: { id: true, batchId: true, status: true, failureCode: true, mediaType: true, pages: true, bytes: true, expiresAt: true },
  });
  if (existing) {
    // Where it sits: a batch the actor's branches do not reach reads as "elsewhere" (the scoped client hides it).
    const home = await view.phIntakeBatch.findFirst({ where: { id: existing.batchId }, select: { branchId: true } });
    if (!home || home.branchId !== args.branchId) throw new StudioError('CONFLICT', 'This file was already uploaded', { phCode: 'DUPLICATE_FILE' });
    return {
      kind: 'duplicate',
      added: {
        fileId: existing.id,
        batchId: existing.batchId,
        status: existing.status,
        duplicate: true,
        mediaType: existing.mediaType,
        pages: existing.pages,
        bytes: existing.bytes,
        reasons: reasonsOf(existing.failureCode, existing.status),
        expiresAt: existing.expiresAt,
      },
    };
  }

  const inBatch = await view.phIntakeFile.count({ where: { batchId: args.batchId } });
  if (!STORAGE.filesFit(inBatch, 1)) {
    throw new StudioError('CONFLICT', 'A batch can hold at most 20 files', { phCode: 'TOO_MANY_FILES' });
  }
  if (!file.quality.ok) return { kind: 'rejected' };

  const used = await view.phIntakeFile.aggregate({ where: { storageKey: { not: null } }, _sum: { bytes: true } });
  const limits = await limitsOf(delegates(view), args.restaurantId, args.now);
  if (!limits || !STORAGE.fits(used._sum.bytes ?? 0, file.bytes.length, limits.storageMb)) {
    throw new StudioError('CONFLICT', 'This pharmacy’s file storage is full', { phCode: 'STORAGE_LIMIT' });
  }
  return { kind: 'store' };
}

/** A new file id, made before the object is written so the object's key is known first. */
export const newFileId = (): string => randomUUID();

/**
 * Records a prepared file in an OPEN batch of `branchId`: the short, locked step after the object (if any) was written. Under
 * the business's upload lock and the batch row it decides again (`admitFile`: another upload may have taken the hash slot, the
 * batch may have been cancelled, the plan's storage may have filled meanwhile) and inserts the row with the caller's `fileId`.
 * When it answers `duplicate` or throws, the object the caller wrote (`storageKey`) is the caller's to delete.
 */
export async function commitFile(
  tx: ScopedTx,
  args: { restaurantId: string; branchId: string; userId: string; batchId: string; file: PreparedFile; now: Date; fileId: string; storageKey: string | null },
): Promise<FileAdded> {
  const { file } = args;
  // eslint-disable-next-line no-restricted-properties -- an advisory lock touches no tenant rows: it only serialises one business's uploads (counts, bytes, the hash slot)
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NS_INTAKE_UPLOAD}::int, hashtext(${args.restaurantId}))`;
  // eslint-disable-next-line no-restricted-properties -- row lock on the batch (a parallel cancel waits on it); the branch is part of the match
  const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "PhIntakeBatch" WHERE "id" = ${args.batchId} AND "restaurantId" = ${args.restaurantId} AND "branchId" = ${args.branchId} FOR UPDATE`;
  if (locked.length === 0) throw batchNotFound();
  const admission = await admitFile(tx, args);
  if (admission.kind === 'duplicate') return admission.added;

  const expiresAt = new Date(args.now.getTime() + RETENTION_DAYS * DAY_MS);
  const common = { id: args.fileId, restaurantId: args.restaurantId, batchId: args.batchId, sha256: file.sha256, mediaType: file.mediaType, bytes: file.bytes.length, pages: file.pages, expiresAt, uploadedById: args.userId };
  if (admission.kind === 'rejected') {
    const reasons = file.quality.reasons;
    await tx.phIntakeFile.create({
      data: { ...common, status: 'REJECTED_QUALITY', failureCode: reasons.join(','), quality: { ...file.quality.metrics, reasons } },
      select: { id: true },
    });
    return { fileId: args.fileId, batchId: args.batchId, status: 'REJECTED_QUALITY', duplicate: false, mediaType: file.mediaType, pages: file.pages, bytes: file.bytes.length, reasons, expiresAt };
  }
  if (!args.storageKey) throw new Error('A file to keep needs its object written first');
  await tx.phIntakeFile.create({
    data: { ...common, storageKey: args.storageKey, quality: file.quality.metrics ? { ...file.quality.metrics } : {} },
    select: { id: true },
  });
  return { fileId: args.fileId, batchId: args.batchId, status: 'UPLOADED', duplicate: false, mediaType: file.mediaType, pages: file.pages, bytes: file.bytes.length, reasons: [], expiresAt };
}

// Seeing a file -------------------------------------------------------------------------------------------------------------

/** Longest life of a signed URL for a person looking at an invoice. */
export const SIGNED_URL_SECONDS = 300;

/**
 * A fresh signed URL for a stored file of a batch the actor's branches reach. Minted per request, never stored. A file of
 * another branch or business, a missing one, and one whose bytes are gone all read as `File not found`.
 */
export async function fileUrl(
  scoped: ScopedClient,
  storage: IntakeStorage,
  fileId: string,
): Promise<{ url: string; expiresInSeconds: number }> {
  const notFound = () => new StudioError('NOT_FOUND', 'File not found');
  const file = await scoped.phIntakeFile.findFirst({ where: { id: fileId }, select: { batchId: true, storageKey: true } });
  if (!file) throw notFound();
  const batch = await scoped.phIntakeBatch.findFirst({ where: { id: file.batchId }, select: { id: true } });
  if (!batch || !file.storageKey) throw notFound();
  return { url: await storage.signedUrl(file.storageKey, SIGNED_URL_SECONDS, { inline: true }), expiresInSeconds: SIGNED_URL_SECONDS };
}

// Letting go ---------------------------------------------------------------------------------------------------------------

/** The hash a released file keeps: it can no longer match an upload, so the live slot of its bytes is free again. */
export const rekeyedSha = (sha256: string, fileId: string): string => createHash('sha256').update(`${sha256}:${fileId}`).digest('hex');

/**
 * Lets go of a file's bytes (purge after retention, or a cancelled batch): deletes the object FIRST and only then blanks
 * `storageKey`, marks it PURGED, clears a failure code and an extraction lease (the CHECKs want both gone), and re-keys `sha256`
 * so the same bytes can be uploaded again. If the delete is refused this throws and nothing is changed, so a file is never
 * marked purged while its object lives on. The rows read from it stay. The caller holds the file row (inside a transaction).
 */
export async function releaseFileKey(
  tx: ScopedTx,
  storage: IntakeStorage,
  file: { id: string; sha256: string; storageKey: string | null },
): Promise<{ objectDeleted: boolean }> {
  if (file.storageKey) await storage.delete(file.storageKey);
  await tx.phIntakeFile.updateMany({
    where: { id: file.id },
    data: { storageKey: null, status: 'PURGED', sha256: rekeyedSha(file.sha256, file.id), failureCode: null, extractingSince: null },
  });
  return { objectDeleted: file.storageKey !== null };
}

/**
 * Purges up to `limit` files past their `expiresAt` across every business, one transaction each. Each file's row is locked and
 * looked at again first: one that is being extracted, already purged, or no longer due is left alone. A file whose object could
 * not be deleted stays as it was (the next run retries it) and is counted in `failed`; only its id is logged. Returns counts
 * only. Scheduling it is a launch step.
 */
export async function purgeExpiredIntakeFiles(
  everyone: Parameters<typeof scopedClient>[0],
  args: { now: Date; limit: number; storage: IntakeStorage },
): Promise<{ purged: number; objectsDeleted: number; failed: number }> {
  let purged = 0;
  let objectsDeleted = 0;
  let failed = 0;
  const businesses = await everyone.restaurant.findMany({
    where: { phIntakeFiles: { some: { expiresAt: { lte: args.now }, status: { notIn: ['PURGED', 'EXTRACTING'] } } } },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  for (const { id: restaurantId } of businesses) {
    if (purged + failed >= args.limit) break;
    const scoped = scopedClient(everyone, { restaurantId, allBranches: true });
    const due = await scoped.phIntakeFile.findMany({
      where: { expiresAt: { lte: args.now }, status: { notIn: ['PURGED', 'EXTRACTING'] } },
      select: { id: true },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      take: args.limit - purged - failed,
    });
    for (const { id } of due) {
      try {
        const released = await scoped.$transaction(async (tx) => {
          // eslint-disable-next-line no-restricted-properties -- row lock on the file: a parallel extraction or release waits on it
          await tx.$queryRaw`SELECT "id" FROM "PhIntakeFile" WHERE "id" = ${id} AND "restaurantId" = ${restaurantId} FOR UPDATE`;
          const file = await tx.phIntakeFile.findFirst({ where: { id }, select: { id: true, sha256: true, storageKey: true, status: true, expiresAt: true } });
          if (!file || file.status === 'PURGED' || file.status === 'EXTRACTING' || file.expiresAt > args.now) return null;
          return releaseFileKey(tx, args.storage, file);
        });
        if (released) {
          purged += 1;
          if (released.objectDeleted) objectsDeleted += 1;
        }
      } catch {
        failed += 1;
        console.error(`[intake] purge failed for file ${id}`);
      }
    }
  }
  return { purged, objectsDeleted, failed };
}
