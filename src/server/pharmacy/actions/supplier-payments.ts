import { canPh } from '@/server/domain/pharmacy/permissions';
import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { applyCredit, applyCreditFields, createPayment, paymentFields, reverseFields, reversePayment } from '@/server/pharmacy/supplier-payments';
import { defineAction } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from '@/server/pharmacy/actor';

/**
 * Supplier payments, their reversals and credit allocation (R4-5..R4-7). They are business-wide, so the place's branch plays
 * no part. Every one is a money decision: it needs `purchase.manage` AND `report.view` (R4-9a), which the owner, a branch
 * manager, the pharmacist in charge and an accountant hold and a stock clerk does not. The audit rows carry ids, amounts,
 * currency, method and counts, and the invoices each one settled (invoice id and amount): never the reference, the reason or any name. Payments never touch a cashier drawer (R4-6).
 */

const isUnique = (error: unknown) => (error as { code?: unknown } | null)?.code === 'P2002';

/** Up to 200 allocations, a few writes each: more than the default transaction time on a slow day. */
const SLOW = { timeoutMs: 60_000 };

function assertMoneyRole(ph: PhActor): void {
  if (ph.role === null || !canPh(ph.role, 'report.view')) throw new StudioError('FORBIDDEN');
}

/** Two saves at once with one key: the database kept one. Run again once, and a repeated key is then found and compared. */
async function withKeyRetry<T>(attempt: () => Promise<T>): Promise<T> {
  try {
    return await attempt();
  } catch (error) {
    if (!isUnique(error)) throw error;
    try {
      return await attempt();
    } catch (again) {
      if (!isUnique(again)) throw again;
      throw new StudioError('CONFLICT', 'This key was already used', { phCode: 'CLIENT_KEY_USED' });
    }
  }
}

export const create = defineAction({
  name: 'ph.supplierPayments.create',
  permission: null,
  ph: 'purchase.manage',
  input: paymentFields.extend(phPlaceInput.shape),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    assertMoneyRole(ph);
    return withKeyRetry(() =>
      ctx.transaction(async (tx) => {
        const made = await createPayment(tx, { restaurantId: ph.restaurantId, userId: ph.userId, clientKey: input.clientKey, input });
        if (!made.replayed) {
          ctx.audit({
            action: 'ph.supplierPayment.create',
            entityType: 'PhSupplierPayment',
            entityId: made.id,
            changes: {
              supplierId: { before: null, after: made.supplierId },
              currency: { before: null, after: made.currency },
              method: { before: null, after: made.method },
              amountMinor: { before: null, after: made.amountMinor },
              paidOn: { before: null, after: made.paidOn },
              allocationCount: { before: null, after: made.allocations.length },
              settled: { before: null, after: made.allocations },
            },
          });
        }
        return made;
      }, SLOW),
    );
  },
});

export const reverse = defineAction({
  name: 'ph.supplierPayments.reverse',
  permission: null,
  ph: 'purchase.manage',
  input: reverseFields.extend(phPlaceInput.shape),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    assertMoneyRole(ph);
    return withKeyRetry(() =>
      ctx.transaction(async (tx) => {
        const done = await reversePayment(tx, { restaurantId: ph.restaurantId, userId: ph.userId, clientKey: input.clientKey, input });
        if (!done.replayed) {
          ctx.audit({
            action: 'ph.supplierPayment.reverse',
            entityType: 'PhSupplierPayment',
            entityId: done.id,
            changes: {
              reversesId: { before: null, after: done.reversesId },
              supplierId: { before: null, after: done.supplierId },
              currency: { before: null, after: done.currency },
              method: { before: null, after: done.method },
              amountMinor: { before: null, after: done.amountMinor },
              allocationCount: { before: null, after: done.allocations.length },
              settled: { before: null, after: done.allocations },
            },
          });
        }
        return done;
      }, SLOW),
    );
  },
});

export const applyCreditNote = defineAction({
  name: 'ph.credits.apply',
  permission: null,
  ph: 'purchase.manage',
  input: applyCreditFields.extend(phPlaceInput.shape),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    assertMoneyRole(ph);
    return ctx.transaction(async (tx) => {
      const done = await applyCredit(tx, { restaurantId: ph.restaurantId, userId: ph.userId, clientKey: input.clientKey, input });
      if (!done.replayed) {
        const before = BigInt(done.appliedMinor) - BigInt(done.appliedNowMinor);
        ctx.audit({
          action: 'ph.credit.apply',
          entityType: 'PhCreditNote',
          entityId: done.creditNoteId,
          changes: {
            supplierId: { before: done.supplierId, after: done.supplierId },
            currency: { before: done.currency, after: done.currency },
            appliedMinor: { before: before.toString(), after: done.appliedMinor },
            appliedNowMinor: { before: null, after: done.appliedNowMinor },
            allocationCount: { before: null, after: done.allocations.length },
            settled: { before: null, after: done.allocations },
          },
        });
      }
      return done;
    }, SLOW);
  },
});
