import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import {
  applyBulkPrices,
  asPriceRace,
  assertPriceBranch,
  bulkApplyInput,
  bulkPreviewInput,
  previewBulkPrices,
  priceSetInput,
  setPrice,
} from '@/server/pharmacy/prices';
import { pharmacyOf } from '@/server/pharmacy/products';
import { defineAction } from '@/server/studio/framework/action';

/**
 * Sale prices (spec 4, Phase 1): one price at a time, and bulk changes that are previewed, stored and then applied all
 * or nothing. All need `price.change`; a support actor runs no action. The definition's `branchId` is the price's branch
 * (absent: the business-wide price, for an actor with every branch). The services in `../prices.ts` check and write;
 * these handlers run them in one transaction with their audit rows, which carry ids, amounts and currency only.
 */

export const set = defineAction({
  name: 'ph.prices.set',
  permission: null,
  ph: 'price.change',
  input: priceSetInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    assertPriceBranch(ph, input.branchId ?? null);
    try {
      return await ctx.transaction(async (tx) => {
        const written = await setPrice(tx, ph, input);
        ctx.audit({
          action: 'ph.price.set',
          entityType: 'PhPrice',
          entityId: written.id,
          changes: {
            productId: { before: null, after: written.key.productId },
            unitId: { before: null, after: written.key.unitId },
            branchId: { before: null, after: written.key.branchId },
            currency: { before: null, after: written.key.currency },
            amountMinor: { before: written.previous?.amountMinor.toString() ?? null, after: written.amountMinor.toString() },
            validFrom: { before: written.previous?.validFrom.toISOString() ?? null, after: written.validFrom.toISOString() },
          },
        });
        return { id: written.id, previousId: written.previous?.id ?? null };
      });
    } catch (error) {
      // Two people setting the same price at once: the database keeps one open row, and the other is told to reload.
      throw asPriceRace(error);
    }
  },
});

export const previewBulk = defineAction({
  name: 'ph.prices.previewBulk',
  permission: null,
  ph: 'price.change',
  input: bulkPreviewInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    assertPriceBranch(ph, input.branchId ?? null);
    return ctx.transaction(async (tx) => {
      const { batchId, preview, params } = await previewBulkPrices(tx, ph, input);
      ctx.audit({
        action: 'ph.price.bulkPreview',
        entityType: 'PhPriceChangeBatch',
        entityId: batchId,
        changes: {
          status: { before: null, after: 'PREVIEW' },
          branchId: { before: null, after: params.branchId },
          currency: { before: null, after: params.currency },
          change: { before: null, after: params.change },
          rounding: { before: null, after: params.rounding },
          validFrom: { before: null, after: input.validFrom.toISOString() },
          rowCount: { before: null, after: preview.rows.length },
        },
      });
      return {
        batchId,
        previewHash: preview.previewHash,
        rows: preview.rows.map((r) => ({ productId: r.productId, unitId: r.unitId, before: r.before.toString(), after: r.after.toString() })),
      };
    });
  },
});

export const applyBulk = defineAction({
  name: 'ph.prices.applyBulk',
  permission: null,
  ph: 'price.change',
  input: bulkApplyInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    try {
      return await ctx.transaction(async (tx) => {
        const applied = await applyBulkPrices(tx, ph, input);
        if (applied.alreadyApplied) return { batchId: input.batchId, changed: 0, alreadyApplied: true };
        ctx.audit({
          action: 'ph.price.bulkApply',
          entityType: 'PhPriceChangeBatch',
          entityId: input.batchId,
          changes: {
            status: { before: 'PREVIEW', after: 'APPLIED' },
            branchId: { before: null, after: applied.params.branchId },
            currency: { before: null, after: applied.params.currency },
            validFrom: { before: null, after: applied.validFrom.toISOString() },
            prices: {
              before: null,
              after: applied.written.map((w) => ({
                priceId: w.id,
                productId: w.key.productId,
                unitId: w.key.unitId,
                before: w.previous?.amountMinor.toString() ?? null,
                after: w.amountMinor.toString(),
              })),
            },
          },
        });
        return { batchId: input.batchId, changed: applied.written.length, alreadyApplied: false };
      });
    } catch (error) {
      throw asPriceRace(error);
    }
  },
});
