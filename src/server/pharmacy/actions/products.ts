import { z } from 'zod';
import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import {
  archiveProduct,
  asDuplicate,
  assertBranchSettings,
  createProduct,
  pharmacyOf,
  productInput,
  updateProduct,
  type ProductWrite,
} from '@/server/pharmacy/products';
import { defineAction, type ActionContext } from '@/server/studio/framework/action';

/**
 * The catalog's products (spec 4, Phase 1): create, update with the version the person started from, and archive
 * (never delete). All need `catalog.manage`; a support actor runs no action. The services in `../products.ts` check
 * and write; these handlers run them in one transaction with their audit rows.
 */

const productId = z.string().min(1).max(64);
const expectedVersion = z.number().int().min(1);

/** The audit rows of a product write: the product itself, and one line per barcode it shared with other products. */
function auditWrite(ctx: ActionContext, action: string, written: ProductWrite): void {
  ctx.audit({ action, entityType: 'PhProduct', entityId: written.id, changes: written.changes });
  for (const shared of written.shared) {
    ctx.audit({
      action: 'ph.barcode.share',
      entityType: 'PhBarcode',
      entityId: written.id,
      changes: { code: { before: null, after: shared.code }, sharedWith: { before: null, after: shared.productIds } },
    });
  }
}

export const create = defineAction({
  name: 'ph.products.create',
  permission: null,
  ph: 'catalog.manage',
  input: productInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    assertBranchSettings(ph, input.branchSettings);
    try {
      return await ctx.transaction(async (tx) => {
        const written = await createProduct(tx, ph.restaurantId, input);
        auditWrite(ctx, 'ph.product.create', written);
        return { id: written.id, version: written.version };
      });
    } catch (error) {
      // Two people saving the same product at once: the database keeps one, and the other learns which.
      throw await asDuplicate(scoped, error, input);
    }
  },
});

export const update = defineAction({
  name: 'ph.products.update',
  permission: null,
  ph: 'catalog.manage',
  input: productInput.extend(phPlaceInput.shape).extend({ productId, expectedVersion }),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    assertBranchSettings(ph, input.branchSettings);
    try {
      return await ctx.transaction(async (tx) => {
        const written = await updateProduct(tx, input.productId, input.expectedVersion, input);
        auditWrite(ctx, 'ph.product.update', written);
        return { id: written.id, version: written.version };
      });
    } catch (error) {
      throw await asDuplicate(scoped, error, input, input.productId);
    }
  },
});

export const archive = defineAction({
  name: 'ph.products.archive',
  permission: null,
  ph: 'catalog.manage',
  input: phPlaceInput.extend({ productId, expectedVersion }),
  target: phTargetOf,
  run: (ctx, input) =>
    ctx.transaction(async (tx) => {
      const archived = await archiveProduct(tx, input.productId, input.expectedVersion);
      if (archived.changed) {
        ctx.audit({ action: 'ph.product.archive', entityType: 'PhProduct', entityId: archived.id, changes: { active: { before: true, after: false } } });
      }
      return { id: archived.id, version: archived.version, active: false as const };
    }),
});
