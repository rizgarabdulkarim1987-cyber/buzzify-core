import { z } from 'zod';
import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { archiveSupplier, createSupplier, supplierFields, updateSupplier } from '@/server/pharmacy/suppliers';
import { defineAction } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';

/**
 * Suppliers (R4-1): business-wide, so the place's branch plays no part. All need `purchase.manage`. The audit rows carry
 * ids, version, active, currency and terms: never the name, phone, contact, address or note.
 */

const supplierId = z.string().min(1).max(64);
const clientKey = z.string().trim().min(8, 'Use at least 8 characters').max(100, 'Use at most 100 characters');

const isUnique = (error: unknown) => (error as { code?: unknown } | null)?.code === 'P2002';
const exists = () => new StudioError('CONFLICT', 'This supplier already exists', { phCode: 'SUPPLIER_EXISTS', name: 'This supplier already exists' });

export const create = defineAction({
  name: 'ph.suppliers.create',
  permission: null,
  ph: 'purchase.manage',
  input: supplierFields.extend(phPlaceInput.shape).extend({ clientKey }),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    const attempt = () =>
      ctx.transaction(async (tx) => {
        const made = await createSupplier(tx, { restaurantId: ph.restaurantId, userId: ph.userId, clientKey: input.clientKey, input });
        if (!made.replayed) {
          ctx.audit({
            action: 'ph.supplier.create',
            entityType: 'PhSupplier',
            entityId: made.id,
            changes: {
              version: { before: null, after: made.version },
              active: { before: null, after: made.active },
              defaultCurrency: { before: null, after: made.defaultCurrency },
              termsDays: { before: null, after: made.termsDays },
            },
          });
        }
        return made;
      });
    try {
      return await attempt();
    } catch (error) {
      if (!isUnique(error)) throw error;
      // Two saves at once: the database kept one. Run again: a repeated key is found and compared, a taken name is refused.
      try {
        return await attempt();
      } catch (again) {
        if (!isUnique(again)) throw again;
        throw new StudioError('CONFLICT', 'This key was already used', { phCode: 'CLIENT_KEY_USED' });
      }
    }
  },
});

export const update = defineAction({
  name: 'ph.suppliers.update',
  permission: null,
  ph: 'purchase.manage',
  input: supplierFields.extend(phPlaceInput.shape).extend({ supplierId, expectedVersion: z.number().int().min(1) }),
  target: phTargetOf,
  async run(ctx, input) {
    try {
      return await ctx.transaction(async (tx) => {
        const saved = await updateSupplier(tx, { supplierId: input.supplierId, expectedVersion: input.expectedVersion, input });
        ctx.audit({
          action: 'ph.supplier.update',
          entityType: 'PhSupplier',
          entityId: saved.id,
          changes: {
            version: { before: input.expectedVersion, after: saved.version },
            defaultCurrency: { before: saved.before.defaultCurrency, after: saved.after.defaultCurrency },
            termsDays: { before: saved.before.termsDays, after: saved.after.termsDays },
          },
        });
        return { id: saved.id, version: saved.version };
      });
    } catch (error) {
      // Another save took the name between the check and the write: the unique key refused it.
      if (isUnique(error)) throw exists();
      throw error;
    }
  },
});

export const archive = defineAction({
  name: 'ph.suppliers.archive',
  permission: null,
  ph: 'purchase.manage',
  input: phPlaceInput.extend({ supplierId, archived: z.boolean() }),
  target: phTargetOf,
  run(ctx, input) {
    return ctx.transaction(async (tx) => {
      const done = await archiveSupplier(tx, { supplierId: input.supplierId, archived: input.archived });
      if (done.changed) {
        ctx.audit({
          action: 'ph.supplier.archive',
          entityType: 'PhSupplier',
          entityId: done.id,
          changes: { active: { before: !done.active, after: done.active }, version: { before: done.version - 1, after: done.version } },
        });
      }
      return { id: done.id, version: done.version, active: done.active };
    });
  },
});
