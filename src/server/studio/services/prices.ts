import { z } from 'zod';
import type { PrismaClient } from '@/generated/prisma/client';
import { MAX_MINOR } from '@/lib/money-input';
import type { ScopedTx } from '@/server/data/tenant-db';
import { menuPriceStep, planBulkPrices, type BulkOperation, type BulkProduct, type PriceRow } from '@/server/domain/bulk-prices';
import type { ActionContext } from '@/server/studio/framework/action';
import { updateWithVersion } from '@/server/studio/framework/concurrency';
import { StudioError } from '@/server/studio/framework/result';
import { idField, priceField, textsOf, type Names } from './content';
import { editDraft } from './draft-edit';

/**
 * The Prices tab (spec 10.3, 13.4): one price at a time at its row's version, or many at once from a preview. A size's
 * price is shown and typed as its own price and stored as its difference from the product's base price.
 */

// Fields --------------------------------------------------------------------------------------------------------------

export const bulkOperationField = z.discriminatedUnion(
  'kind',
  [
    z.object({ kind: z.literal('set'), amount: priceField }),
    z.object({ kind: z.literal('add'), amount: z.number().int().min(-MAX_MINOR, 'This price is too high').max(MAX_MINOR, 'This price is too high') }),
    z.object({ kind: z.literal('percent'), basisPoints: z.number().int().min(-9_999, 'Use a percentage above -100').max(100_000, 'Use at most 1,000%') }),
  ],
  'Choose one of the changes offered',
);

export const selectionField = z.object({
  productIds: z.array(idField).max(2_000).optional(),
  categoryId: idField.optional(),
});

export const bulkFields = { selection: selectionField, operation: bulkOperationField, includeVariants: z.boolean() };

type Selection = z.infer<typeof selectionField>;

// Reading -------------------------------------------------------------------------------------------------------------

/** A client that reads the menu's rows: the transaction's scoped client, or the application's with the menu named. */
type Reader = ScopedTx | PrismaClient;

interface SelectedProduct extends BulkProduct {
  names: Names;
  variants: Array<{ id: string; priceDelta: number; names: Names }>;
}

/**
 * The products a bulk change covers, in the menu's order (category, then product): those listed, those of a category,
 * both (the listed ones in that category), or every product of the menu when the selection names neither. An id that
 * is not the menu's is `NOT_FOUND`.
 */
async function selectedProducts(db: Reader, menuId: string, selection: Selection): Promise<SelectedProduct[]> {
  const client = db as PrismaClient;
  if (selection.categoryId !== undefined) {
    const category = await client.category.findFirst({ where: { id: selection.categoryId, menuId }, select: { id: true } });
    if (!category) throw new StudioError('NOT_FOUND');
  }
  const ids = selection.productIds === undefined ? undefined : [...new Set(selection.productIds)];
  const rows = await client.product.findMany({
    where: {
      menuId,
      ...(ids ? { id: { in: ids } } : {}),
      ...(selection.categoryId !== undefined ? { categoryId: selection.categoryId } : {}),
    },
    select: {
      id: true,
      basePrice: true,
      translations: true,
      sortOrder: true,
      category: { select: { sortOrder: true } },
      variants: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: { id: true, priceDelta: true, translations: true } },
    },
  });
  if (ids && selection.categoryId === undefined && rows.length !== ids.length) throw new StudioError('NOT_FOUND');
  if (ids && selection.categoryId !== undefined) {
    const inMenu = await client.product.count({ where: { menuId, id: { in: ids } } });
    if (inMenu !== ids.length) throw new StudioError('NOT_FOUND');
  }
  return rows
    .sort((x, y) => x.category.sortOrder - y.category.sortOrder || x.sortOrder - y.sortOrder || (x.id < y.id ? -1 : 1))
    .map((row) => ({
      id: row.id,
      basePrice: row.basePrice,
      names: textsOf(row.translations, 'name'),
      variants: row.variants.map((variant) => ({ id: variant.id, priceDelta: variant.priceDelta, names: textsOf(variant.translations, 'name') })),
    }));
}

async function menuOf(db: Reader, menuId: string) {
  const menu = await (db as PrismaClient).menu.findFirst({
    where: { id: menuId },
    select: { draftHash: true, priceStep: true, currency: true, defaultLocale: true, locales: true, numeralSystem: true },
  });
  if (!menu) throw new StudioError('NOT_FOUND');
  return menu;
}

export interface BulkPreview {
  rows: Array<PriceRow & { name: string; variantName: string | null }>;
  step: number;
  draftHash: string;
}

/** What a bulk change would do to every price it covers, with the draft's hash to apply it against. */
export async function previewBulk(
  db: PrismaClient,
  menuId: string,
  input: { selection: Selection; operation: BulkOperation; includeVariants: boolean },
): Promise<BulkPreview> {
  const menu = await menuOf(db, menuId);
  const products = await selectedProducts(db, menuId, input.selection);
  const step = menuPriceStep(menu);
  const plan = planBulkPrices(products, input.operation, { includeVariants: input.includeVariants, step });
  const name = (names: Names) => names[menu.defaultLocale as keyof Names] ?? Object.values(names)[0] ?? '';
  const byId = new Map(products.map((product) => [product.id, product]));
  return {
    rows: plan.rows.map((row) => {
      const product = byId.get(row.productId)!;
      const variant = row.variantId === null ? null : product.variants.find((entry) => entry.id === row.variantId)!;
      return { ...row, name: name(product.names), variantName: variant ? name(variant.names) : null };
    }),
    step,
    draftHash: menu.draftHash ?? '',
  };
}

