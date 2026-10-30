import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { canonicalSet } from '@/lib/canonical';
import { LOCALES, type Locale } from '@/lib/locale';
import { parseMedia, type DraftMediaItem } from '@/lib/media';
import { MAX_MINOR } from '@/lib/money-input';
import { ALLERGENS, BADGES, DIETARY_TAGS, type Allergen, type Badge, type DietaryTag } from '@/lib/product-tags';
import type { TranslationMap } from '@/server/domain/types';
import type { ScopedTx } from '@/server/data/tenant-db';
import { normalizeSlugInput, SLUG_MAX } from '@/server/domain/slug';
import { loadAssets, mediaAssetIds } from '@/server/media/resolve';
import type { ActionContext } from '@/server/studio/framework/action';
import { deleteWithVersion, updateWithVersion } from '@/server/studio/framework/concurrency';
import { StudioError } from '@/server/studio/framework/result';
import { editDraft } from './draft-edit';
import { isUniqueViolation } from './menus';

/**
 * Editing a menu's categories and products (spec 10.3, the Content tab). Every change goes through `editDraft`, so the
 * draft's hash stays current; guests see nothing until a publish. A row the person edited is saved only at the version
 * they started from (`updateWithVersion`); reordering and moving renumber rows without moving their versions.
 */

// Fields --------------------------------------------------------------------------------------------------------------

export const NAME_MAX = 120;
export const DESCRIPTION_MAX = 1_000;
export const CALORIES_MAX = 20_000;

const nameText = z.string().trim().max(NAME_MAX, 'Use at most 120 characters');
const descriptionText = z.string().trim().max(DESCRIPTION_MAX, 'Use at most 1,000 characters');

/** A text in each of the three languages, any of them left out. Empty after trimming counts as left out. */
const texts = (text: z.ZodString) => z.object({ en: text.optional(), ar: text.optional(), ckb: text.optional() });
export const namesField = texts(nameText);
export const descriptionsField = texts(descriptionText);
export type Texts = z.infer<typeof namesField>;

export const idField = z.string().min(1).max(100);

const SLUG_SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const contentSlugField = z
  .string()
  .trim()
  .max(SLUG_MAX, 'Use at most 48 characters')
  .regex(SLUG_SHAPE, 'Use lowercase letters, digits and single hyphens');

export const priceField = z
  .number()
  .int()
  .min(0, 'Enter a price of zero or more')
  .max(MAX_MINOR, 'This price is too high');
const deltaField = z.number().int().min(-MAX_MINOR, 'This makes the price below zero').max(MAX_MINOR, 'This price is too high');

const assetEntry = z.object({ kind: z.literal('asset'), assetId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) });
/** A library asset by id, or anything guests can be shown as it is (checked as the public menu reads it). */
const mediaEntry = z.union([
  assetEntry,
  z.custom<DraftMediaItem>((value) => parseMedia([value]).length === 1, 'This picture cannot be used').transform((value) => parseMedia([value])[0]!),
]);

/** A row the person had open: both its id and the version they read, or neither for a new row. */
const rowRef = {
  id: idField.optional(),
  version: z.number().int().min(1).optional(),
};
const sameRef = (row: { id?: string; version?: number }) => (row.id === undefined) === (row.version === undefined);

const variantInput = z.object({ ...rowRef, names: namesField, priceDelta: deltaField, isDefault: z.boolean() }).refine(sameRef);
const optionInput = z.object({ ...rowRef, names: namesField, priceDelta: deltaField, isSuggested: z.boolean() }).refine(sameRef);
const groupInput = z
  .object({
    ...rowRef,
    names: namesField,
    minSelect: z.number().int().min(0, 'Use 0 or more').max(50),
    maxSelect: z.number().int().min(1, 'Use at least 1').max(50),
    options: z.array(optionInput).max(50, 'Use at most 50 options'),
  })
  .refine(sameRef);

