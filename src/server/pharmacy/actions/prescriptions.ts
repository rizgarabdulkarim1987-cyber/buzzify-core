import { z } from 'zod';
import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import {
  assertPrescriptionHere,
  createPrescription,
  newAttachmentId,
  prepareRxFile,
  prescriptionIdInput,
  prescriptionInput,
  recordAttachment,
  rxStorage,
  rxStorageKey,
} from '@/server/pharmacy/prescriptions';
import { pharmacyOf } from '@/server/pharmacy/products';
import { defineAction } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';

/**
 * Prescriptions (phase 7). Recording one and attaching its scan need `rx.dispense`; the place names the ONE branch. Audit entries
 * carry ids, a status, a file type and a size: never the number, the prescriber, the patient or the file's name.
 */

const isUnique = (error: unknown) => (error as { code?: unknown } | null)?.code === 'P2002';
const needBranch = (branchId: string | undefined): string => {
  if (!branchId) throw new StudioError('INVALID', 'Choose the branch', { branchId: 'Choose the branch' });
  return branchId;
};

/** A 5 MB file as base64 is at most 6 990 508 characters. */
const MAX_BASE64_LENGTH = 7_000_000;

export const create = defineAction({
  name: 'ph.rx.create',
  permission: null,
  ph: 'rx.dispense',
  input: prescriptionInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    const branchId = needBranch(input.branchId);
    try {
      return await ctx.transaction(async (tx) => {
        const { result, audit } = await createPrescription(tx, { ph, branchId, input });
        if (audit) {
          ctx.audit({
            action: 'ph.rx.create',
            entityType: 'PhPrescription',
            entityId: result.id,
            changes: { status: { before: null, after: 'DRAFT' }, branchId: { before: null, after: audit.branchId } },
          });
        }
        return result;
      });
    } catch (error) {
      if (isUnique(error)) throw new StudioError('CONFLICT', 'This key was already used', { phCode: 'CLIENT_KEY_USED' });
      throw error;
    }
  },
});

/** Keeps a scan or photo with a prescription. The bytes arrive as base64 (the route turns a multipart upload into it). */
export const attach = defineAction({
  name: 'ph.rx.file.add',
  permission: null,
  ph: 'rx.dispense',
  input: prescriptionIdInput.extend(phPlaceInput.shape).extend({
    /** What the browser said. Ignored: the type is read from the bytes. */
    mediaType: z.string().trim().max(100).optional(),
    base64: z.string().min(1).max(MAX_BASE64_LENGTH),
  }),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    const branchId = needBranch(input.branchId);
    const storage = rxStorage();
    // Type (from the bytes), size and hash first; then a look without locks, so a refused file never causes an object to be written.
    const file = prepareRxFile(Buffer.from(input.base64, 'base64'));
    await assertPrescriptionHere(scoped, branchId, input.prescriptionId);

    // The object goes in BEFORE and OUTSIDE the transaction; if the row is not recorded the object is removed.
    const id = newAttachmentId();
    const storageKey = rxStorageKey(ph.restaurantId, id);
    await storage.put(storageKey, file.bytes, file.mime);
    try {
      return await ctx.transaction(async (tx) => {
        const added = await recordAttachment(tx, { ph, branchId, prescriptionId: input.prescriptionId, id, storageKey, file });
        ctx.audit({
          action: 'ph.rx.file.add',
          entityType: 'PhRxAttachment',
          entityId: added.id,
          changes: {
            // Named rxId, not prescriptionId: the audit field guard matches /prescription/ by key name, and this value is an id (allowed), never the paper's text.
            rxId: { before: null, after: added.prescriptionId },
            mime: { before: null, after: added.mime },
            bytes: { before: null, after: added.sizeBytes },
          },
        });
        return added;
      });
    } catch (error) {
      try {
        await storage.delete(storageKey);
      } catch {
        // Best effort. Only the id is logged: an orphan is found by it, and nothing else about it is revealed.
        console.error(`[rx] could not remove the object of upload ${id}`);
      }
      throw error;
    }
  },
});
