import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { attachmentIdInput, readAttachment, rxStorage } from '@/server/pharmacy/prescriptions';
import { auditAttachmentRead } from '@/server/pharmacy/rx-audit';
import { getPrescription, listPrescriptions, listRegister, prescriptionGetInput, prescriptionListInput, registerListInput } from '@/server/pharmacy/prescription-reads';
import { pharmacyOf } from '@/server/pharmacy/products';
import { defineQuery } from '@/server/studio/framework/query';

/**
 * Reading prescriptions, the controlled register and a prescription's file (phase 7). The patient and prescriber fields need
 * `rx.dispense`; a file's bytes need `rx.attachment.view` on every read, which is audited by count (file id and size, never a
 * name). A support actor holds neither permission, so the framework refuses it before any of this runs.
 */

export const list = defineQuery({
  name: 'ph.rx.list',
  permission: null,
  ph: 'rx.dispense',
  input: prescriptionListInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    return listPrescriptions(scoped, ph, input, input.branchId);
  },
});

export const get = defineQuery({
  name: 'ph.rx.get',
  permission: null,
  ph: 'rx.dispense',
  input: prescriptionGetInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    return getPrescription(scoped, ph, input);
  },
});

/** The controlled register, newest first. */
export const register = defineQuery({
  name: 'ph.rx.register',
  permission: null,
  ph: 'rx.dispense',
  input: registerListInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { scoped } = pharmacyOf(ctx);
    return listRegister(scoped, input, input.branchId);
  },
});

/** One file's bytes as base64, for the attachment route. Open while the pharmacy is read-only (reading is not writing). */
export const attachmentRead = defineQuery({
  name: 'ph.rx.attachment.read',
  permission: null,
  ph: 'rx.attachment.view',
  allowReadOnly: true,
  input: attachmentIdInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    const file = await readAttachment(scoped, ph, rxStorage(), input.id);
    await auditAttachmentRead(ctx.db, ph, file);
    return { id: file.id, mime: file.mime, sizeBytes: file.sizeBytes, base64: Buffer.from(file.bytes).toString('base64') };
  },
});