export const productSaveFields = {
  productId: idField,
  version: z.number().int().min(1),
  slug: contentSlugField,
  categoryId: idField,
  names: namesField,
  descriptions: descriptionsField,
  ingredients: z
    .partialRecord(z.enum(LOCALES), z.array(z.string().trim().min(1).max(NAME_MAX, 'Use at most 120 characters')).max(50, 'Use at most 50 ingredients'))
    .optional(),
  price: priceField,
  isSignature: z.boolean(),
  isFeatured: z.boolean(),
  allergens: z.array(z.enum(ALLERGENS, 'Choose from the allergens offered')).max(ALLERGENS.length * 2),
  dietary: z.array(z.enum(DIETARY_TAGS, 'Choose from the tags offered')).max(DIETARY_TAGS.length * 2),
  badges: z.array(z.enum(BADGES, 'Choose from the badges offered')).max(BADGES.length * 2),
  calories: z.number().int().min(0, 'Enter a number from 0 to 20,000').max(CALORIES_MAX, 'Enter a number from 0 to 20,000').nullable(),
  media: z.array(mediaEntry).max(12, 'Use at most 12 pictures'),
  variants: z.array(variantInput).max(20, 'Use at most 20 sizes'),
  groups: z.array(groupInput).max(20, 'Use at most 20 option groups'),
  // The sales tools' fields (docs/superpowers/specs/2026-10-18-sales-tools-design.md, goal 3). A save that leaves one
  // out keeps what the product has.
  cost: priceField.nullable().optional(),
  // The drawer offers normal, high and top (50, 75, 100); a product saved before keeps whatever it holds (0 to 100).
  priority: z.number().int().min(0, 'Choose normal, high or top').max(100, 'Choose normal, high or top').optional(),
  serves: z.number().int().min(2, 'Use 2 to 20 people').max(20, 'Use 2 to 20 people').nullable().optional(),
  lowStockThreshold: z.number().int().min(1, 'Use 1 to 999').max(999, 'Use 1 to 999').nullable().optional(),
};
export type ProductSave = z.infer<z.ZodObject<typeof productSaveFields>>;

// What the Content tab reads ------------------------------------------------------------------------------------------

export type Names = Partial<Record<Locale, string>>;

export interface ContentTree {
  locales: Locale[];
  defaultLocale: Locale;
  currency: string;
  numeralSystem: string;
  categories: Array<{
    id: string;
    slug: string;
    version: number;
    names: Names;
    isActive: boolean;
    missing: Locale[];
    products: Array<{
      id: string;
      slug: string;
      version: number;
      names: Names;
      price: number;
      isAvailable: boolean;
      isHidden: boolean;
      isSignature: boolean;
      isFeatured: boolean;
      badges: Badge[];
      thumbUrl: string | null;
      missing: Locale[];
    }>;
  }>;
}

export interface ProductEditing {
  id: string;
  version: number;
  slug: string;
  categoryId: string;
  names: Names;
  descriptions: Names;
  ingredients: Partial<Record<Locale, string[]>>;
  price: number;
  isSignature: boolean;
  isFeatured: boolean;
  allergens: Allergen[];
  dietary: DietaryTag[];
  badges: Badge[];
  calories: number | null;
  /** What one costs the restaurant to make, in minor units, or null when not entered. */
  cost: number | null;
  /** How strongly the menu promotes it: 50 normal, 75 high, 100 top. */
  priority: number;
  serves: number | null;
  /** "Only a few left" shows at or below this many portions left. */
  lowStockThreshold: number | null;
  media: Array<{ value: DraftMediaItem; thumbUrl: string | null }>;
  variants: Array<{ id: string; version: number; names: Names; priceDelta: number; isDefault: boolean }>;
  groups: Array<{
    id: string;
    version: number;
    names: Names;
    minSelect: number;
    maxSelect: number;
    options: Array<{ id: string; version: number; names: Names; priceDelta: number; isSuggested: boolean }>;
  }>;
  /** The menu's languages each text has nothing in. */
  missing: { names: Locale[]; descriptions: Locale[] };
}

// Texts ---------------------------------------------------------------------------------------------------------------

/** The texts with something in them, in the languages' order. */
export function present(values: Texts | undefined): Partial<Record<Locale, string>> {
  const result: Partial<Record<Locale, string>> = {};
  for (const locale of LOCALES) {
    const value = values?.[locale]?.trim();
    if (value) result[locale] = value;
  }
  return result;
}

/** One field of a row's translations (`name`, `description`) for each language. */
export function textsOf(translations: unknown, field: string): Partial<Record<Locale, string>> {
  const map = (translations ?? {}) as TranslationMap;
  const result: Partial<Record<Locale, string>> = {};
  for (const locale of LOCALES) {
    const value = map[locale]?.[field];
    if (typeof value === 'string' && value !== '') result[locale] = value;
  }
  return result;
}

/**
 * The translations with `fields` written in: each given field replaces its value in every language (a language left
 * out loses it), other fields stay. A language left with nothing is dropped.
 */
