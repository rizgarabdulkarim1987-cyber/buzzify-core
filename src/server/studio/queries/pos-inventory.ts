import { z } from 'zod';
import { canPos } from '@/server/domain/pos/permissions';
import { listItems, listLowStock, listMovements, readItem } from '@/server/pos/inventory';
import { listPurchaseInvoices, listSuppliers, readPurchaseInvoice } from '@/server/pos/purchases';
import { checkRange, readRangeReport } from '@/server/pos/range-report';
import { readRecipe, recipeCounts } from '@/server/pos/recipes';
import { loadTillCatalog } from '@/server/pos/till-catalog';
import { defineQuery, type QueryContext } from '@/server/studio/framework/query';
import { idField } from '@/server/studio/services/content';

/** Stock, suppliers, purchases, recipes and the cost report, read for the person's own restaurant. Costs only for those who may see them. */

const TILL = { kind: 'pos' } as const;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function restaurantOf(ctx: QueryContext): string {
  if (ctx.restaurantId === null) throw new Error('A till query ran without a restaurant');
  return ctx.restaurantId;
}

/** A cashier sees quantities only; purchase prices and costs need the purchase permission. */
function mayCost(ctx: QueryContext): boolean {
  return ctx.pos !== null && canPos(ctx.pos.role, 'purchase.manage');
}

export const posInventoryItems = defineQuery({
  name: 'pos.inventoryItems',
  permission: null,
  pos: 'inventory.view',
  input: z.object({ includeInactive: z.boolean().default(false) }),
  target: () => TILL,
  run: async (ctx, input) => {
    const includeInactive = input.includeInactive && ctx.pos !== null && canPos(ctx.pos.role, 'inventory.manage');
    return listItems(ctx.db, restaurantOf(ctx), { includeInactive, withCost: mayCost(ctx) });
  },
});

export const posLowStock = defineQuery({
  name: 'pos.lowStock',
  permission: null,
  pos: 'inventory.view',
  input: z.object({}),
  target: () => TILL,
  run: (ctx) => listLowStock(ctx.db, restaurantOf(ctx), mayCost(ctx)),
});

/** One item with its ledger. */
export const posInventoryItem = defineQuery({
  name: 'pos.inventoryItem',
  permission: null,
  pos: 'inventory.view',
  input: z.object({ itemId: idField, before: z.coerce.date().optional() }),
  target: () => TILL,
  run: async (ctx, input) => {
    const db = ctx.db;
    const restaurantId = restaurantOf(ctx);
    const [item, movements] = await Promise.all([readItem(db, restaurantId, input.itemId, mayCost(ctx)), listMovements(db, restaurantId, input.itemId, { before: input.before, withCost: mayCost(ctx) })]);
    return { item, movements };
  },
});

export const posSuppliers = defineQuery({
  name: 'pos.suppliers',
  permission: null,
  pos: 'purchase.manage',
  input: z.object({ includeInactive: z.boolean().default(false) }),
  target: () => TILL,
  run: (ctx, input) => listSuppliers(ctx.db, restaurantOf(ctx), input.includeInactive),
});

export const posPurchases = defineQuery({
  name: 'pos.purchases',
  permission: null,
  pos: 'purchase.manage',
  input: z.object({ from: day.optional(), to: day.optional(), supplierId: idField.optional(), unpaidOnly: z.boolean().default(false) }),
  target: () => TILL,
  run: (ctx, input) => listPurchaseInvoices(ctx.db, restaurantOf(ctx), input),
});

export const posPurchase = defineQuery({
  name: 'pos.purchase',
  permission: null,
  pos: 'purchase.manage',
  input: z.object({ invoiceId: idField }),
  target: () => TILL,
  run: (ctx, input) => readPurchaseInvoice(ctx.db, restaurantOf(ctx), input.invoiceId),
});

/** The catalog's products with how many ingredients each recipe has, and the items an ingredient can be. */
export const posRecipes = defineQuery({
  name: 'pos.recipes',
  permission: null,
  pos: 'inventory.manage',
  input: z.object({}),
  target: () => TILL,
  run: async (ctx) => {
    const restaurantId = restaurantOf(ctx);
    const [catalog, counts, items] = await Promise.all([loadTillCatalog(ctx.db, restaurantId), recipeCounts(ctx.db, restaurantId), listItems(ctx.db, restaurantId, { withCost: false })]);
    return {
      products: (catalog?.products ?? []).map((product) => ({ id: product.id, names: product.names, categoryId: product.categoryId, lines: counts[product.id] ?? 0 })),
      categories: (catalog?.categories ?? []).map((category) => ({ id: category.id, names: category.names })),
      defaultLocale: catalog?.defaultLocale ?? 'en',
      items: items.map((item) => ({ id: item.id, name: item.name, unit: item.unit })),
    };
  },
});

export const posRecipe = defineQuery({
  name: 'pos.recipe',
  permission: null,
  pos: 'inventory.manage',
  input: z.object({ productId: idField }),
  target: () => TILL,
  run: (ctx, input) => readRecipe(ctx.db, restaurantOf(ctx), input.productId),
});

export const posRangeReport = defineQuery({
  name: 'pos.rangeReport',
  permission: null,
  pos: 'report.view',
  input: z.object({ from: day, to: day }).refine((v) => !('problem' in checkRange(v.from, v.to)), { message: 'The first number must not exceed the last', path: ['from'] }),
  target: () => TILL,
  run: async (ctx, input) => {
    const report = await readRangeReport(ctx.db, restaurantOf(ctx), input);
    if (ctx.pos !== null && canPos(ctx.pos.role, 'purchase.manage')) return { ...report, costsHidden: false };
    // Purchase prices, cost and margin are for those who manage purchases; a cashier's range shows sales only.
    const { coverage } = report.totals;
    return {
      ...report,
      costsHidden: true,
      days: report.days.map((d) => ({ ...d, purchasesTotal: 0 })),
      totals: { ...report.totals, purchasesTotal: 0, purchasesUnpaid: 0, purchaseCount: 0, wasteCost: 0, wasteUnknown: 0, coverage: { ...coverage, coveredCost: 0, coveredMargin: 0 } },
      products: report.products.map((p) => ({ ...p, cost: null, margin: null })),
    };
  },
});
