import { z } from 'zod';
import { delegates } from '@/server/data/tenant-db';
import { MAX_MOVEMENT, SUPPLIER_PAY_METHODS } from '@/server/domain/pos/stock';
import { adjustStock, createItem, recordStockCount, recordWaste, updateItem } from '@/server/pos/inventory';
import { createPurchaseInvoice, createSupplier, setPurchasePaid, updateSupplier, voidPurchaseInvoice } from '@/server/pos/purchases';
import { setRecipe } from '@/server/pos/recipes';
import { phoneField } from '@/server/pos/phone-field';
import { defineAction, type ActionContext } from '@/server/studio/framework/action';
import { idField } from '@/server/studio/services/content';

/**
 * Inventory, suppliers, purchases and recipes. All online only: none is one of the operations a till device may queue. Every
 * quantity is an integer in the item's smallest unit (the screen parses what was typed); every amount is integer IQD.
 */

const TILL = { kind: 'pos' } as const;
const CATALOG = { kind: 'pos', catalog: true } as const;
const INT32 = 2_147_483_647;

const name = z.string().trim().min(1, 'Enter a name').max(120, 'Use at most 120 characters');
const reason = z.string().trim().min(1, 'Enter a reason').max(300, 'Use at most 300 characters');
const unit = z.enum(['GRAM', 'MILLILITER', 'PIECE']);
const quantity = z.number().int().min(1).max(MAX_MOVEMENT);
const reorderLevel = z.number().int().min(0).max(MAX_MOVEMENT);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function till(ctx: ActionContext) {
  if (ctx.pos === null || ctx.restaurantId === null) throw new Error('A till action ran without a till');
  return { pos: ctx.pos, restaurantId: ctx.restaurantId };
}

export const createPosItem = defineAction({
  name: 'pos.createItem',
  permission: null,
  pos: 'inventory.manage',
  input: z.object({ name, unit, reorderLevel }),
  target: () => TILL,
  run: (ctx, input) => {
    const { restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      const itemId = await createItem(delegates(tx), restaurantId, input);
      ctx.audit({ action: 'pos.inventory.item.create', entityType: 'PosInventoryItem', entityId: itemId, changes: { name: { before: null, after: input.name }, unit: { before: null, after: input.unit }, reorderLevel: { before: null, after: input.reorderLevel } } });
      return { itemId };
    });
  },
});

export const updatePosItem = defineAction({
  name: 'pos.updateItem',
  permission: null,
  pos: 'inventory.manage',
  input: z
    .object({ itemId: idField, name: name.optional(), reorderLevel: reorderLevel.optional(), active: z.boolean().optional() })
    .refine((v) => v.name !== undefined || v.reorderLevel !== undefined || v.active !== undefined, { message: 'Nothing to change', path: ['name'] }),
  target: () => TILL,
  run: (ctx, { itemId, ...fields }) => {
    const { restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      const done = await updateItem(delegates(tx), restaurantId, itemId, fields);
      if (done.changed) {
        const changes: Record<string, { before: unknown; after: unknown }> = {};
        for (const key of Object.keys(done.after)) changes[key] = { before: done.before[key], after: done.after[key] };
        ctx.audit({ action: 'pos.inventory.item.update', entityType: 'PosInventoryItem', entityId: itemId, changes });
      }
      return { itemId };
    });
  },
});

export const adjustPosStock = defineAction({
  name: 'pos.adjustStock',
  permission: null,
  pos: 'inventory.manage',
  input: z.object({ itemId: idField, quantity: z.number().int().min(-MAX_MOVEMENT).max(MAX_MOVEMENT).refine((v) => v !== 0, 'Enter a quantity'), reason }),
  target: () => TILL,
  run: (ctx, input) => {
    const { pos, restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      await adjustStock(delegates(tx), restaurantId, pos.userId, input);
      ctx.audit({ action: 'pos.stock.adjust', entityType: 'PosInventoryItem', entityId: input.itemId, changes: { quantity: { before: null, after: input.quantity }, reason: { before: null, after: input.reason } } });
      return { itemId: input.itemId };
    });
  },
});

export const recordPosWaste = defineAction({
  name: 'pos.recordWaste',
  permission: null,
  pos: 'inventory.manage',
  input: z.object({ itemId: idField, quantity, reason }),
  target: () => TILL,
  run: (ctx, input) => {
    const { pos, restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      await recordWaste(delegates(tx), restaurantId, pos.userId, input);
      ctx.audit({ action: 'pos.stock.waste', entityType: 'PosInventoryItem', entityId: input.itemId, changes: { quantity: { before: null, after: input.quantity }, reason: { before: null, after: input.reason } } });
      return { itemId: input.itemId };
    });
  },
});

export const recordPosStockCount = defineAction({
  name: 'pos.recordStockCount',
  permission: null,
  pos: 'inventory.manage',
  input: z.object({
    note: z.string().trim().max(300, 'Use at most 300 characters').default(''),
    lines: z.array(z.object({ itemId: idField, counted: z.number().int().min(0).max(MAX_MOVEMENT) })).min(1).max(500),
  }),
  target: () => TILL,
  run: (ctx, input) => {
    const { pos, restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      const done = await recordStockCount(delegates(tx), restaurantId, pos.userId, input);
      ctx.audit({ action: 'pos.stock.count', entityType: 'PosStockCount', entityId: done.countId, changes: { lines: { before: null, after: input.lines.length }, changed: { before: null, after: done.changed } } });
      return done;
    });
  },
});