export function withTexts(translations: unknown, fields: Record<string, Texts | undefined>): Prisma.InputJsonObject {
  const before = (translations ?? {}) as TranslationMap;
  const after: Record<string, Record<string, string>> = {};
  for (const locale of LOCALES) {
    const entry: Record<string, string> = { ...(before[locale] ?? {}) };
    for (const [field, values] of Object.entries(fields)) {
      if (values === undefined) continue;
      const value = present(values)[locale];
      if (value === undefined) delete entry[field];
      else entry[field] = value;
    }
    if (Object.keys(entry).length > 0) after[locale] = entry;
  }
  return after;
}

/** The menu's languages that `names` has no text in. */
export function missingIn(locales: readonly Locale[], names: Partial<Record<Locale, string>>): Locale[] {
  return locales.filter((locale) => !names[locale]);
}

// Slugs ---------------------------------------------------------------------------------------------------------------

/** `base`, else `base-2`, `base-3`, … whichever is not taken, cut so the suffix fits the length limit. */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/, '')}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** A slug from the English name (else the first name given), or `fallback` when it has no Latin letters or digits. */
export function slugFromNames(names: Texts, fallback: string): string {
  const texts = present(names);
  const source = texts.en ?? Object.values(texts)[0] ?? '';
  return normalizeSlugInput(source).slice(0, SLUG_MAX).replace(/-+$/, '') || fallback;
}

const slugTaken = () => new StudioError('INVALID', undefined, { slug: 'This address is taken' });

/** Runs a write that sets a slug, turning a race for the same slug into the field's refusal. */
async function claimingSlug<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (isUniqueViolation(error)) throw slugTaken();
    throw error;
  }
}

// Offers --------------------------------------------------------------------------------------------------------------

/**
 * Takes a dish or a category that is going out of every offer that names it, moving each offer's version on; an offer
 * left naming nothing is deleted, as it could never show again.
 */
async function dropFromOffers(tx: ScopedTx, field: 'productIds' | 'categoryIds', id: string): Promise<void> {
  const offers = await tx.promotion.findMany({ where: { [field]: { has: id } }, select: { id: true, productIds: true, categoryIds: true } });
  for (const offer of offers) {
    const productIds = offer.productIds.filter((entry) => entry !== id);
    const categoryIds = offer.categoryIds.filter((entry) => entry !== id);
    if (productIds.length + categoryIds.length === 0) await tx.promotion.deleteMany({ where: { id: offer.id } });
    else await tx.promotion.updateMany({ where: { id: offer.id }, data: { productIds, categoryIds, version: { increment: 1 } } });
  }
}

// Categories ----------------------------------------------------------------------------------------------------------

export function createCategory(ctx: ActionContext, input: { names: Texts; slug?: string | undefined }): Promise<{ categoryId: string }> {
  return editDraft(ctx, async (tx, menuId) => {
    const rows = await tx.category.findMany({ select: { slug: true, sortOrder: true } });
    const taken = new Set(rows.map((row) => row.slug));
    if (input.slug !== undefined && taken.has(input.slug)) throw slugTaken();
    const slug = input.slug ?? uniqueSlug(slugFromNames(input.names, 'category'), taken);
    const sortOrder = rows.reduce((max, row) => Math.max(max, row.sortOrder + 1), 0);
    const translations = withTexts({}, { name: input.names });
    const row = await claimingSlug(() => tx.category.create({ data: { menuId, slug, sortOrder, translations }, select: { id: true } }));
    ctx.audit({
      action: 'category.created',
      entityType: 'Category',
      entityId: row.id,
      changes: { names: { before: null, after: present(input.names) }, slug: { before: null, after: slug } },
    });
    return { categoryId: row.id };
  });
}

export function updateCategory(
  ctx: ActionContext,
  input: { categoryId: string; version: number; names: Texts; slug: string; isActive: boolean },
): Promise<{ version: number }> {
  return editDraft(ctx, async (tx) => {
    const row = await tx.category.findFirst({ where: { id: input.categoryId } });
    if (!row) throw new StudioError('NOT_FOUND');
    if (input.slug !== row.slug && (await tx.category.findFirst({ where: { slug: input.slug, id: { not: row.id } }, select: { id: true } }))) {
      throw slugTaken();
    }
    const translations = withTexts(row.translations, { name: input.names });
    await claimingSlug(() =>
      updateWithVersion(
        tx.category,
        { id: row.id, version: input.version, data: { slug: input.slug, isActive: input.isActive, translations }, entityType: 'Category' },
        tx,
      ),
    );
    ctx.audit({
      action: 'category.updated',
      entityType: 'Category',
      entityId: row.id,
      changes: changed({
        names: [textsOf(row.translations, 'name'), present(input.names)],
        slug: [row.slug, input.slug],
        isActive: [row.isActive, input.isActive],
      }),
    });
    return { version: input.version + 1 };
  });
}

