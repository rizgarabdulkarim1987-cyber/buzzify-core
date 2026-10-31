import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { currentShift, listShifts, shiftListInput, shiftReport, shiftReportInput } from '@/server/pharmacy/shifts-reads';
import { defineQuery } from '@/server/studio/framework/query';
import { z } from 'zod';

/**
 * Reading shifts. `current` is for the people who hold a shift (`shift.use`). `report` and `list` need one permission at
 * the framework (`catalog.view`, every pharmacy role); the service then narrows: `report.view` reads every shift of the
 * branches, `shift.use` alone the person's own, any other role none.
 */

export const current = defineQuery({
  name: 'ph.shifts.current',
  permission: null,
  ph: 'shift.use',
  input: z.object({}).extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    return currentShift(scoped, ph, input);
  },
});

export const report = defineQuery({
  name: 'ph.shifts.report',
  permission: null,
  ph: 'catalog.view',
  input: shiftReportInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    return shiftReport(scoped, ph, input);
  },
});

export const list = defineQuery({
  name: 'ph.shifts.list',
  permission: null,
  ph: 'catalog.view',
  input: shiftListInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    return listShifts(scoped, ph, input);
  },
});
