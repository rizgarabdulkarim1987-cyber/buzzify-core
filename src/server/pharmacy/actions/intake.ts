import { z } from 'zod';
import { INTAKE_LIMITS } from '@/server/domain/pharmacy/intake';
import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { admitFile, assertMayIntake, commitFile, createBatch as makeBatch, intakeClientKey, newFileId, prepareFile } from '@/server/pharmacy/intake/files';
import { getIntakeStorage, intakeKey, IntakeStorageNotConfiguredError, type IntakeStorage } from '@/server/pharmacy/intake/storage';
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
    // No repeat token: the same bytes are answered by their SHA-256 (the same file twice is one file).
    /** What the browser said. Ignored: the type is read from the bytes. Kept so older callers still validate. */
    mediaType: z.string().trim().max(100).optional(),
    base64: z.string().min(1).max(MAX_BASE64_LENGTH),
  }),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    assertMayIntake(ph);
    const branchId = branchOf(input);
    const storage = storageOrRefuse();
    // Type (from the bytes), size, pages, hash and image quality are settled first: decoding an image takes a moment.
    const bytes = Buffer.from(input.base64, 'base64');
    const file = await prepareFile({ bytes });
    const place = { restaurantId: ph.restaurantId, branchId, batchId: input.batchId, file, now: new Date() };
    // A look without locks: a refused file, or one already stored, never causes an object to be written.
    const look = await admitFile(scoped, place);
    if (look.kind === 'duplicate') return look.added;

    // The object goes in BEFORE and OUTSIDE any transaction or lock (a slow store must not hold the business's uploads
    // up); a short locked transaction then decides again and records the row. If that fails or loses, the object is removed.
    const fileId = newFileId();
    const storageKey = look.kind === 'store' ? intakeKey(ph.restaurantId, fileId) : null;
    if (storageKey) await storage.put(storageKey, file.bytes, file.mediaType);
    const discard = async () => {
      if (!storageKey) return;
      try {
        await storage.delete(storageKey);
      } catch {
        // Best effort. Only the file id is logged: an orphan is found by it, and nothing else about it is revealed.
        console.error(`[intake] could not remove the object of upload ${fileId}`);
      }
    };
    let done;
    try {
      done = await ctx.transaction(async (tx) => {
        const added = await commitFile(tx, { ...place, userId: ph.userId, fileId, storageKey });
        if (!added.duplicate) {
          ctx.audit({
            action: 'ph.intake.file.add',
            entityType: 'PhIntakeFile',
            entityId: added.fileId,
            changes: {
              status: { before: null, after: added.status },
              batchId: { before: null, after: added.batchId },
              mediaType: { before: null, after: added.mediaType },
              bytes: { before: null, after: added.bytes },
              pages: { before: null, after: added.pages },
            },
          });
        }
        return added;
      });
    } catch (error) {
      await discard();
      throw error;
    }
    // Another upload of the same bytes took the slot while this one wrote its object: theirs stays, ours goes.
    if (done.duplicate) await discard();
    return done;
  },
});