export function deleteCategory(ctx: ActionContext, input: { categoryId: string; version: number }): Promise<{ deleted: true }> {
  return editDraft(ctx, async (tx) => {
    const row = await tx.category.findFirst({ where: { id: input.categoryId } });
    if (!row) throw new StudioError('NOT_FOUND');
    if ((await tx.product.count({ where: { categoryId: row.id } })) > 0) {
      throw new StudioError('INVALID', 'Move or delete its products first');
    }
    await deleteWithVersion(tx.category, { id: row.id, version: input.version, entityType: 'Category' }, tx);
    await dropFromOffers(tx, 'categoryIds', row.id);
    // A pairing names its source category by id alone, so nothing else removes the pairings of a category that goes.
    await tx.pairingRule.deleteMany({ where: { sourceCategoryId: row.id } });
    ctx.audit({
      action: 'category.deleted',
      entityType: 'Category',
      entityId: row.id,
      changes: { names: { before: textsOf(row.translations, 'name'), after: null }, slug: { before: row.slug, after: null } },
    });
    return { deleted: true };
  });
}

export function reorderCategories(ctx: ActionContext, input: { order: string[] }): Promise<{ reordered: true }> {
  return editDraft(ctx, async (tx, menuId) => {
    const rows = await tx.category.findMany({ select: { id: true, sortOrder: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
    const ids = new Set(rows.map((row) => row.id));
    if (input.order.some((id) => !ids.has(id))) throw new StudioError('NOT_FOUND');
    if (input.order.length !== rows.length || new Set(input.order).size !== rows.length) {
      throw new StudioError('INVALID', 'The categories changed while you were editing. Reload to see them.');
    }

    const current = new Map(rows.map((row) => [row.id, row.sortOrder]));
    for (const [index, id] of input.order.entries()) {
      if (current.get(id) !== index) await tx.category.updateMany({ where: { id }, data: { sortOrder: index } });
    }
    const before = rows.map((row) => row.id);
    if (JSON.stringify(before) !== JSON.stringify(input.order)) {
      // Filed apart from the menu and from each category (a reorder moves no version), so a refused save of either
      // names who changed that row, never someone who only reordered.
      ctx.audit({ action: 'category.reordered', entityType: 'CategoryOrder', entityId: menuId, changes: { order: { before, after: input.order } } });
    }
    return { reordered: true };
  });
}

// Products ------------------------------------------------------------------------------------------------------------

/** A price other than zero is a price decision: it needs `content.prices`. */
function requirePrices(ctx: ActionContext): void {
  if (!ctx.permissions.has('content.prices')) throw new StudioError('FORBIDDEN');
}

export function createProduct(
  ctx: ActionContext,
  input: { categoryId: string; names: Texts; price: number },
): Promise<{ productId: string }> {
  if (input.price !== 0) requirePrices(ctx);
  return editDraft(ctx, async (tx, menuId) => {
    const category = await tx.category.findFirst({ where: { id: input.categoryId }, select: { id: true } });
    if (!category) throw new StudioError('NOT_FOUND');
    const taken = new Set((await tx.product.findMany({ select: { slug: true } })).map((row) => row.slug));
    const slug = uniqueSlug(slugFromNames(input.names, 'product'), taken);
    const last = await tx.product.aggregate({ where: { categoryId: category.id }, _max: { sortOrder: true } });
    const sortOrder = last._max.sortOrder === null ? 0 : last._max.sortOrder + 1;
    const row = await claimingSlug(() =>
      tx.product.create({
        data: { menuId, categoryId: category.id, slug, sortOrder, basePrice: input.price, translations: withTexts({}, { name: input.names }) },
        select: { id: true },
      }),
    );
    ctx.audit({
      action: 'product.created',
      entityType: 'Product',
      entityId: row.id,
      changes: { names: { before: null, after: present(input.names) }, price: { before: null, after: input.price } },
    });
    return { productId: row.id };
  });
}

export type Changes = Record<string, { before: unknown; after: unknown }>;

/** The pairs whose two sides differ, for an audit row. */
export function changed(pairs: Record<string, [unknown, unknown]>): Changes {
  const changes: Changes = {};
  for (const [field, [before, after]] of Object.entries(pairs)) {
    if (JSON.stringify(before) !== JSON.stringify(after)) changes[field] = { before, after };
  }
  return changes;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The rules ProductSave's fields cannot state alone, as per-field messages; empty when it may be saved. */
function productProblems(input: ProductSave): Record<string, string> {
  const fields: Record<string, string> = {};
  if (input.variants.length > 0 && input.variants.filter((variant) => variant.isDefault).length !== 1) {
    fields.variants = 'Choose exactly one default size';
  }
  input.variants.forEach((variant, index) => {
    if (input.price + variant.priceDelta < 0) fields[`variants.${index}.priceDelta`] = 'This makes the price below zero';
  });
  input.groups.forEach((group, index) => {
    if (group.minSelect > group.options.length) fields[`groups.${index}.minSelect`] = 'Use at most the number of options';
    if (group.maxSelect > group.options.length) fields[`groups.${index}.maxSelect`] = 'Use at most the number of options';
    else if (group.maxSelect < group.minSelect) fields[`groups.${index}.maxSelect`] = 'Use at least the minimum';
  });
  return fields;
}

export interface SavedProduct {
  version: number;
  variants: Array<{ id: string; version: number }>;
  groups: Array<{ id: string; version: number; options: Array<{ id: string; version: number }> }>;
}

/** A child row as the product has it, and as the save sends it. */
interface Child {
  id: string;
  version: number;
}

/** The existing row an input row names: `NOT_FOUND` when the id is not one of `rows` (another product's, say). */
function existing<T extends Child>(rows: readonly T[], id: string | undefined): T | null {
  if (id === undefined) return null;
  const row = rows.find((candidate) => candidate.id === id);
  if (!row) throw new StudioError('NOT_FOUND');
  return row;
}

export function saveProduct(ctx: ActionContext, input: ProductSave): Promise<SavedProduct> {
  const problems = productProblems(input);
  if (Object.keys(problems).length > 0) throw new StudioError('INVALID', undefined, problems);

  return editDraft(ctx, async (tx, menuId) => {
    const product = await tx.product.findFirst({
      where: { id: input.productId },
      include: {
        variants: { orderBy: { sortOrder: 'asc' } },
        groups: { orderBy: { sortOrder: 'asc' }, include: { options: { orderBy: { sortOrder: 'asc' } } } },
      },
    });
    if (!product) throw new StudioError('NOT_FOUND');

    // Every id the save names must be this product's own, before anything is written.
    const variants = input.variants.map((variant) => ({ input: variant, row: existing(product.variants, variant.id) }));
    const groups = input.groups.map((group) => {
      const row = existing(product.groups, group.id);
      return { input: group, row, options: group.options.map((option) => ({ input: option, row: existing(row?.options ?? [], option.id) })) };
    });

    const moving = input.categoryId !== product.categoryId;
    if (moving && !(await tx.category.findFirst({ where: { id: input.categoryId }, select: { id: true } }))) {
      throw new StudioError('NOT_FOUND');
    }

    const assetIds = mediaAssetIds(input.media);
    if (assetIds.length > 0) {
      const restaurantId = ctx.restaurantId;
      if (restaurantId === null) throw new Error('A menu action ran without a restaurant');
      const found = await loadAssets(tx, restaurantId, assetIds);
      if (assetIds.some((id) => !found.has(id))) throw new StudioError('NOT_FOUND');
    }

    const pricesChange =
      input.price !== product.basePrice ||
      (input.cost !== undefined && input.cost !== product.cost) ||
      variants.some(({ input: v, row }) => (row ? v.priceDelta !== row.priceDelta : v.priceDelta !== 0)) ||
      groups.some(({ options }) => options.some(({ input: o, row }) => (row ? o.priceDelta !== row.priceDelta : o.priceDelta !== 0)));
    if (pricesChange) requirePrices(ctx);

    if (input.slug !== product.slug && (await tx.product.findFirst({ where: { slug: input.slug, id: { not: product.id } }, select: { id: true } }))) {
      throw slugTaken();
    }

    const kept = new Set(variants.flatMap(({ row }) => (row ? [row.id] : [])));
    const dropped = product.variants.filter((row) => !kept.has(row.id)).map((row) => row.id);
    if (dropped.length > 0 && (await tx.bundleItem.findFirst({ where: { variantId: { in: dropped } }, select: { id: true } }))) {
      throw new StudioError('INVALID', undefined, { variants: 'A bundle uses this size. Remove it from the bundle first.' });
    }

    // The product itself first: a stale save stops here, before any of its children is touched.
    const allergens = canonicalSet<Allergen>(input.allergens, ALLERGENS);
    const dietary = canonicalSet<DietaryTag>(input.dietary, DIETARY_TAGS);
    const badges = canonicalSet<Badge>(input.badges, BADGES);
    const translations = withTexts(product.translations, { name: input.names, description: input.descriptions });
    const ingredients = input.ingredients === undefined ? undefined : ingredientsOf(input.ingredients);
    let sortOrder = product.sortOrder;
    if (moving) {
      const last = await tx.product.aggregate({ where: { categoryId: input.categoryId }, _max: { sortOrder: true } });
      sortOrder = last._max.sortOrder === null ? 0 : last._max.sortOrder + 1;
    }
    await claimingSlug(() =>
      updateWithVersion(
        tx.product,
        {
          id: product.id,
          version: input.version,
          data: {
            slug: input.slug,
            categoryId: input.categoryId,
            sortOrder,
            translations,
            basePrice: input.price,
            isSignature: input.isSignature,
            isFeatured: input.isFeatured,
            allergens,
            dietary,
            badges,
            calories: input.calories,
            media: input.media as Prisma.InputJsonArray,
            ...(ingredients === undefined ? {} : { ingredients }),
            ...(input.cost === undefined ? {} : { cost: input.cost }),
            ...(input.priority === undefined ? {} : { priority: input.priority }),
            ...(input.serves === undefined ? {} : { serves: input.serves }),
            ...(input.lowStockThreshold === undefined ? {} : { lowStockThreshold: input.lowStockThreshold }),
          },
          entityType: 'Product',
        },
        tx,
      ),
    );

    // Sizes: the ones left out go, the changed ones are saved at their own versions, the new ones are added.
    if (dropped.length > 0) await tx.productVariant.deleteMany({ where: { id: { in: dropped }, productId: product.id } });
    const savedVariants: Child[] = [];
    for (const [index, { input: variant, row }] of variants.entries()) {
      const data = { translations: withTexts(row?.translations, { name: variant.names }), priceDelta: variant.priceDelta, isDefault: variant.isDefault, sortOrder: index };
      if (!row) {
        const created = await tx.productVariant.create({ data: { menuId, productId: product.id, ...data }, select: { id: true, version: true } });
        savedVariants.push(created);
      } else if (same([row.translations, row.priceDelta, row.isDefault, row.sortOrder], [data.translations, data.priceDelta, data.isDefault, data.sortOrder])) {
        savedVariants.push({ id: row.id, version: row.version });
      } else {
        await updateWithVersion(tx.productVariant, { id: row.id, version: variant.version!, data, entityType: 'ProductVariant' }, tx);
        savedVariants.push({ id: row.id, version: variant.version! + 1 });
      }
    }

    // Option groups, and each group's options, the same way.
    const keptGroups = new Set(groups.flatMap(({ row }) => (row ? [row.id] : [])));
    const droppedGroups = product.groups.filter((row) => !keptGroups.has(row.id)).map((row) => row.id);
    if (droppedGroups.length > 0) await tx.modifierGroup.deleteMany({ where: { id: { in: droppedGroups }, productId: product.id } });
    const savedGroups: SavedProduct['groups'] = [];
    for (const [index, { input: group, row, options }] of groups.entries()) {
      const data = { translations: withTexts(row?.translations, { name: group.names }), minSelect: group.minSelect, maxSelect: group.maxSelect, sortOrder: index };
      let saved: Child;
      if (!row) {
        saved = await tx.modifierGroup.create({ data: { menuId, productId: product.id, ...data }, select: { id: true, version: true } });
      } else if (same([row.translations, row.minSelect, row.maxSelect, row.sortOrder], [data.translations, data.minSelect, data.maxSelect, data.sortOrder])) {
        saved = { id: row.id, version: row.version };
      } else {
        await updateWithVersion(tx.modifierGroup, { id: row.id, version: group.version!, data, entityType: 'ModifierGroup' }, tx);
        saved = { id: row.id, version: group.version! + 1 };
      }

      if (row) {
        const keptOptions = new Set(options.flatMap((option) => (option.row ? [option.row.id] : [])));
        const droppedOptions = row.options.filter((option) => !keptOptions.has(option.id)).map((option) => option.id);
        if (droppedOptions.length > 0) await tx.modifierOption.deleteMany({ where: { id: { in: droppedOptions }, groupId: row.id } });
      }
      const savedOptions: Child[] = [];
      for (const [position, { input: option, row: optionRow }] of options.entries()) {
        const optionData = {
          translations: withTexts(optionRow?.translations, { name: option.names }),
          priceDelta: option.priceDelta,
          isSuggested: option.isSuggested,
          sortOrder: position,
        };
        if (!optionRow) {
          savedOptions.push(await tx.modifierOption.create({ data: { menuId, groupId: saved.id, ...optionData }, select: { id: true, version: true } }));
        } else if (
          same(
            [optionRow.translations, optionRow.priceDelta, optionRow.isSuggested, optionRow.sortOrder],
            [optionData.translations, optionData.priceDelta, optionData.isSuggested, optionData.sortOrder],
          )
        ) {
          savedOptions.push({ id: optionRow.id, version: optionRow.version });
        } else {
          await updateWithVersion(tx.modifierOption, { id: optionRow.id, version: option.version!, data: optionData, entityType: 'ModifierOption' }, tx);
          savedOptions.push({ id: optionRow.id, version: option.version! + 1 });
        }
      }
      savedGroups.push({ ...saved, options: savedOptions });
    }

    ctx.audit({
      action: 'product.updated',
      entityType: 'Product',
      entityId: product.id,
      changes: changed({
        names: [textsOf(product.translations, 'name'), present(input.names)],
        descriptions: [textsOf(product.translations, 'description'), present(input.descriptions)],
        slug: [product.slug, input.slug],
        categoryId: [product.categoryId, input.categoryId],
        price: [product.basePrice, input.price],
        isSignature: [product.isSignature, input.isSignature],
        isFeatured: [product.isFeatured, input.isFeatured],
        allergens: [product.allergens, allergens],
        dietary: [product.dietary, dietary],
        badges: [product.badges, badges],
        calories: [product.calories, input.calories],
        cost: [product.cost, input.cost === undefined ? product.cost : input.cost],
        priority: [product.priority, input.priority ?? product.priority],
        serves: [product.serves, input.serves === undefined ? product.serves : input.serves],
        lowStockThreshold: [product.lowStockThreshold, input.lowStockThreshold === undefined ? product.lowStockThreshold : input.lowStockThreshold],
        media: [mediaSummary(product.media), mediaSummary(input.media)],
        ...(ingredients === undefined ? {} : { ingredients: [product.ingredients, ingredients] }),
        sizes: [
          product.variants.map((row) => ({ name: textsOf(row.translations, 'name').en ?? null, priceDelta: row.priceDelta, isDefault: row.isDefault })),
          input.variants.map((variant) => ({ name: present(variant.names).en ?? null, priceDelta: variant.priceDelta, isDefault: variant.isDefault })),
        ],
        options: [
          product.groups.map((row) => ({
            name: textsOf(row.translations, 'name').en ?? null,
            options: row.options.map((option) => ({ name: textsOf(option.translations, 'name').en ?? null, priceDelta: option.priceDelta })),
          })),
          input.groups.map((group) => ({
            name: present(group.names).en ?? null,
            options: group.options.map((option) => ({ name: present(option.names).en ?? null, priceDelta: option.priceDelta })),
          })),
        ],
      }),
    });
    return { version: input.version + 1, variants: savedVariants, groups: savedGroups };
  });
}

/**
 * The selling fields of one dish, as Sales > Dishes edits them. A field left out keeps what the dish has; the limits are
 * the ones `saveProduct` holds for the same fields.
 */
export const sellingFields = {
  productId: idField,
  version: z.number().int().min(1),
  isSignature: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  badges: productSaveFields.badges.optional(),
  cost: productSaveFields.cost,
  priority: productSaveFields.priority,
  serves: productSaveFields.serves,
  lowStockThreshold: productSaveFields.lowStockThreshold,
};
export type SellingSave = z.infer<z.ZodObject<typeof sellingFields>>;

/**
 * Saves only the selling fields of one dish at its version, through the draft like `saveProduct`. A cost that changes
 * needs `content.prices`. Nothing is written, and the version stays, when every value is what the dish already has.
 */
export function setSelling(ctx: ActionContext, input: SellingSave): Promise<{ version: number }> {
  return editDraft(ctx, async (tx) => {
    const product = await tx.product.findFirst({ where: { id: input.productId } });
    if (!product) throw new StudioError('NOT_FOUND');

    const badges = input.badges === undefined ? undefined : canonicalSet<Badge>(input.badges, BADGES);
    const changes = changed({
      isSignature: [product.isSignature, input.isSignature ?? product.isSignature],
      isFeatured: [product.isFeatured, input.isFeatured ?? product.isFeatured],
      badges: [product.badges, badges ?? product.badges],
      cost: [product.cost, input.cost === undefined ? product.cost : input.cost],
      priority: [product.priority, input.priority ?? product.priority],
      serves: [product.serves, input.serves === undefined ? product.serves : input.serves],
      lowStockThreshold: [product.lowStockThreshold, input.lowStockThreshold === undefined ? product.lowStockThreshold : input.lowStockThreshold],
    });
    const fields = Object.keys(changes);
    if (fields.length === 0) return { version: product.version };
    if ('cost' in changes) requirePrices(ctx);

    await updateWithVersion(
      tx.product,
      {
        id: product.id,
        version: input.version,
        data: Object.fromEntries(fields.map((field) => [field, changes[field]!.after])),
        entityType: 'Product',
      },
      tx,
    );
    ctx.audit({ action: 'product.updated', entityType: 'Product', entityId: product.id, changes });
    return { version: input.version + 1 };
  });
}

/** Ingredients per language, empty languages dropped. */
function ingredientsOf(value: Partial<Record<Locale, string[]>>): Prisma.InputJsonObject {
  const result: Record<string, string[]> = {};
  for (const locale of LOCALES) {
    const list = value[locale]?.filter((entry) => entry !== '');
    if (list && list.length > 0) result[locale] = list;
  }
  return result;
}

export function deleteProduct(ctx: ActionContext, input: { productId: string; version: number }): Promise<{ deleted: true }> {
  return editDraft(ctx, async (tx) => {
    const row = await tx.product.findFirst({ where: { id: input.productId } });
    if (!row) throw new StudioError('NOT_FOUND');
    if (await tx.bundleItem.findFirst({ where: { productId: row.id }, select: { id: true } })) {
      throw new StudioError('INVALID', 'A bundle contains this product. Remove it from the bundle first.');
    }
    await deleteWithVersion(tx.product, { id: row.id, version: input.version, entityType: 'Product' }, tx);
    await dropFromOffers(tx, 'productIds', row.id);
    ctx.audit({
      action: 'product.deleted',
      entityType: 'Product',
      entityId: row.id,
      changes: { names: { before: textsOf(row.translations, 'name'), after: null }, price: { before: row.basePrice, after: null } },
    });
    return { deleted: true };
  });
}

/** Writes `sortOrder` 0, 1, 2… down a list of products, touching only the rows whose place changed. */
async function renumber(tx: ScopedTx, rows: ReadonlyArray<{ id: string; sortOrder: number }>, categoryId: string): Promise<void> {
  for (const [index, row] of rows.entries()) {
    if (row.sortOrder !== index) await tx.product.updateMany({ where: { id: row.id, categoryId }, data: { sortOrder: index } });
  }
}

export function moveProduct(
  ctx: ActionContext,
  input: { productId: string; categoryId: string; index: number },
): Promise<{ moved: true }> {
  return editDraft(ctx, async (tx) => {
    const product = await tx.product.findFirst({ where: { id: input.productId }, select: { id: true, categoryId: true, sortOrder: true } });
    if (!product) throw new StudioError('NOT_FOUND');
    const category = await tx.category.findFirst({ where: { id: input.categoryId }, select: { id: true } });
    if (!category) throw new StudioError('NOT_FOUND');

    const order = [{ sortOrder: 'asc' as const }, { id: 'asc' as const }];
    const siblings = await tx.product.findMany({
      where: { categoryId: category.id, id: { not: product.id } },
      select: { id: true, sortOrder: true },
      orderBy: order,
    });
    const index = Math.min(Math.max(0, input.index), siblings.length);
    const before = { categoryId: product.categoryId, position: product.sortOrder };

    if (product.categoryId !== category.id) {
      // Moving into another category: the version stays, as for any reordering.
      await tx.product.updateMany({ where: { id: product.id }, data: { categoryId: category.id, sortOrder: -1 } });
      const left = await tx.product.findMany({ where: { categoryId: product.categoryId }, select: { id: true, sortOrder: true }, orderBy: order });
      await renumber(tx, left, product.categoryId);
    }
    const placed = [...siblings.slice(0, index), { id: product.id, sortOrder: product.categoryId === category.id ? product.sortOrder : -1 }, ...siblings.slice(index)];
    await renumber(tx, placed, category.id);

    ctx.audit({
      action: 'product.moved',
      entityType: 'Product',
      entityId: product.id,
      changes: changed({ categoryId: [before.categoryId, category.id], position: [before.position, index] }),
    });
    return { moved: true };
  });
}

/** A product's pictures for an audit row: each asset by its id, anything else by its kind. */
function mediaSummary(media: unknown): string[] {
  if (!Array.isArray(media)) return [];
  return media.map((entry: { kind?: unknown; assetId?: unknown }) => (typeof entry?.assetId === 'string' ? entry.assetId : String(entry?.kind)));
}
