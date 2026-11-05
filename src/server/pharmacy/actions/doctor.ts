import { z } from 'zod';
import { DOCTOR_DISCLAIMER_KEY } from '@/server/domain/pharmacy/doctor';
import { MAX_PHOTO_BASE64_CHARS, PHOTO_MIMES } from '@/server/pharmacy/doctor/doctor-ai';
import { askDoctor, type DoctorResponse } from '@/server/pharmacy/doctor/service';
import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { defineAction } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';

/**
 * `ph.doctor.ask` (plan Task 6): one AI Doctor question, a complaint, a medicine name or a photo of a box or strip.
 *
 * Who: the framework needs `ai.use` in a pharmacy that is open (not read-only: a question spends the AI budget) and a branch of
 * the person's own; the service then applies the Doctor's own rule (`doctorAccess`: the plan's AI budget, the owner or the staff
 * switch), so a person the screen hides the Doctor from is refused here too, whatever they send. No open shift and no report
 * permission are needed: it is a clinical helper, not a till.
 *
 * What is kept: one `PhDoctorLog` row (see the service) written in the same transaction as the audit entry, which holds codes and
 * counts only, never the question or the answer. The disclaimer is the app's own line (its message key), never model text.
 */

const AGE = 'Enter an age from 0 to 130';

// The branch stays optional in the schema so that a pharmacy or branch that is not the person's is refused by the framework
// (FORBIDDEN) before the input's other rules are read; the handler then asks for one (stock is a branch's).
const place = phPlaceInput;

const askInput = z.discriminatedUnion('mode', [
  place.extend({
    mode: z.literal('COMPLAINT'),
    text: z.string().trim().min(1, 'Enter a question').max(1000, 'Enter a question of up to 1000 characters'),
    ageYears: z.number(AGE).min(0, AGE).max(130, AGE).optional(),
    sex: z.enum(['F', 'M']).optional(),
    pregnant: z.boolean().optional(),
  }),
  place.extend({
    mode: z.literal('MEDICINE_NAME'),
    text: z.string().trim().min(1, 'Enter the medicine name').max(200, 'Use at most 200 characters'),
  }),
  place.extend({
    mode: z.literal('MEDICINE_PHOTO'),
    imageBase64: z.string().min(1, 'Add a photo of the box or strip').max(MAX_PHOTO_BASE64_CHARS, 'The photo is too large'),
    mime: z.enum(PHOTO_MIMES, 'Use a JPEG, PNG or WebP photo'),
  }),
]);

export const askAction = defineAction({
  name: 'ph.doctor.ask',
  permission: null,
  ph: 'ai.use',
  input: askInput,
  target: phTargetOf,
  async run(ctx, input): Promise<DoctorResponse> {
    const { ph, scoped } = pharmacyOf(ctx);
    const { restaurantId: _restaurant, branchId, ...question } = input;
    void _restaurant;
    if (!branchId) throw new StudioError('INVALID', 'Choose the branch', { branchId: 'Choose the branch' });
    const result = await askDoctor(
      {
        db: ctx.db,
        scoped,
        ph,
        now: new Date(),
        record: (row) =>
          ctx.transaction(async (tx) => {
            const made = await tx.phDoctorLog.create({ data: row, select: { id: true } });
            ctx.audit({
              action: 'ph.doctor.ask',
              entityType: 'PhDoctorLog',
              entityId: made.id,
              changes: {
                mode: { before: null, after: row.mode },
                outcome: { before: null, after: row.outcome },
                branchId: { before: null, after: row.branchId },
                model: { before: null, after: row.model },
                inputTokens: { before: null, after: row.inputTokens },
                outputTokens: { before: null, after: row.outputTokens },
              },
            });
          }),
      },
      { ...question, branchId },
    );
    return { ...result, disclaimerKey: DOCTOR_DISCLAIMER_KEY };
  },
});
