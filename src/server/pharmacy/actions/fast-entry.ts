import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { addEntryLine as addLine, entryBranchOf, entryFinishInput, entryLineInput, finishEntryDraft } from '@/server/pharmacy/fast-entry';
import { asPriceRace } from '@/server/pharmacy/prices';
import { pharmacyOf } from '@/server/pharmacy/products';
import { asRetryable } from '@/server/pharmacy/receipts';
import { defineAction } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';

/**
 * Fast product entry (Task 13). Both need `purchase.manage`, the receiving permission (a new product also needs
 * `catalog.manage`, checked by the service). The branch is the place's. `addEntryLine` adds one line, in packets, to the
 * person's entry draft of that branch (created by the first line, resumed after a reload), making the product first
 * when it is new; a repeated `requestKey` answers the same line. `finishEntry` confirms the draft into stock, once.
 */

/** Up to 200 lines, each a batch lookup and a few writes: the receiving confirm's own limit. */
const CONFIRM_TIMEOUT_MS = 60_000;

const isUnique = (error: unknown) => (error as { code?: unknown } | null)?.code === 'P2002';

export const addEntryLine = defineAction({
  name: 'ph.stock.entry.addLine',
  permission: null,
  ph: 'purchase.manage',
  input: entryLineInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    const branchId = entryBranchOf(input);
    const attempt = () =>
      ctx.transaction(async (tx) => {
        const written = await addLine(tx, ph, { branchId, input, now: new Date() });
        const { result } = written;
        if (result.replayed) return result;
        // Ids, counts, amounts and status only, as the catalog, receiving and price actions write them.
        if (written.product) {
          ctx.audit({ action: 'ph.product.create', entityType: 'PhProduct', entityId: written.product.id, changes: written.product.changes });
          for (const shared of written.product.shared) {
            ctx.audit({ action: 'ph.barcode.share', entityType: 'PhProduct', entityId: written.product.id, changes: { code: { before: null, after: shared.code }, sharedWith: { before: null, after: shared.productIds } } });
          }
        }
        if (written.receiptCreated) {
          ctx.audit({
            action: 'ph.receipt.create',
            entityType: 'PhReceipt',
            entityId: result.receiptId,
            changes: { status: { before: null, after: 'DRAFT' }, branchId: { before: null, after: branchId }, lineCount: { before: null, after: result.lineCount }, entry: { before: null, after: true } },
          });
        } else {
          ctx.audit({
            action: 'ph.receipt.update',
            entityType: 'PhReceipt',
            entityId: result.receiptId,
            changes: { version: { before: result.version - 1, after: result.version }, lineCount: { before: result.lineCount - 1, after: result.lineCount } },
          });
        }
        if (written.price) {
          const p = written.price;
          ctx.audit({
            action: 'ph.price.set',
            entityType: 'PhPrice',
            entityId: p.id,
            changes: {
              productId: { before: null, after: p.key.productId },
              unitId: { before: null, after: p.key.unitId },
              branchId: { before: null, after: p.key.branchId },
              currency: { before: null, after: p.key.currency },
              amountMinor: { before: p.previous?.amountMinor.toString() ?? null, after: p.amountMinor.toString() },
              validFrom: { before: p.previous?.validFrom.toISOString() ?? null, after: p.validFrom.toISOString() },
            },
          });
        }
        return result;
      });
    try {
      return await attempt();
    } catch (error) {
      if (!isUnique(error)) throw asPriceRace(asRetryable(error));
      // Two saves at once (the same key, the same new product or barcode, the same open price): the database kept one.
      // Run again: the repeat is then answered, or refused by the check that now sees the winner.
      try {
        return await attempt();
      } catch (again) {
        if (!isUnique(again)) throw asPriceRace(asRetryable(again));
        throw new StudioError('CONFLICT', 'Someone else changed this receipt: reload it');
      }
    }
  },
});

export const finishEntry = defineAction({
  name: 'ph.stock.entry.finish',
  permission: null,
  ph: 'purchase.manage',
  input: entryFinishInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    const branchId = entryBranchOf(input);
    return ctx
      .transaction(
        async (tx) => {
          const done = await finishEntryDraft(tx, ph, { branchId, ...(input.receiptId ? { receiptId: input.receiptId } : {}), now: new Date() });
          if (!done.replayed) {
            ctx.audit({
              action: 'ph.receipt.confirm',
              entityType: 'PhReceipt',
              entityId: done.id,
              changes: {
                status: { before: 'DRAFT', after: 'CONFIRMED' },
                number: { before: null, after: done.number },
                lineCount: { before: null, after: done.lines },
                baseQty: { before: null, after: done.baseQty },
                costDiffers: { before: null, after: done.warnings.length },
              },
            });
          }
          return done;
        },
        { timeoutMs: CONFIRM_TIMEOUT_MS },
      )
      .catch((error: unknown) => {
        throw asRetryable(error);
      });
  },
});