export interface PriceGrid {
  currency: string;
  locales: string[];
  defaultLocale: string;
  numeralSystem: string;
  step: number;
  categories: Array<{
    id: string;
    names: Names;
    products: Array<{ id: string; names: Names; price: number; version: number; variants: Array<{ id: string; names: Names; price: number; version: number }> }>;
  }>;
}

/** Every price of the menu by category: each product's own and each size's own, with the versions to save them at. */
export async function priceGrid(db: PrismaClient, menuId: string): Promise<PriceGrid> {
  const menu = await menuOf(db, menuId);
  const order = [{ sortOrder: 'asc' as const }, { id: 'asc' as const }];
  const categories = await db.category.findMany({ where: { menuId }, orderBy: order, select: { id: true, translations: true } });
  const products = await db.product.findMany({
    where: { menuId },
    orderBy: order,
    select: {
      id: true,
      categoryId: true,
      translations: true,
      basePrice: true,
      version: true,
      variants: { orderBy: order, select: { id: true, translations: true, priceDelta: true, version: true } },
    },
  });
  return {
    currency: menu.currency,
    locales: menu.locales,
    defaultLocale: menu.defaultLocale,
    numeralSystem: menu.numeralSystem,
    step: menuPriceStep(menu),
    categories: categories.map((category) => ({
      id: category.id,
      names: textsOf(category.translations, 'name'),
      products: products
        .filter((product) => product.categoryId === category.id)
        .map((product) => ({
          id: product.id,
          names: textsOf(product.translations, 'name'),
          price: product.basePrice,
          version: product.version,
          variants: product.variants.map((variant) => ({
            id: variant.id,
            names: textsOf(variant.translations, 'name'),
            price: product.basePrice + variant.priceDelta,
            version: variant.version,
          })),
        })),
    })),
  };
}

// Writing -------------------------------------------------------------------------------------------------------------

/** One price, at the version of its row: a product's base price, or a size's own price (stored as its difference). */
export function setPrice(
  ctx: ActionContext,
  input: { target: { kind: 'product' | 'variant'; id: string; version: number }; price: number },
): Promise<{ version: number }> {
  return editDraft(ctx, async (tx) => {
    const { target, price } = input;
    if (target.kind === 'product') {
      const row = await tx.product.findFirst({ where: { id: target.id }, select: { id: true, basePrice: true } });
      if (!row) throw new StudioError('NOT_FOUND');
      await updateWithVersion(tx.product, { id: row.id, version: target.version, data: { basePrice: price }, entityType: 'Product' }, tx);
      ctx.audit({ action: 'price.changed', entityType: 'Product', entityId: row.id, changes: { price: { before: row.basePrice, after: price } } });
    } else {
      const row = await tx.productVariant.findFirst({ where: { id: target.id }, select: { id: true, priceDelta: true, productId: true } });
      if (!row) throw new StudioError('NOT_FOUND');
      const product = await tx.product.findFirst({ where: { id: row.productId }, select: { basePrice: true } });
      if (!product) throw new StudioError('NOT_FOUND');
      await updateWithVersion(
        tx.productVariant,
        { id: row.id, version: target.version, data: { priceDelta: price - product.basePrice }, entityType: 'ProductVariant' },
        tx,
      );
      ctx.audit({
        action: 'price.changed',
        entityType: 'ProductVariant',
        entityId: row.id,
        changes: { price: { before: product.basePrice + row.priceDelta, after: price } },
      });
    }
    return { version: target.version + 1 };
  });
}

/**
 * A bulk change, recomputed inside the transaction from the draft as it stands. It applies only to the draft the person
 * previewed (`CONFLICT` once its hash has moved) and only when no price would fall to zero or below (`INVALID`); every
 * changed row's version moves, so a drawer opened before it cannot save over it.
 */
export function applyBulk(
  ctx: ActionContext,
  input: { selection: Selection; operation: BulkOperation; includeVariants: boolean; expectedDraftHash: string },
): Promise<{ changed: number }> {
  return editDraft(ctx, async (tx, menuId) => {
    const menu = await menuOf(tx, menuId);
    // The selection first: an id of another menu is not found, whatever the draft did meanwhile.
    const products = await selectedProducts(tx, menuId, input.selection);
    if ((menu.draftHash ?? '') !== input.expectedDraftHash) throw new StudioError('CONFLICT');
    const plan = planBulkPrices(products, input.operation, { includeVariants: input.includeVariants, step: menuPriceStep(menu) });
    if (plan.rows.some((row) => row.problem)) throw new StudioError('INVALID', 'Some prices would fall to zero or below. Change the amount.');

    for (const product of plan.products) {
      await tx.product.updateMany({ where: { id: product.id }, data: { basePrice: product.basePrice, version: { increment: 1 } } });
    }
    for (const variant of plan.variants) {
      await tx.productVariant.updateMany({ where: { id: variant.id }, data: { priceDelta: variant.priceDelta, version: { increment: 1 } } });
    }
    const changed = plan.products.length + plan.variants.length;
    ctx.audit({
      action: 'prices.bulk_changed',
      entityType: 'MenuPrices',
      entityId: menuId,
      changes: {
        operation: { before: null, after: input.operation },
        count: { before: null, after: changed },
        includeVariants: { before: null, after: input.includeVariants },
      },
    });
    return { changed };
  });
}
