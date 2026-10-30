import { z } from 'zod';
import { creditListInput, getCreditNote, listCreditNotes } from '@/server/pharmacy/credit-notes';
import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { assertStaff } from '@/server/pharmacy/receipts';
import { defineQuery } from '@/server/studio/framework/query';

/**
 * Reading supplier credit notes (`purchase.manage`, R4-9). Credit notes belong to the business, so any branch of it sees them
 * all. Amounts appear only for a role with `cost.view`. A support actor reads none.
 */

export const list = defineQuery({
  name: 'ph.credits.list',
  permission: null,
  ph: 'purchase.manage',
  input: creditListInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    assertStaff(ph);
    return listCreditNotes(scoped, ph, input);
  },
});

export const get = defineQuery({
  name: 'ph.credits.get',
  permission: null,
  ph: 'purchase.manage',
  input: phPlaceInput.extend({ creditNoteId: z.string().min(1).max(64) }),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    assertStaff(ph);
    return getCreditNote(scoped, ph, input.creditNoteId);
  },
});
