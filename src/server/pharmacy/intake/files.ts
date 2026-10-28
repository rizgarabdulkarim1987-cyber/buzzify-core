import { createHash } from 'node:crypto';
import { z } from 'zod';
import { delegates, scopedClient, type ScopedClient, type ScopedTx } from '@/server/data/tenant-db';
import { countPdfPages, intakeFileAcceptable, STORAGE, type FileRefusal, type QualityReason } from '@/server/domain/pharmacy/intake';
import { limitsOf } from '@/server/domain/pharmacy/limits';
import { canPh } from '@/server/domain/pharmacy/permissions';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from '../actor';
import { assertStaff } from '../receipts';
import { NS_CLIENT_KEY } from '../suppliers';
import { ImageUnreadableError, assessQuality, type QualityAssessment } from './quality';
import { intakeKey, type IntakeStorage } from './storage';

/**
 * Invoice intake, step one (R5-4, R5-5, R5-6, R5-13): batches of uploaded supplier invoices, their private storage, the size
 * and type rules, the quality gate, de-duplication and the 30-day purge. Intake never writes stock. The services take the
 * transaction of the action that calls them; the actions audit ids and counts only (never the file, its text or its name).
 *
 * Lock order of this phase (header comment of every service that locks): client key (advisory, namespace 7201) -> the
 * business's upload lock (advisory, namespace 7210, `hashtext(restaurantId)`: file count, stored bytes and the SHA-256 slot are
 * counted under it) -> the batch row FOR UPDATE -> (later tasks: file rows, then the budget row). `releaseFileKey` takes no lock of
 * its own: the caller holds the file row.
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
  status: 'OPEN';
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
    return { id: earlier.id, status: 'OPEN', branchId: earlier.branchId, supplierId: earlier.supplierId, replayed: true };
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

/**
 * Checks one upload against the per-file rules (the type is the one the bytes really have, never the header's word), hashes
 * it and measures an image's quality. Pure CPU, no database: the action does it before it opens the transaction, so the
 * business's upload lock is not held while an image decodes.
 */
export async function prepareFile(input: { mediaType: string; bytes: Uint8Array }): Promise<PreparedFile> {
  const pages = input.mediaType === 'application/pdf' ? countPdfPages(input.bytes) : null;
  const verdict = intakeFileAcceptable({ mediaType: input.mediaType, bytes: input.bytes, pages });
  if (!verdict.ok) {
    const [message, phCode] = REFUSALS[verdict.reason];
    throw refusal(message, phCode);
  }
  let quality: QualityAssessment;
  try {
    quality = await assessQuality(input.bytes, input.mediaType);
  } catch (error) {
    if (error instanceof ImageUnreadableError) throw refusal('The image could not be read', 'IMAGE_UNREADABLE');
    throw error;
  }
  return {
    mediaType: input.mediaType,
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

/**
 * Puts a prepared file into an OPEN batch of `branchId`. In order, under the business's upload lock and the batch row: the
 * same bytes already live in this branch return that file (`duplicate`); in another branch they are refused without saying
 * where; at most 20 files; a poor image is stored as REJECTED_QUALITY with its reasons and NO object (privacy); the business's
 * stored bytes must fit its plan; then the object is written privately and the row points at it.
 */
export async function addFile(
  tx: ScopedTx,
  storage: IntakeStorage,
  args: { restaurantId: string; branchId: string; userId: string; batchId: string; file: PreparedFile; now: Date },
): Promise<FileAdded> {
  const { file } = args;
  // eslint-disable-next-line no-restricted-properties -- an advisory lock touches no tenant rows: it only serialises one business's uploads (counts, bytes, the hash slot)
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NS_INTAKE_UPLOAD}::int, hashtext(${args.restaurantId}))`;
  // eslint-disable-next-line no-restricted-properties -- row lock on the batch (a parallel cancel waits on it); the branch is part of the match
  const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "PhIntakeBatch" WHERE "id" = ${args.batchId} AND "restaurantId" = ${args.restaurantId} AND "branchId" = ${args.branchId} FOR UPDATE`;
  const batch = locked.length === 0 ? null : await tx.phIntakeBatch.findFirst({ where: { id: args.batchId }, select: { id: true, status: true } });
  if (!batch) throw batchNotFound();
  if (batch.status !== 'OPEN') throw new StudioError('CONFLICT', 'Only an open batch can take files', { phCode: 'BATCH_NOT_OPEN' });

  const existing = await tx.phIntakeFile.findFirst({
    where: { sha256: file.sha256 },
    select: { id: true, batchId: true, status: true, failureCode: true, mediaType: true, pages: true, bytes: true, expiresAt: true },
  });
  if (existing) {
    // Where it sits: a batch the actor's branches do not reach reads as "elsewhere" (the scoped client hides it).
    const home = await tx.phIntakeBatch.findFirst({ where: { id: existing.batchId }, select: { branchId: true } });
    if (!home || home.branchId !== args.branchId) throw new StudioError('CONFLICT', 'This file was already uploaded', { phCode: 'DUPLICATE_FILE' });
    return {
      fileId: existing.id,
      batchId: existing.batchId,
      status: existing.status,
      duplicate: true,
      mediaType: existing.mediaType,
      pages: existing.pages,
      bytes: existing.bytes,
      reasons: reasonsOf(existing.failureCode, existing.status),
      expiresAt: existing.expiresAt,
    };
  }

  const inBatch = await tx.phIntakeFile.count({ where: { batchId: args.batchId } });
  if (!STORAGE.filesFit(inBatch, 1)) {
    throw new StudioError('CONFLICT', 'A batch can hold at most 20 files', { phCode: 'TOO_MANY_FILES' });
  }

  const expiresAt = new Date(args.now.getTime() + RETENTION_DAYS * DAY_MS);
  const common = { restaurantId: args.restaurantId, batchId: args.batchId, sha256: file.sha256, mediaType: file.mediaType, bytes: file.bytes.length, pages: file.pages, expiresAt, uploadedById: args.userId };

  if (!file.quality.ok) {
    const rejected = await tx.phIntakeFile.create({
      data: { ...common, status: 'REJECTED_QUALITY', failureCode: file.quality.reasons.join(','), quality: { ...file.quality.metrics, reasons: file.quality.reasons } },
      select: { id: true },
    });
    return { fileId: rejected.id, batchId: args.batchId, status: 'REJECTED_QUALITY', duplicate: false, mediaType: file.mediaType, pages: file.pages, bytes: file.bytes.length, reasons: file.quality.reasons, expiresAt };
  }

  const used = await tx.phIntakeFile.aggregate({ where: { storageKey: { not: null } }, _sum: { bytes: true } });
  const limits = await limitsOf(delegates(tx), args.restaurantId, args.now);
  if (!limits || !STORAGE.fits(used._sum.bytes ?? 0, file.bytes.length, limits.storageMb)) {
    throw new StudioError('CONFLICT', 'This pharmacy’s file storage is full', { phCode: 'STORAGE_LIMIT' });
  }

  const created = await tx.phIntakeFile.create({
    data: { ...common, quality: file.quality.metrics ? { ...file.quality.metrics } : {} },
    select: { id: true },
  });
  const storageKey = intakeKey(args.restaurantId, created.id);
  try {
    await storage.put(storageKey, file.bytes, file.mediaType);
    await tx.phIntakeFile.updateMany({ where: { id: created.id }, data: { storageKey } });
  } catch (error) {
    // The transaction rolls back; do not leave the object behind.
    await storage.delete(storageKey).catch(() => undefined);
    throw error;
  }
  return { fileId: created.id, batchId: args.batchId, status: 'UPLOADED', duplicate: false, mediaType: file.mediaType, pages: file.pages, bytes: file.bytes.length, reasons: [], expiresAt };
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
  return { url: await storage.signedUrl(file.storageKey, SIGNED_URL_SECONDS), expiresInSeconds: SIGNED_URL_SECONDS };
}

