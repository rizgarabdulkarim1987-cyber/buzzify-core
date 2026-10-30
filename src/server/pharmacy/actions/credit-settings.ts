import { creditSettingsInput, setCreditSettings } from '@/server/pharmacy/credit-settings';
import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { defineAction } from '@/server/studio/framework/action';

/** The credit switch (phase 7, R7-5): the owner's, like the controlled-drug settings. The audit carries the switch only. */
export const set = defineAction({
  name: 'ph.credit.settings.set',
  permission: null,
  ph: 'settings.manage',
  input: creditSettingsInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    return ctx.transaction(async (tx) => {
      const { before, after } = await setCreditSettings(tx, input);
      ctx.audit({
        action: 'ph.credit.settings.set',
        entityType: 'PhSettings',
        entityId: ctx.restaurantId ?? input.restaurantId,
        changes: { creditEnabled: { before: before.creditEnabled, after: after.creditEnabled } },
      });
      return after;
    });
  },
});
