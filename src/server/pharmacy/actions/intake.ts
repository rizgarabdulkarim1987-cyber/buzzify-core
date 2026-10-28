import { z } from 'zod';
import { INTAKE_LIMITS } from '@/server/domain/pharmacy/intake';
import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { addFile as storeFile, assertMayIntake, createBatch as makeBatch, intakeClientKey, prepareFile } from '@/server/pharmacy/intake/files';
import { getIntakeStorage, IntakeStorageNotConfiguredError, type IntakeStorage } from '@/server/pharmacy/intake/storage';
import { pharmacyOf } from '@/server/pharmacy/products';
import { defineAction } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';

/**
 * Invoice intake, uploads (R5-4..R5-6, R5-14): starting a batch and putting files into it need `purchase.manage` (checked by
 * the framework) AND `ai.use` (checked here, the framework's `ph` field takes one permission), in the validated place's branch.
 * The audit rows carry ids, status, byte and page counts: never the file, its text, its name or its hash.
 */

const isUnique = (error: unknown) => (error as { code?: unknown } | null)?.code === 'P2002';

function branchOf(input: { branchId?: string }): string {
  if (!input.branchId) throw new StudioError('INVALID', 'Choose the branch', { branchId: 'Choose the branch' });
  return input.branchId;
}

/** The most base64 text a file of the largest accepted size plus one byte (so `TOO_LARGE` is answered by the service) takes. */
const MAX_BASE64_LENGTH = Math.ceil((INTAKE_LIMITS.maxBytes + 1) / 3) * 4;

/** The private storage, or the typed state when production has none (upload is then off, never a fallback). */
function storageOrRefuse(): IntakeStorage {
  try {
    return getIntakeStorage();
  } catch (error) {
    if (error instanceof IntakeStorageNotConfiguredError) {
      throw new StudioError('CONFLICT', 'Invoice upload is not set up yet', { phCode: error.code });
    }
    throw error;
  }
}

export const createBatch = defineAction({
  name: 'ph.intake.batch.create',
  permission: null,
  ph: 'purchase.manage',
  input: phPlaceInput.extend({ clientKey: intakeClientKey, supplierId: z.string().min(1).max(64).optional() }),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    assertMayIntake(ph);
    const branchId = branchOf(input);
    const attempt = () =>
      ctx.transaction(async (tx) => {
        const made = await makeBatch(tx, { restaurantId: ph.restaurantId, branchId, userId: ph.userId, clientKey: input.clientKey, supplierId: input.supplierId });
        if (!made.replayed) {
          ctx.audit({
            action: 'ph.intake.batch.create',
            entityType: 'PhIntakeBatch',
            entityId: made.id,
            changes: {
              status: { before: null, after: 'OPEN' },
              branchId: { before: null, after: branchId },
              ...(made.supplierId ? { supplierId: { before: null, after: made.supplierId } } : {}),
            },
          });
        }
        return made;
      });
    try {
      return await attempt();
    } catch (error) {
      if (!isUnique(error)) throw error;
      // Two creates with one key at once: the database kept one. Run again: it is found, compared and returned.
      try {
        return await attempt();
      } catch (again) {
        if (!isUnique(again)) throw again;
        throw new StudioError('CONFLICT', 'This key was already used', { phCode: 'CLIENT_KEY_USED' });
      }
    }
  },
});

export const addFile = defineAction({
  name: 'ph.intake.file.add',
  permission: null,
  ph: 'purchase.manage',
  input: phPlaceInput.extend({
    batchId: z.string().min(1).max(64),
    /** The repeat token of the upload; the same bytes are answered by their SHA-256 (the same file twice is one file). */
    clientKey: intakeClientKey,
    mediaType: z.string().trim().min(1).max(100),
    base64: z.string().min(1).max(MAX_BASE64_LENGTH),
  }),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    assertMayIntake(ph);
    const branchId = branchOf(input);
    const storage = storageOrRefuse();
    // Type, size, pages, hash and image quality are settled before the transaction: decoding an image takes a moment.
    const file = await prepareFile({ mediaType: input.mediaType, bytes: Buffer.from(input.base64, 'base64') });
    const attempt = () =>
      ctx.transaction(async (tx) => {
        const done = await storeFile(tx, storage, { restaurantId: ph.restaurantId, branchId, userId: ph.userId, batchId: input.batchId, file, now: new Date() });
        if (!done.duplicate) {
          ctx.audit({
            action: 'ph.intake.file.add',
            entityType: 'PhIntakeFile',
            entityId: done.fileId,
            changes: {
              status: { before: null, after: done.status },
              batchId: { before: null, after: done.batchId },
              mediaType: { before: null, after: done.mediaType },
              bytes: { before: null, after: done.bytes },
              pages: { before: null, after: done.pages },
            },
          });
        }
        return done;
      });
    try {
      return await attempt();
    } catch (error) {
      if (!isUnique(error)) throw error;
      // The same bytes won the hash slot in a racing upload: run again, it is found and returned.
      return attempt();
    }
  },
});
