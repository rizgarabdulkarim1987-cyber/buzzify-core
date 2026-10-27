import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { createHold, discardHold as removeHold, holdIdInput, holdInput, resumeHold } from '@/server/pharmacy/holds';
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
                ...(audit.fromHoldId ? { fromHoldId: { before: null, after: audit.fromHoldId } } : {}),
              },
            });
          }
          return result;
        },
        { timeoutMs: SALE_TIMEOUT_MS },
      );
    } catch (error) {
      // The shift closed between the sale's check and its insert: the database trigger (migration pharmacy_shift_closed_guard) refused it.
      if (String((error as { message?: unknown } | null)?.message ?? '').includes('PH_SHIFT_CLOSED')) {
        throw new StudioError('CONFLICT', 'Open a shift before selling', { phCode: 'NO_OPEN_SHIFT' });
      }
      // A unique index refused a write: say which key, by the constraint's own name; anything else is not ours to guess.
      if (isUnique(error)) {
        const where = JSON.stringify((error as { meta?: unknown }).meta ?? {}) + String((error as { message?: unknown }).message ?? '');
        if (/PhPayment/.test(where)) throw new StudioError('CONFLICT', 'This payment key was already used', { phCode: 'PAYMENT_KEY_USED' });
        if (/PhSale/.test(where) && /clientKey/.test(where)) throw new StudioError('CONFLICT', 'This key was already used', { phCode: 'CLIENT_KEY_USED' });
      }
      throw error;
    }
  },
});

/**
 * Holds (task 3b): `ph.sales.hold` stores a cart (no stock, no payment, no number, 24 hours), `ph.sales.resume` returns it
 * for the screen to edit, `ph.sales.discardHold` deletes it. Completing a hold is `ph.sales.create` with `fromHoldId`.
 * Holds are the branch's: any seller (`shift.use`) of the branch may resume, discard or complete one.
 */

const needBranch = (branchId: string | undefined): string => {
  if (!branchId) throw new StudioError('INVALID', 'Choose the branch', { branchId: 'Choose the branch' });
  return branchId;
};

export const hold = defineAction({
  name: 'ph.sales.hold',
  permission: null,
  ph: 'shift.use',
  input: holdInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    const branchId = needBranch(input.branchId);
    try {
      return await ctx.transaction(async (tx) => {
        const { result, audit } = await createHold(tx, { ph, branchId, input });
        if (audit) {
          // Ids, totals and counts only: not the note, no customer field.
          ctx.audit({
            action: 'ph.sale.hold',
            entityType: 'PhSale',
            entityId: result.id,
            changes: {
              status: { before: null, after: 'HELD' },
              branchId: { before: null, after: audit.branchId },
              currency: { before: null, after: audit.currency },
              totalMinor: { before: null, after: audit.totalMinor },
              lineCount: { before: null, after: audit.lineCount },
            },
          });
        }
        return result;
      });
    } catch (error) {
      if (String((error as { message?: unknown } | null)?.message ?? '').includes('PH_SHIFT_CLOSED')) {
        throw new StudioError('CONFLICT', 'Open a shift before selling', { phCode: 'NO_OPEN_SHIFT' });
      }
      if (isUnique(error)) throw new StudioError('CONFLICT', 'This key was already used', { phCode: 'CLIENT_KEY_USED' });
      throw error;
    }
  },
});

export const resume = defineAction({
  name: 'ph.sales.resume',
  permission: null,
  ph: 'shift.use',
  input: holdIdInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  async run(ctx, input) {
    const branchId = needBranch(input.branchId);
    const found = await ctx.transaction((tx) => resumeHold(tx, { branchId, saleId: input.saleId }));
    // The flip to HOLD_EXPIRED is committed above; only now is the refusal thrown.
    if (found.expired) throw new StudioError('CONFLICT', 'This held cart has expired', { phCode: 'HOLD_EXPIRED' });
    return found.cart;
  },
});

export const discardHold = defineAction({
  name: 'ph.sales.discardHold',
  permission: null,
  ph: 'shift.use',
  input: holdIdInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  async run(ctx, input) {
    const branchId = needBranch(input.branchId);
    return ctx.transaction(async (tx) => {
      const gone = await removeHold(tx, { branchId, saleId: input.saleId });
      ctx.audit({
        action: 'ph.sale.hold.discard',
        entityType: 'PhSale',
        entityId: input.saleId,
        changes: { status: { before: 'HELD', after: null }, lineCount: { before: gone.lineCount, after: null }, totalMinor: { before: gone.totalMinor, after: null } },
      });
      return { saleId: input.saleId, discarded: true as const };
    });
  },
});
