import { z } from 'zod';
import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { assertMayIntake, intakeClientKey } from '@/server/pharmacy/intake/files';
import {
  acknowledgeHeader,
  addRow,
  chooseMatch,
  clearMatch,
  fillFromBarcode,
  headerAckInput,
  headerPatchInput,
  matchChoiceInput,
  rematch,
  removeRow,
  reviewInput,
  reviewRow,
  rowPatchInput,
  scanBarcode,
  scanInput,
  updateHeader,
  updateRow,
} from '@/server/pharmacy/intake/review';
import { pharmacyOf } from '@/server/pharmacy/products';
import { defineAction } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';

/**
 * Invoice intake, review (R5-8..R5-10, R5-13, R5-14): every write here needs `purchase.manage` (the framework) AND `ai.use`
 * (`assertMayIntake`), in the validated place's branch. Flags, differences and acknowledgements are recomputed on the server
 * from what is stored; the input carries values to change, never a flag. Audit: ids, field names and flag codes.
 */

function branchOf(input: { branchId?: string }): string {
  if (!input.branchId) throw new StudioError('INVALID', 'Choose the branch', { branchId: 'Choose the branch' });
  return input.branchId;
}

const rowId = z.string().min(1).max(64);
/** Every write to a line or the header names the version the person saw (`VERSION_CONFLICT` when it is not the current one). */
const version = z.number().int().min(1);

export const rowUpdate = defineAction({
  name: 'ph.intake.row.update',
  permission: null,
  ph: 'purchase.manage',
  input: phPlaceInput.extend({ rowId, version, patch: rowPatchInput, clientKey: intakeClientKey }),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    assertMayIntake(ph);
    const branchId = branchOf(input);
    return ctx.transaction((tx) =>
      updateRow(tx, { restaurantId: ph.restaurantId, branchId, userId: ph.userId, rowId: input.rowId, version: input.version, patch: input.patch, clientKey: input.clientKey, now: new Date(), audit: (e) => ctx.audit(e) }),
    );
  },
});

export const rowMatch = defineAction({
  name: 'ph.intake.row.match',
  permission: null,
  ph: 'purchase.manage',
  input: phPlaceInput.extend(matchChoiceInput.shape),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    assertMayIntake(ph);
    const branchId = branchOf(input);
    return ctx.transaction((tx) =>
      chooseMatch(tx, { restaurantId: ph.restaurantId, branchId, rowId: input.rowId, version: input.version, productId: input.productId, unitId: input.unitId, now: new Date(), audit: (e) => ctx.audit(e) }),
    );
  },
});

export const rowClearMatch = defineAction({
  name: 'ph.intake.row.clearMatch',
  permission: null,
  ph: 'purchase.manage',
  input: phPlaceInput.extend({ rowId, version }),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    assertMayIntake(ph);
    const branchId = branchOf(input);
    return ctx.transaction((tx) => clearMatch(tx, { restaurantId: ph.restaurantId, branchId, rowId: input.rowId, version: input.version, now: new Date(), audit: (e) => ctx.audit(e) }));
  },
});

export const rowReview = defineAction({
  name: 'ph.intake.row.review',
  permission: null,
  ph: 'purchase.manage',
  input: phPlaceInput.extend(reviewInput.shape),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    assertMayIntake(ph);
    const branchId = branchOf(input);
    return ctx.transaction((tx) =>
      reviewRow(tx, { restaurantId: ph.restaurantId, branchId, rowId: input.rowId, version: input.version, shown: input.shown, note: input.note, mismatchReason: input.mismatchReason, now: new Date(), audit: (e) => ctx.audit(e) }),
    );
  },
});

export const rowFillFromBarcode = defineAction({
  name: 'ph.intake.row.fillFromBarcode',
  permission: null,
  ph: 'purchase.manage',
  input: phPlaceInput.extend({ rowId, version }),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    assertMayIntake(ph);
    const branchId = branchOf(input);
    return ctx.transaction((tx) => fillFromBarcode(tx, { restaurantId: ph.restaurantId, branchId, rowId: input.rowId, version: input.version, now: new Date(), audit: (e) => ctx.audit(e) }));
  },
});

export const intakeScan = defineAction({
  name: 'ph.intake.scan',
  permission: null,
  ph: 'purchase.manage',
  input: phPlaceInput.extend({ ...scanInput.shape, clientKey: intakeClientKey }),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    assertMayIntake(ph);
    const branchId = branchOf(input);
    return ctx.transaction((tx) => scanBarcode(tx, { restaurantId: ph.restaurantId, branchId, batchId: input.batchId, barcode: input.barcode, now: new Date(), audit: (e) => ctx.audit(e) }));
  },
});

export const rowAdd = defineAction({
  name: 'ph.intake.row.add',
  permission: null,
  ph: 'purchase.manage',
  input: phPlaceInput.extend({ fileId: z.string().min(1).max(64) }),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    assertMayIntake(ph);
    const branchId = branchOf(input);
    return ctx.transaction((tx) => addRow(tx, { restaurantId: ph.restaurantId, branchId, fileId: input.fileId, now: new Date(), audit: (e) => ctx.audit(e) }));
  },
});

export const rowRemove = defineAction({
  name: 'ph.intake.row.remove',
  permission: null,
  ph: 'purchase.manage',
  input: phPlaceInput.extend({ rowId, version }),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    assertMayIntake(ph);
    const branchId = branchOf(input);
    return ctx.transaction((tx) => removeRow(tx, { restaurantId: ph.restaurantId, branchId, rowId: input.rowId, version: input.version, now: new Date(), audit: (e) => ctx.audit(e) }));
  },
});

export const headerUpdate = defineAction({
  name: 'ph.intake.header.update',
  permission: null,
  ph: 'purchase.manage',
  input: phPlaceInput.extend({ batchId: z.string().min(1).max(64), version, patch: headerPatchInput }),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    assertMayIntake(ph);
    const branchId = branchOf(input);
    return ctx.transaction((tx) =>
      updateHeader(tx, { restaurantId: ph.restaurantId, branchId, batchId: input.batchId, version: input.version, patch: input.patch, now: new Date(), audit: (e) => ctx.audit(e) }),
    );
  },
});

export const headerAcknowledge = defineAction({
  name: 'ph.intake.header.acknowledge',
  permission: null,
  ph: 'purchase.manage',
  input: phPlaceInput.extend(headerAckInput.shape),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    assertMayIntake(ph);
    const branchId = branchOf(input);
    return ctx.transaction((tx) => acknowledgeHeader(tx, { restaurantId: ph.restaurantId, branchId, batchId: input.batchId, version: input.version, shown: input.shown, reason: input.reason, now: new Date(), audit: (e) => ctx.audit(e) }));
  },
});

export const rematchBatch = defineAction({
  name: 'ph.intake.rematch',
  permission: null,
  ph: 'purchase.manage',
  input: phPlaceInput.extend({ batchId: z.string().min(1).max(64) }),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    assertMayIntake(ph);
    const branchId = branchOf(input);
    return ctx.transaction((tx) => rematch(tx, { restaurantId: ph.restaurantId, branchId, batchId: input.batchId, now: new Date(), audit: (e) => ctx.audit(e) }));
  },
});
