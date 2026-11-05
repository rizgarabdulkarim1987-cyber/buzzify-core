import { limitsOf } from '@/server/domain/pharmacy/limits';
import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { staffDoctorList } from '@/server/pharmacy/staff-doctor';
import { defineQuery } from '@/server/studio/framework/query';

/**
 * `ph.staff.list` (plan Task 9): the people of the pharmacy with their role, branches and AI Doctor switch, for the staff screen.
 * Needs `staff.manage`; a branch-limited manager sees the people of their own branches only, and only the owner may edit
 * (`canEdit`). Readable while the pharmacy is read-only. A name, never an email.
 */
export const list = defineQuery({
  name: 'ph.staff.list',
  permission: null,
  ph: 'staff.manage',
  allowReadOnly: true,
  input: phPlaceInput,
  target: phTargetOf,
  async run(ctx) {
    const { ph, scoped } = pharmacyOf(ctx);
    const limits = await limitsOf(ctx.db, ph.restaurantId, new Date());
    return staffDoctorList(scoped, ph, (limits?.aiMonthlyBudgetMinor ?? 0) > 0);
  },
});
