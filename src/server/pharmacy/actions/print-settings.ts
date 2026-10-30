import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { printSettingsInput, setPrintSettings } from '@/server/pharmacy/print-settings';
import { defineAction } from '@/server/studio/framework/action';

/** One workstation's printing settings (phase 7, R7-8): the owner's, like the other settings. The audit carries the name and the values. */
export const set = defineAction({
  name: 'ph.print.settings.set',
  permission: null,
  ph: 'settings.manage',
  input: printSettingsInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    return ctx.transaction(async (tx) => {
      const { before, after } = await setPrintSettings(tx, input);
      ctx.audit({
        action: 'ph.print.settings.set',
        entityType: 'PhSettings',
        entityId: ctx.restaurantId ?? input.restaurantId,
        changes: {
          workstation: { before: null, after: input.workstation },
          settings: { before: before.print.workstations[input.workstation] ?? null, after: after.print.workstations[input.workstation] ?? null },
        },
      });
      return after;
    });
  },
});
