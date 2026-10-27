import { z } from 'zod';
import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { getProduct, listProducts, mayViewCost, NO_COST, pharmacyOf, productListInput } from '@/server/pharmacy/products';
import { searchInput, searchProducts } from '@/server/pharmacy/search';
import { defineQuery } from '@/server/studio/framework/query';
import { StudioError } from '@/server/studio/framework/result';

/**
 * Reading the catalog (`catalog.view`: every pharmacy role, and support with a `catalog.read` grant, each read audited
 * by the framework). Cost appears only for a role with `cost.view`; the key is absent for everyone else.
 */

export const get = defineQuery({
  name: 'ph.products.get',
  permission: null,
  ph: 'catalog.view',
  input: phPlaceInput.extend({ productId: z.string().min(1).max(64) }),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    return getProduct(scoped, input.productId, mayViewCost(ph));
  },
});

/**
 * The central search (barcode, trade name, generic name, active ingredient). The place's `branchId`, when given, is the
 * branch whose prices are shown: the framework refuses one outside the actor's branches, and the handler checks again.
 */
export const search = defineQuery({
  name: 'ph.products.search',
  permission: null,
  ph: 'catalog.view',
  input: searchInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    if (input.branchId !== undefined && !ph.branchIds.includes(input.branchId)) throw new StudioError('FORBIDDEN');
    const found = await searchProducts(scoped, input);
    // The cost key, shaped as the list's, only for a role with cost.view: absent from what anyone else receives.
    return mayViewCost(ph) ? found.map((item) => ({ ...item, cost: { ...NO_COST } })) : found;
  },
});

export const list = defineQuery({
  name: 'ph.products.list',
  permission: null,
  ph: 'catalog.view',
  input: productListInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    return listProducts(scoped, input, mayViewCost(ph));
  },
});

/** The business's categories, by name, for the product editor's choice. */
export const categories = defineQuery({
  name: 'ph.products.categories',
  permission: null,
  ph: 'catalog.view',
  input: phPlaceInput,
  target: phTargetOf,
  run(ctx) {
    const { scoped } = pharmacyOf(ctx);
    return scoped.phCategory.findMany({ select: { id: true, name: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
  },
});
