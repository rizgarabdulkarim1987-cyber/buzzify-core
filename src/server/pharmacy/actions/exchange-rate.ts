import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { exchangeRateInput, setExchangeRate } from '@/server/pharmacy/exchange-rate';
import { defineAction } from '@/server/studio/framework/action';

/** The display-only USD exchange rate: the owner's, like the other settings. The audit carries the rate only. */
export const set = defineAction({
  name: 'ph.exchangeRate.set',
  permission: null,
  ph: 'settings.manage',
  input: exchangeRateInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    return ctx.transaction(async (tx) => {
      const { before, after } = await setExchangeRate(tx, input);
      ctx.audit({
        action: 'ph.exchangeRate.set',
        entityType: 'PhSettings',
        entityId: ctx.restaurantId ?? input.restaurantId,
        changes: { usdRate: { before, after: after.usdRate } },
      });
      return after;
    });
  },
});
