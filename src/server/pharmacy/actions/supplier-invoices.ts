import { z } from 'zod';
import { canPh } from '@/server/domain/pharmacy/permissions';
import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { asInvoiceError, createInvoice, invoiceFields, voidInvoice as voidInvoiceRow, voidReason } from '@/server/pharmacy/supplier-invoices';
import { defineAction } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';

/**
 * Supplier invoices (R4-4): business-wide, so the place's branch plays no part. Entering one needs `purchase.manage`;
 * voiding one needs `purchase.manage` AND `report.view` (R4-9a). The audit rows carry ids, status, currency, amounts and the
 * line count: never the adjustment reason, the void reason or any name.
 */

const clientKey = z.string().trim().min(8, 'Use at least 8 characters').max(100, 'Use at most 100 characters');
const isUnique = (error: unknown) => (error as { code?: unknown } | null)?.code === 'P2002';

/** Up to 200 lines, a few writes each: more than the default transaction time on a slow day. */
const SLOW = { timeoutMs: 60_000 };

export const create = defineAction({
  name: 'ph.invoices.create',
  permission: null,
  ph: 'purchase.manage',
  input: invoiceFields.extend(phPlaceInput.shape).extend({ clientKey }),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    const attempt = async () => {
      try {
        return await ctx.transaction(async (tx) => {
          const made = await createInvoice(tx, { restaurantId: ph.restaurantId, userId: ph.userId, clientKey: input.clientKey, input });
          if (!made.replayed) {
            ctx.audit({
              action: 'ph.invoice.create',
              entityType: 'PhSupplierInvoice',
              entityId: made.id,
              changes: {
                status: { before: null, after: made.status },
                version: { before: null, after: made.version },
                supplierId: { before: null, after: made.supplierId },
                currency: { before: null, after: made.currency },
                totalMinor: { before: null, after: made.totalMinor },
                adjustmentMinor: { before: null, after: made.adjustmentMinor },
                lineCount: { before: null, after: made.lineCount },
              },
            });
          }
          return made;
        }, SLOW);
      } catch (error) {
        // The total check of the database runs when the transaction commits, so its failure arrives here.
        throw asInvoiceError(error);
      }
    };
    try {
      return await attempt();
    } catch (error) {
      if (!isUnique(error)) throw error;
      // Two saves at once with one key or one number: the database kept one. Run again: a repeated key is found and
      // compared, a repeated number is refused as a duplicate.
      try {
        return await attempt();
      } catch (again) {
        if (!isUnique(again)) throw again;
        throw new StudioError('CONFLICT', 'This key was already used', { phCode: 'CLIENT_KEY_USED' });
      }
    }
  },
});

export const voidInvoice = defineAction({
  name: 'ph.invoices.void',
  permission: null,
  ph: 'purchase.manage',
  input: phPlaceInput.extend({ invoiceId: z.string().min(1).max(64), expectedVersion: z.number().int().min(1), reason: voidReason }),
  target: phTargetOf,
  run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    // R4-9a: undoing a supplier's bill is a money decision; the stock clerk who may enter it may not undo it.
    if (ph.role === null || !canPh(ph.role, 'report.view')) throw new StudioError('FORBIDDEN');
    return ctx.transaction(async (tx) => {
      const done = await voidInvoiceRow(tx, { restaurantId: ph.restaurantId, userId: ph.userId, invoiceId: input.invoiceId, expectedVersion: input.expectedVersion, reason: input.reason });
      ctx.audit({
        action: 'ph.invoice.void',
        entityType: 'PhSupplierInvoice',
        entityId: done.id,
        changes: {
          status: { before: done.before.status, after: done.status },
          version: { before: done.before.version, after: done.version },
          currency: { before: done.currency, after: done.currency },
          totalMinor: { before: done.totalMinor, after: done.totalMinor },
          lineCount: { before: done.lineCount, after: done.lineCount },
        },
      });
      return { id: done.id, version: done.version, status: done.status };
    }, SLOW);
  },
});
