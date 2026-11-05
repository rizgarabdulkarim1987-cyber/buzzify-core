import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { assertStaff } from '@/server/pharmacy/receipts';
import { defineQuery } from '@/server/studio/framework/query';

/** How many earlier questions the Doctor page lists. */
const DOCTOR_HISTORY_LIMIT = 30;

/**
 * `ph.doctor.history`: the AI Doctor page's "earlier questions". A person sees their own last 30 requests; the OWNER sees
 * everyone's in the pharmacy (the spec: the log is the owner's to review). Reads go through the branch-scoped client, so a
 * branch-limited person never sees another branch's rows and nobody sees another business's; the chosen branch narrows it
 * further. Only the stored question text (none for a photo), the mode, the outcome and the time are returned: never the
 * answer, the model, the tokens or who asked. Needs `ai.use`; readable while the pharmacy is read-only.
 */
export const history = defineQuery({
  name: 'ph.doctor.history',
  permission: null,
  ph: 'ai.use',
  allowReadOnly: true,
  input: phPlaceInput,
  target: phTargetOf,
  async run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    assertStaff(ph);
    const owner = ph.role === 'OWNER';
    const rows = await scoped.phDoctorLog.findMany({
      where: { ...(owner ? {} : { staffId: ph.userId }), ...(input.branchId ? { branchId: input.branchId } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: DOCTOR_HISTORY_LIMIT,
      select: { id: true, mode: true, questionText: true, outcome: true, createdAt: true, staffId: true },
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        mode: r.mode as 'COMPLAINT' | 'MEDICINE_NAME' | 'MEDICINE_PHOTO',
        questionText: r.questionText,
        outcome: r.outcome as 'ANSWERED' | 'REFUSED' | 'FAILED',
        createdAt: r.createdAt,
        mine: r.staffId === ph.userId,
      })),
    };
  },
});