// Letting go ---------------------------------------------------------------------------------------------------------------

/** The hash a released file keeps: it can no longer match an upload, so the live slot of its bytes is free again. */
export const rekeyedSha = (sha256: string, fileId: string): string => createHash('sha256').update(`${sha256}:${fileId}`).digest('hex');

/**
 * Lets go of a file's bytes (purge after retention, or a cancelled batch): deletes the object, blanks `storageKey`, marks it
 * PURGED, clears a failure code and an extraction lease (the CHECKs want both gone), and re-keys `sha256` so the same bytes can
 * be uploaded again. The rows read from it stay. The caller holds the file row (inside a transaction).
 */
export async function releaseFileKey(
  tx: ScopedTx,
  storage: IntakeStorage,
  file: { id: string; sha256: string; storageKey: string | null },
): Promise<{ objectDeleted: boolean }> {
  await tx.phIntakeFile.updateMany({
    where: { id: file.id },
    data: { storageKey: null, status: 'PURGED', sha256: rekeyedSha(file.sha256, file.id), failureCode: null, extractingSince: null },
  });
  if (file.storageKey) await storage.delete(file.storageKey);
  return { objectDeleted: file.storageKey !== null };
}

/**
 * Purges up to `limit` files past their `expiresAt` across every business, one transaction each (so one failure leaves the
 * others done and is retried by the next run). Returns counts only. Scheduling it is a launch step.
 */
export async function purgeExpiredIntakeFiles(
  everyone: Parameters<typeof scopedClient>[0],
  args: { now: Date; limit: number; storage: IntakeStorage },
): Promise<{ purged: number; objectsDeleted: number }> {
  let purged = 0;
  let objectsDeleted = 0;
  const businesses = await everyone.restaurant.findMany({
    where: { phIntakeFiles: { some: { expiresAt: { lte: args.now }, status: { not: 'PURGED' } } } },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  for (const { id: restaurantId } of businesses) {
    if (purged >= args.limit) break;
    const scoped = scopedClient(everyone, { restaurantId, allBranches: true });
    const due = await scoped.phIntakeFile.findMany({
      where: { expiresAt: { lte: args.now }, status: { not: 'PURGED' } },
      select: { id: true, sha256: true, storageKey: true },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      take: args.limit - purged,
    });
    for (const file of due) {
      const released = await scoped.$transaction((tx) => releaseFileKey(tx, args.storage, file));
      purged += 1;
      if (released.objectDeleted) objectsDeleted += 1;
    }
  }
  return { purged, objectsDeleted };
}
