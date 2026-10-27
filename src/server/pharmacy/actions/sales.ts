import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { createSale, SALE_TIMEOUT_MS, saleInput } from '@/server/pharmacy/sales';
import { defineAction } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';

/**
 * Selling (phase 3). `ph.sales.create` needs `shift.use`; the place names the ONE branch the sale is made in, and the
 * seller's open shift there takes the cash. The sale is idempotent by `clientKey`: a repeat of the same request returns
 * the stored sale. Further permissions (rx.dispense, price.change, batch.override, discount.apply and over_limit) are
 * judged per line by the service from the actor's role.
 */

const isUnique = (error: unknown) => (error as { code?: unknown } | null)?.code === 'P2002';

export const create = defineAction({
  name: 'ph.sales.create',
  permission: null,
  ph: 'shift.use',
  input: saleInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    if (!input.branchId) throw new StudioError('INVALID', 'Choose the branch', { branchId: 'Choose the branch' });
    const branchId = input.branchId;
    try {
      return await ctx.transaction(
        async (tx) => {
          const { result, audit } = await createSale(tx, { ph, branchId, input });
          if (audit) {
            // Ids, number, totals and counts only: no customer field, no cost.
            ctx.audit({
              action: 'ph.sale.create',
              entityType: 'PhSale',
              entityId: result.id,
              changes: {
                status: { before: null, after: 'COMPLETED' },
                number: { before: null, after: audit.number },
                branchId: { before: null, after: audit.branchId },
                currency: { before: null, after: audit.currency },
                totalMinor: { before: null, after: audit.totalMinor },
                discountMinor: { before: null, after: audit.discountMinor },
                lineCount: { before: null, after: audit.lineCount },
                paymentCount: { before: null, after: audit.paymentCount },
                priceOverrides: { before: null, after: audit.priceOverrides },
                batchOverrides: { before: null, after: audit.batchOverrides },
              },
            });
          }
          return result;
        },
        { timeoutMs: SALE_TIMEOUT_MS },
      );
    } catch (error) {
      // The key's sale is in a branch this person cannot see, or a unique index we did not pre-check refused a write.
      if (isUnique(error)) throw new StudioError('CONFLICT', 'This key was already used', { phCode: 'CLIENT_KEY_USED' });
      throw error;
    }
  },
});
