import { controlledSettingsInput, setControlledSettings } from '@/server/pharmacy/controlled-settings';
import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { defineAction } from '@/server/studio/framework/action';

/**
 * The controlled-drug settings (phase 7, R7-1 and R7-4). `settings.manage` is the owner's: a branch manager cannot switch
 * controlled sales on. The audit carries the three values, before and after, and nothing else.
 */

export const set = defineAction({
  name: 'ph.settings.controlled.set',
  permission: null,
  ph: 'settings.manage',
  input: controlledSettingsInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    return ctx.transaction(async (tx) => {
      const { before, after } = await setControlledSettings(tx, input);
      ctx.audit({
        action: 'ph.settings.controlled.set',
        entityType: 'PhSettings',
        entityId: ctx.restaurantId ?? input.restaurantId,
        changes: {
          controlledEnabled: { before: before.controlledEnabled, after: after.controlledEnabled },
          controlledMaxQty: { before: before.controlledMaxQty, after: after.controlledMaxQty },
          rxRetentionDays: { before: before.rxRetentionDays, after: after.rxRetentionDays },
        },
      });
      return after;
    });
  },
});
