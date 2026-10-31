import { listProposals, proposalListInput } from '@/server/pharmacy/assistant/proposals';
import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { assertStaff } from '@/server/pharmacy/receipts';
import { defineQuery } from '@/server/studio/framework/query';

/** The assistant's proposals (`ai.use`): those of the person's branches, readable while the pharmacy is read-only. */
export const proposals = defineQuery({
  name: 'ph.assistant.proposals',
  permission: null,
  ph: 'ai.use',
  allowReadOnly: true,
  input: proposalListInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    assertStaff(ph);
    return listProposals(scoped, ph, input);
  },
});