export const setPosRecipe = defineAction({
  name: 'pos.setRecipe',
  permission: null,
  pos: 'inventory.manage',
  input: z.object({ productId: idField, lines: z.array(z.object({ itemId: idField, quantity })).max(30) }),
  target: () => CATALOG,
  run: (ctx, input) => {
    const { restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      const done = await setRecipe(delegates(tx), restaurantId, input.productId, input.lines);
      if (done.changed) ctx.audit({ action: 'pos.recipe.set', entityType: 'Product', entityId: input.productId, changes: { lines: { before: done.before, after: done.after } } });
      return { productId: input.productId };
    });
  },
});

export const createPosSupplier = defineAction({
  name: 'pos.createSupplier',
  permission: null,
  pos: 'purchase.manage',
  input: z.object({ name, phone: phoneField(true).default(''), notes: z.string().trim().max(300, 'Use at most 300 characters').default('') }),
  target: () => TILL,
  run: (ctx, input) => {
    const { restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      const supplierId = await createSupplier(delegates(tx), restaurantId, input);
      ctx.audit({ action: 'pos.supplier.create', entityType: 'PosSupplier', entityId: supplierId, changes: { name: { before: null, after: input.name } } });
      return { supplierId };
    });
  },
});

export const updatePosSupplier = defineAction({
  name: 'pos.updateSupplier',
  permission: null,
  pos: 'purchase.manage',
  input: z
    .object({ supplierId: idField, name: name.optional(), phone: phoneField(true).optional(), notes: z.string().trim().max(300, 'Use at most 300 characters').optional(), active: z.boolean().optional() })
    .refine((v) => v.name !== undefined || v.phone !== undefined || v.notes !== undefined || v.active !== undefined, { message: 'Nothing to change', path: ['name'] }),
  target: () => TILL,
  run: (ctx, { supplierId, ...fields }) => {
    const { restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      const done = await updateSupplier(delegates(tx), restaurantId, supplierId, fields);
      if (done.changed) {
        const changes: Record<string, { before: unknown; after: unknown }> = {};
        for (const key of Object.keys(done.after)) changes[key] = { before: done.before[key], after: done.after[key] };
        ctx.audit({ action: 'pos.supplier.update', entityType: 'PosSupplier', entityId: supplierId, changes });
      }
      return { supplierId };
    });
  },
});

export const createPosPurchase = defineAction({
  name: 'pos.createPurchase',
  permission: null,
  pos: 'purchase.manage',
  input: z.object({
    clientKey: z.uuid(),
    supplierId: idField,
    invoiceDay: day,
    number: z
      .string()
      .trim()
      .max(60, 'Use at most 60 characters')
      .transform((value) => (value === '' ? undefined : value))
      .optional(),
    note: z.string().trim().max(300, 'Use at most 300 characters').default(''),
    paidMethod: z.enum(SUPPLIER_PAY_METHODS).optional(),
    lines: z.array(z.object({ itemId: idField, quantity, lineTotal: z.number().int().min(0).max(INT32) })).min(1).max(100),
  }),
  target: () => TILL,
  run: (ctx, input) => {
    const { pos, restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      const done = await createPurchaseInvoice(delegates(tx), restaurantId, pos.userId, input);
      ctx.audit({
        action: 'pos.purchase.create',
        entityType: 'PosPurchaseInvoice',
        entityId: done.invoiceId,
        changes: { supplierId: { before: null, after: input.supplierId }, invoiceDay: { before: null, after: input.invoiceDay }, total: { before: null, after: done.total }, lines: { before: null, after: done.lines }, paid: { before: null, after: done.paid } },
      });
      return { invoiceId: done.invoiceId };
    });
  },
});

export const voidPosPurchase = defineAction({
  name: 'pos.voidPurchase',
  permission: null,
  pos: 'purchase.manage',
  input: z.object({ invoiceId: idField, reason }),
  target: () => TILL,
  run: (ctx, input) => {
    const { pos, restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      const done = await voidPurchaseInvoice(delegates(tx), restaurantId, pos.userId, input.invoiceId, input.reason);
      ctx.audit({ action: 'pos.purchase.void', entityType: 'PosPurchaseInvoice', entityId: input.invoiceId, changes: { total: { before: done.total, after: null }, reason: { before: null, after: input.reason } } });
      return { invoiceId: input.invoiceId };
    });
  },
});

export const setPosPurchasePaid = defineAction({
  name: 'pos.setPurchasePaid',
  permission: null,
  pos: 'purchase.manage',
  input: z.object({ invoiceId: idField, paid: z.boolean(), method: z.enum(SUPPLIER_PAY_METHODS).optional() }),
  target: () => TILL,
  run: (ctx, input) => {
    const { restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      const done = await setPurchasePaid(delegates(tx), restaurantId, input.invoiceId, { paid: input.paid, method: input.method });
      if (done.changed) ctx.audit({ action: 'pos.purchase.paid', entityType: 'PosPurchaseInvoice', entityId: input.invoiceId, changes: { paid: { before: done.from, after: done.to }, ...(done.method ? { method: { before: null, after: done.method } } : {}) } });
      return { invoiceId: input.invoiceId };
    });
  },
});
