import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { setDoctorInput, setStaffDoctor } from '@/server/pharmacy/staff-doctor';
import { defineAction } from '@/server/studio/framework/action';

/**
 * `ph.staff.setDoctor` (plan Task 9): one person's AI Doctor switch. The framework needs `staff.manage`; the service then lets
 * the OWNER only (ruling 1) and only for a role with `ai.use`. The audit, in the same transaction, carries `aiDoctor` before and
 * after and nothing else.
 */
export const setDoctor = defineAction({
  name: 'ph.staff.setDoctor',
  permission: null,
  ph: 'staff.manage',
  input: setDoctorInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    return ctx.transaction(async (tx) => {
      const { before, after } = await setStaffDoctor(tx, ph, { staffId: input.staffId, on: input.on });
      ctx.audit({ action: 'ph.staff.setDoctor', entityType: 'PhStaff', entityId: input.staffId, changes: { aiDoctor: { before, after } } });
      return { staffId: input.staffId, aiDoctor: after };
    });
  },
});
