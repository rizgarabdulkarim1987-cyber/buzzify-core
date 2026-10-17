import { z } from 'zod';
import { defineAction } from '@/server/studio/framework/action';
import * as content from '@/server/studio/services/content';
import { contentSlugField, idField, namesField, priceField, productSaveFields } from '@/server/studio/services/content';

/**
 * The Content tab's changes to a menu's draft (spec 10.3): its categories and products, with their sizes, option
 * groups, tags and pictures. All need `content.edit`; a price other than zero also needs `content.prices`, which the
 * service checks against what the change does.
 */

const atMenu = (menuId: string) => ({ kind: 'menu', menuId }) as const;
const version = z.number().int().min(1);

// Categories ----------------------------------------------------------------------------------------------------------

export const createCategory = defineAction({
  name: 'content.createCategory',
  permission: 'content.edit',
  input: z.object({ menuId: idField, names: namesField, slug: contentSlugField.optional() }),
  target: (i) => atMenu(i.menuId),
  run: (ctx, { names, slug }) => content.createCategory(ctx, { names, slug }),
});

export const updateCategory = defineAction({
  name: 'content.updateCategory',
  permission: 'content.edit',
  input: z.object({ menuId: idField, categoryId: idField, version, names: namesField, slug: contentSlugField, isActive: z.boolean() }),
  target: (i) => atMenu(i.menuId),
  run: (ctx, input) => content.updateCategory(ctx, input),
});

export const deleteCategory = defineAction({
  name: 'content.deleteCategory',
  permission: 'content.edit',
  input: z.object({ menuId: idField, categoryId: idField, version }),
  target: (i) => atMenu(i.menuId),
  run: (ctx, input) => content.deleteCategory(ctx, input),
});

export const reorderCategories = defineAction({
  name: 'content.reorderCategories',
  permission: 'content.edit',
  input: z.object({ menuId: idField, order: z.array(idField).min(1).max(500) }),
  target: (i) => atMenu(i.menuId),
  run: (ctx, input) => content.reorderCategories(ctx, input),
});

// Products ------------------------------------------------------------------------------------------------------------

export const createProduct = defineAction({
  name: 'content.createProduct',
  permission: 'content.edit',
  input: z.object({ menuId: idField, categoryId: idField, names: namesField, price: priceField }),
  target: (i) => atMenu(i.menuId),
  run: (ctx, input) => content.createProduct(ctx, input),
});

export const saveProduct = defineAction({
  name: 'content.saveProduct',
  permission: 'content.edit',
  input: z.object({ menuId: idField, ...productSaveFields }),
  target: (i) => atMenu(i.menuId),
  run: (ctx, input) => content.saveProduct(ctx, input),
});

export const deleteProduct = defineAction({
  name: 'content.deleteProduct',
  permission: 'content.edit',
  input: z.object({ menuId: idField, productId: idField, version }),
  target: (i) => atMenu(i.menuId),
  run: (ctx, input) => content.deleteProduct(ctx, input),
});

export const moveProduct = defineAction({
  name: 'content.moveProduct',
  permission: 'content.edit',
  input: z.object({ menuId: idField, productId: idField, categoryId: idField, index: z.number().int().min(0).max(10_000) }),
  target: (i) => atMenu(i.menuId),
  run: (ctx, input) => content.moveProduct(ctx, input),
});
