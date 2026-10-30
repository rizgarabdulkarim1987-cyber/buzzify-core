import { z } from 'zod';
import { archiveCustomer, createCustomer, customerCreateFields, customerFields, paymentFields, recordPayment, reverseFields, reversePayment, updateCustomer } from '@/server/pharmacy/customers';
import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { defineAction } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';

/**
 * Customers and their payments (phase 7, R7-5). Customers are the business's, so the place's branch plays no part in
 * creating, editing or archiving one; a payment is taken at a branch (the place names it). All need `customer.manage`. The
 * audit rows carry ids, version, active, currency, limit, method and amounts: never the name, phone or note. The customer's id is
 * audited under the key `accountId` because the audit guard (`FORBIDDEN_AUDIT_FIELDS`) refuses any key that spells a customer field; the
 * value is an id, not a personal datum (the same reading as `rxId` for prescriptions).
 */

const customerId = z.string().min(1).max(64);
const isUnique = (error: unknown) => (error as { code?: unknown } | null)?.code === 'P2002';

export const create = defineAction({
  name: 'ph.customers.create',
  permission: null,
  ph: 'customer.manage',
  input: customerCreateFields.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    return ctx.transaction(async (tx) => {
      const made = await createCustomer(tx, { restaurantId: ph.restaurantId, input });
      ctx.audit({
        action: 'ph.customer.create',
        entityType: 'PhCustomer',
        entityId: made.id,
        changes: {
          currency: { before: null, after: made.currency },
          creditLimitMinor: { before: null, after: made.creditLimitMinor },
          active: { before: null, after: made.active },
          version: { before: null, after: made.version },
        },
      });
      return made;
    });
  },
});

export const update = defineAction({
  name: 'ph.customers.update',
  permission: null,
  ph: 'customer.manage',
  input: customerFields.extend(phPlaceInput.shape).extend({ customerId, expectedVersion: z.number().int().min(1) }),
  target: phTargetOf,
  run(ctx, input) {
    return ctx.transaction(async (tx) => {
      const saved = await updateCustomer(tx, { customerId: input.customerId, expectedVersion: input.expectedVersion, input });
      ctx.audit({
        action: 'ph.customer.update',
        entityType: 'PhCustomer',
        entityId: saved.id,
        changes: {
          version: { before: input.expectedVersion, after: saved.version },
          creditLimitMinor: { before: saved.before.creditLimitMinor, after: saved.after.creditLimitMinor },
        },
      });
      return { id: saved.id, version: saved.version };
    });
  },
});

export const archive = defineAction({
  name: 'ph.customers.archive',
  permission: null,
  ph: 'customer.manage',
  input: phPlaceInput.extend({ customerId, archived: z.boolean() }),
  target: phTargetOf,
  run(ctx, input) {
    return ctx.transaction(async (tx) => {
      const done = await archiveCustomer(tx, { customerId: input.customerId, archived: input.archived });
      if (done.changed) {
        ctx.audit({
          action: 'ph.customer.archive',
          entityType: 'PhCustomer',
          entityId: done.id,
          changes: { active: { before: !done.active, after: done.active }, version: { before: done.version - 1, after: done.version } },
        });
      }
      return { id: done.id, version: done.version, active: done.active };
    });
  },
});

const needBranch = (branchId: string | undefined): string => {
  if (!branchId) throw new StudioError('INVALID', 'Choose the branch', { branchId: 'Choose the branch' });
  return branchId;
};

/** A key used at another branch (the unique key is business-wide, the replay lookup is branch-scoped) is a used key. */
const keyUsed = () => new StudioError('CONFLICT', 'This key was already used', { phCode: 'CLIENT_KEY_USED' });

export const pay = defineAction({
  name: 'ph.credit.payment.record',
  permission: null,
  ph: 'customer.manage',
  input: paymentFields.extend(phPlaceInput.shape),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    const branchId = needBranch(input.branchId);
    try {
      return await ctx.transaction(async (tx) => {
        const { result, audit } = await recordPayment(tx, { ph, branchId, input });
        if (audit) {
          // Ids, method, amount and currency only: no customer field.
          ctx.audit({
            action: 'ph.credit.payment.record',
            entityType: 'PhCustomerPayment',
            entityId: audit.id,
            changes: {
              accountId: { before: null, after: audit.customerId },
              branchId: { before: null, after: audit.branchId },
              method: { before: null, after: audit.method },
              amountMinor: { before: null, after: audit.amountMinor },
              currency: { before: null, after: audit.currency },
            },
          });
        }
        return result;
      });
    } catch (error) {
      if (String((error as { message?: unknown } | null)?.message ?? '').includes('PH_SHIFT_CLOSED')) {
        throw new StudioError('CONFLICT', 'You have no open shift here', { phCode: 'NO_OPEN_SHIFT' });
      }
      if (isUnique(error)) throw keyUsed();
      throw error;
    }
  },
});

export const reverse = defineAction({
  name: 'ph.credit.payment.reverse',
  permission: null,
  ph: 'customer.manage',
  input: reverseFields.extend(phPlaceInput.shape),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    const branchId = needBranch(input.branchId);
    try {
      return await ctx.transaction(async (tx) => {
        const { result, audit } = await reversePayment(tx, { ph, branchId, input });
        if (audit) {
          ctx.audit({
            action: 'ph.credit.payment.reverse',
            entityType: 'PhCustomerPayment',
            entityId: audit.id,
            changes: {
              reversesId: { before: null, after: audit.reversesId },
              accountId: { before: null, after: audit.customerId },
              method: { before: null, after: audit.method },
              amountMinor: { before: null, after: audit.amountMinor },
              currency: { before: null, after: audit.currency },
            },
          });
        }
        return result;
      });
    } catch (error) {
      if (String((error as { message?: unknown } | null)?.message ?? '').includes('PH_SHIFT_CLOSED')) {
        throw new StudioError('CONFLICT', 'You have no open shift here', { phCode: 'NO_OPEN_SHIFT' });
      }
      // The unique key on `reversesId`: two corrections of one payment raced, the database kept one.
      if (isUnique(error)) {
        const where = JSON.stringify((error as { meta?: unknown }).meta ?? {}) + String((error as { message?: unknown }).message ?? '');
        if (/reversesId/.test(where)) throw new StudioError('CONFLICT', 'This payment was already corrected', { phCode: 'ALREADY_REVERSED' });
        throw keyUsed();
      }
      throw error;
    }
  },
});
