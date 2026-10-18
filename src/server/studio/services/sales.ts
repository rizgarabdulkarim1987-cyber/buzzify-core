import { z } from 'zod';
import { canonicalSet } from '@/lib/canonical';
import { isLocale, type Locale } from '@/lib/locale';
import type { ScopedTx } from '@/server/data/tenant-db';
import { DAYPARTS, type Daypart } from '@/server/domain/types';
import type { ActionContext } from '@/server/studio/framework/action';
import { deleteWithVersion, updateWithVersion } from '@/server/studio/framework/concurrency';
import type { QueryContext } from '@/server/studio/framework/query';
import { StudioError } from '@/server/studio/framework/result';
import {
  changed,
  contentSlugField,
  descriptionsField,
  idField,
  namesField,
  present,
  priceField,
  slugFromNames,
  textsOf,
  uniqueSlug,
  withTexts,
  type Names,
} from './content';
import { editDraft } from './draft-edit';
import { isUniqueViolation } from './menus';

/**
 * The Sales tab (docs/superpowers/specs/2026-10-18-sales-tools-design.md, 6.4): the rules that turn the revenue engine
 * on for a menu. Every change edits the draft through `editDraft`, at the version the person read; guests see it after
 * a publish.
 */

// Fields --------------------------------------------------------------------------------------------------------------

/** Normal, high and top: the three strengths an owner picks from for an upgrade's priority or a pairing's weight. */
export const STRENGTHS = [50, 75, 100] as const;
export const strengthField = z.union([z.literal(50), z.literal(75), z.literal(100)], 'Choose normal, high or top');
export const daypartsField = z.array(z.enum(DAYPARTS, 'Choose from the times of day offered')).max(DAYPARTS.length * 2);
export const versionField = z.number().int().min(1);

/** A row the person had open, by its id and the version they read, or neither for a new row. */
export const rowRef = { ruleId: idField.optional(), version: versionField.optional() };
export const sameRef = (row: { ruleId?: string | undefined; version?: number | undefined }) => (row.ruleId === undefined) === (row.version === undefined);

export const upgradeFields = {
  ...rowRef,
  sourceProductId: idField,
  targetProductId: idField,
  pitch: namesField,
  effect: namesField,
  priority: strengthField,
  dayparts: daypartsField,
  isActive: z.boolean(),
};
export type UpgradeSave = z.infer<z.ZodObject<typeof upgradeFields>>;

export const pairingFields = {
  ...rowRef,
  source: z.object({ kind: z.enum(['PRODUCT', 'CATEGORY']), id: idField }),
  targetProductId: idField,
  reason: namesField,
  weight: strengthField,
  dayparts: daypartsField,
  isActive: z.boolean(),
};
export type PairingSave = z.infer<z.ZodObject<typeof pairingFields>>;

export const SET_ITEMS_MIN = 2;
export const SET_ITEMS_MAX = 8;
export const setFields = {
  bundleId: idField.optional(),
  version: versionField.optional(),
  slug: contentSlugField.optional(),
  names: namesField,
  descriptions: descriptionsField,
  price: priceField,
  items: z
    .array(
      z.object({
        productId: idField,
        variantId: idField.nullable(),
        quantity: z.number().int().min(1, 'Use 1 to 10').max(10, 'Use 1 to 10'),
      }),
    )
    .min(SET_ITEMS_MIN, 'Put at least two dishes in a set')
    .max(SET_ITEMS_MAX, 'Use at most 8 dishes in a set'),
  dayparts: daypartsField,
  isActive: z.boolean(),
};
export type SetSave = z.infer<z.ZodObject<typeof setFields>>;
export const sameSetRef = (row: { bundleId?: string | undefined; version?: number | undefined }) =>
  (row.bundleId === undefined) === (row.version === undefined);

// Shared --------------------------------------------------------------------------------------------------------------

async function requireProduct(tx: ScopedTx, id: string): Promise<void> {
  if (!(await tx.product.findFirst({ where: { id }, select: { id: true } }))) throw new StudioError('NOT_FOUND');
}

async function requireCategory(tx: ScopedTx, id: string): Promise<void> {
  if (!(await tx.category.findFirst({ where: { id }, select: { id: true } }))) throw new StudioError('NOT_FOUND');
}

const daypartsOf = (values: readonly string[]) => canonicalSet<Daypart>(values, DAYPARTS);

/** A price other than the one saved is a price decision: it needs `content.prices`. */
function requirePrices(ctx: ActionContext): void {
  if (!ctx.permissions.has('content.prices')) throw new StudioError('FORBIDDEN');
}

const slugTaken = () => new StudioError('INVALID', undefined, { slug: 'This address is taken' });

interface PricedProduct {
  id: string;
  basePrice: number;
  variants: Array<{ id: string; priceDelta: number; isDefault: boolean }>;
}

/** What one of a dish costs at its regular price in a size (its default size when none is named), as the engine prices it. */
function regularPrice(product: PricedProduct, variantId: string | null): number {
  const variant = variantId ? product.variants.find((v) => v.id === variantId) : product.variants.find((v) => v.isDefault);
  return Math.max(0, product.basePrice + (variant?.priceDelta ?? 0));
}

function itemsTotalOf(items: ReadonlyArray<{ productId: string; variantId: string | null; quantity: number }>, products: ReadonlyMap<string, PricedProduct>): number {
  return items.reduce((sum, item) => {
    const product = products.get(item.productId);
    return product ? sum + regularPrice(product, item.variantId) * item.quantity : sum;
  }, 0);
}

// Upgrades ------------------------------------------------------------------------------------------------------------

/** Creates an upgrade rule ("when a guest opens X, offer Y instead"), or saves one at the version the person read. */
export function saveUpgrade(ctx: ActionContext, input: UpgradeSave): Promise<{ id: string; version: number }> {
  if (input.sourceProductId === input.targetProductId) {
    throw new StudioError('INVALID', undefined, { targetProductId: 'Choose a different dish to offer' });
  }
  return editDraft(ctx, async (tx, menuId) => {
    await requireProduct(tx, input.sourceProductId);
    await requireProduct(tx, input.targetProductId);
    const twin = await tx.upsellRule.findFirst({
      where: { sourceProductId: input.sourceProductId, targetProductId: input.targetProductId, ...(input.ruleId ? { id: { not: input.ruleId } } : {}) },
      select: { id: true },
    });
    if (twin) throw new StudioError('INVALID', undefined, { targetProductId: 'This upgrade already exists' });

    const fields = {
      sourceProductId: input.sourceProductId,
      targetProductId: input.targetProductId,
      priority: input.priority,
      dayparts: daypartsOf(input.dayparts),
      isActive: input.isActive,
    };
    if (input.ruleId === undefined || input.version === undefined) {
      const row = await tx.upsellRule.create({ data: { menuId, ...fields, translations: withTexts({}, { pitch: input.pitch, effect: input.effect }) }, select: { id: true } });
      ctx.audit({ action: 'upgrade.created', entityType: 'UpsellRule', entityId: row.id, changes: { ...changed({ pitch: [null, present(input.pitch)] }), source: { before: null, after: fields.sourceProductId }, target: { before: null, after: fields.targetProductId } } });
      return { id: row.id, version: 1 };
    }
    const row = await tx.upsellRule.findFirst({ where: { id: input.ruleId } });
    if (!row) throw new StudioError('NOT_FOUND');
    const translations = withTexts(row.translations, { pitch: input.pitch, effect: input.effect });
    await updateWithVersion(tx.upsellRule, { id: row.id, version: input.version, data: { ...fields, translations }, entityType: 'UpsellRule' }, tx);
    ctx.audit({
      action: 'upgrade.updated',
      entityType: 'UpsellRule',
      entityId: row.id,
      changes: changed({
        source: [row.sourceProductId, fields.sourceProductId],
        target: [row.targetProductId, fields.targetProductId],
        pitch: [textsOf(row.translations, 'pitch'), present(input.pitch)],
        effect: [textsOf(row.translations, 'effect'), present(input.effect)],
        priority: [row.priority, fields.priority],
        dayparts: [row.dayparts, fields.dayparts],
        isActive: [row.isActive, fields.isActive],
      }),
    });
    return { id: row.id, version: input.version + 1 };
  });
}

export function deleteUpgrade(ctx: ActionContext, input: { ruleId: string; version: number }): Promise<{ deleted: true }> {
  return editDraft(ctx, async (tx) => {
    const row = await tx.upsellRule.findFirst({ where: { id: input.ruleId } });
    if (!row) throw new StudioError('NOT_FOUND');
    await deleteWithVersion(tx.upsellRule, { id: row.id, version: input.version, entityType: 'UpsellRule' }, tx);
    ctx.audit({ action: 'upgrade.deleted', entityType: 'UpsellRule', entityId: row.id, changes: { source: { before: row.sourceProductId, after: null }, target: { before: row.targetProductId, after: null } } });
    return { deleted: true };
  });
}

// Pairings ------------------------------------------------------------------------------------------------------------

/** Creates a pairing ("with X, a dish or a category, suggest Y"), or saves one at the version the person read. */
export function savePairing(ctx: ActionContext, input: PairingSave): Promise<{ id: string; version: number }> {
  if (input.source.kind === 'PRODUCT' && input.source.id === input.targetProductId) {
    throw new StudioError('INVALID', undefined, { targetProductId: 'Choose a different dish to suggest' });
  }
  return editDraft(ctx, async (tx, menuId) => {
    if (input.source.kind === 'PRODUCT') await requireProduct(tx, input.source.id);
    else await requireCategory(tx, input.source.id);
    await requireProduct(tx, input.targetProductId);

    const fields = {
      sourceType: input.source.kind,
      sourceProductId: input.source.kind === 'PRODUCT' ? input.source.id : null,
      sourceCategoryId: input.source.kind === 'CATEGORY' ? input.source.id : null,
      targetProductId: input.targetProductId,
      weight: input.weight,
      dayparts: daypartsOf(input.dayparts),
      isActive: input.isActive,
    };
    if (input.ruleId === undefined || input.version === undefined) {
      const row = await tx.pairingRule.create({ data: { menuId, ...fields, translations: withTexts({}, { reason: input.reason }) }, select: { id: true } });
      ctx.audit({ action: 'pairing.created', entityType: 'PairingRule', entityId: row.id, changes: { source: { before: null, after: input.source }, target: { before: null, after: fields.targetProductId } } });
      return { id: row.id, version: 1 };
    }
    const row = await tx.pairingRule.findFirst({ where: { id: input.ruleId } });
    if (!row) throw new StudioError('NOT_FOUND');
    const translations = withTexts(row.translations, { reason: input.reason });
    await updateWithVersion(tx.pairingRule, { id: row.id, version: input.version, data: { ...fields, translations }, entityType: 'PairingRule' }, tx);
    ctx.audit({
      action: 'pairing.updated',
      entityType: 'PairingRule',
      entityId: row.id,
      changes: changed({
        source: [{ kind: row.sourceType, id: row.sourceProductId ?? row.sourceCategoryId }, input.source],
        target: [row.targetProductId, fields.targetProductId],
        reason: [textsOf(row.translations, 'reason'), present(input.reason)],
        weight: [row.weight, fields.weight],
        dayparts: [row.dayparts, fields.dayparts],
        isActive: [row.isActive, fields.isActive],
      }),
    });
    return { id: row.id, version: input.version + 1 };
  });
}

export function deletePairing(ctx: ActionContext, input: { ruleId: string; version: number }): Promise<{ deleted: true }> {
  return editDraft(ctx, async (tx) => {
    const row = await tx.pairingRule.findFirst({ where: { id: input.ruleId } });
    if (!row) throw new StudioError('NOT_FOUND');
    await deleteWithVersion(tx.pairingRule, { id: row.id, version: input.version, entityType: 'PairingRule' }, tx);
    ctx.audit({ action: 'pairing.deleted', entityType: 'PairingRule', entityId: row.id, changes: { target: { before: row.targetProductId, after: null } } });
    return { deleted: true };
  });
}

// Sets ----------------------------------------------------------------------------------------------------------------

/**
 * Creates a set, or saves one at the version the person read. Its dishes and sizes must be the menu's own, and it must
 * cost less than its dishes bought one by one at their regular prices: a set that saves nothing is never shown as one.
 */
export function saveSet(ctx: ActionContext, input: SetSave): Promise<{ id: string; version: number }> {
  if (Object.keys(present(input.names)).length === 0) throw new StudioError('INVALID', undefined, { names: 'Enter a name for the set' });
  if (input.bundleId === undefined) requirePrices(ctx);
  return editDraft(ctx, async (tx, menuId) => {
    const ids = [...new Set(input.items.map((item) => item.productId))];
    const rows = await tx.product.findMany({ where: { id: { in: ids } }, select: { id: true, basePrice: true, variants: { select: { id: true, priceDelta: true, isDefault: true } } } });
    const products = new Map(rows.map((row) => [row.id, row]));
    for (const item of input.items) {
      const product = products.get(item.productId);
      if (!product) throw new StudioError('NOT_FOUND');
      if (item.variantId !== null && !product.variants.some((variant) => variant.id === item.variantId)) throw new StudioError('NOT_FOUND');
    }
    if (input.price >= itemsTotalOf(input.items, products)) {
      throw new StudioError('INVALID', undefined, { price: 'Price the set below its dishes bought one by one' });
    }

    const items = input.items.map((item) => ({ productId: item.productId, variantId: item.variantId, quantity: item.quantity }));
    const fields = { price: input.price, dayparts: daypartsOf(input.dayparts), isActive: input.isActive };
    const taken = async (slug: string, except?: string) =>
      Boolean(await tx.bundle.findFirst({ where: { slug, ...(except ? { id: { not: except } } : {}) }, select: { id: true } }));

    try {
      if (input.bundleId === undefined || input.version === undefined) {
        if (input.slug !== undefined && (await taken(input.slug))) throw slugTaken();
        const slug = input.slug ?? uniqueSlug(slugFromNames(input.names, 'set'), new Set((await tx.bundle.findMany({ select: { slug: true } })).map((row) => row.slug)));
        const translations = withTexts({}, { name: input.names, description: input.descriptions });
        const row = await tx.bundle.create({ data: { menuId, slug, ...fields, translations }, select: { id: true } });
        await tx.bundleItem.createMany({ data: items.map((item) => ({ menuId, bundleId: row.id, ...item })) });
        ctx.audit({ action: 'set.created', entityType: 'Bundle', entityId: row.id, changes: { names: { before: null, after: present(input.names) }, price: { before: null, after: input.price }, items: { before: null, after: items } } });
        return { id: row.id, version: 1 };
      }

      const row = await tx.bundle.findFirst({ where: { id: input.bundleId }, include: { items: { orderBy: { id: 'asc' } } } });
      if (!row) throw new StudioError('NOT_FOUND');
      if (row.price !== input.price) requirePrices(ctx);
      const slug = input.slug ?? row.slug;
      if (slug !== row.slug && (await taken(slug, row.id))) throw slugTaken();
      const translations = withTexts(row.translations, { name: input.names, description: input.descriptions });
      await updateWithVersion(tx.bundle, { id: row.id, version: input.version, data: { slug, ...fields, translations }, entityType: 'Bundle' }, tx);
      await tx.bundleItem.deleteMany({ where: { bundleId: row.id } });
      await tx.bundleItem.createMany({ data: items.map((item) => ({ menuId, bundleId: row.id, ...item })) });
      const before = row.items.map((item) => ({ productId: item.productId, variantId: item.variantId, quantity: item.quantity }));
      ctx.audit({
        action: 'set.updated',
        entityType: 'Bundle',
        entityId: row.id,
        changes: changed({
          names: [textsOf(row.translations, 'name'), present(input.names)],
          descriptions: [textsOf(row.translations, 'description'), present(input.descriptions)],
          slug: [row.slug, slug],
          price: [row.price, input.price],
          items: [before, items],
          dayparts: [row.dayparts, fields.dayparts],
          isActive: [row.isActive, fields.isActive],
        }),
      });
      return { id: row.id, version: input.version + 1 };
    } catch (error) {
      if (isUniqueViolation(error)) throw slugTaken();
      throw error;
    }
  });
}

export function deleteSet(ctx: ActionContext, input: { bundleId: string; version: number }): Promise<{ deleted: true }> {
  return editDraft(ctx, async (tx) => {
    const row = await tx.bundle.findFirst({ where: { id: input.bundleId } });
    if (!row) throw new StudioError('NOT_FOUND');
    await tx.bundleItem.deleteMany({ where: { bundleId: row.id } });
    await deleteWithVersion(tx.bundle, { id: row.id, version: input.version, entityType: 'Bundle' }, tx);
    ctx.audit({ action: 'set.deleted', entityType: 'Bundle', entityId: row.id, changes: { names: { before: textsOf(row.translations, 'name'), after: null }, price: { before: row.price, after: null } } });
    return { deleted: true };
  });
}

// What the Sales tab reads ----------------------------------------------------------------------------------------------

export interface SalesRules {
  locales: Locale[];
  defaultLocale: Locale;
  currency: string;
  numeralSystem: string;
  products: Array<{
    id: string;
    categoryId: string;
    names: Names;
    price: number;
    variants: Array<{ id: string; names: Names; priceDelta: number; isDefault: boolean }>;
  }>;
  categories: Array<{ id: string; names: Names }>;
  upgrades: Array<{
    id: string;
    version: number;
    sourceProductId: string;
    targetProductId: string;
    pitch: Names;
    effect: Names;
    priority: number;
    dayparts: Daypart[];
    isActive: boolean;
  }>;
  pairings: Array<{
    id: string;
    version: number;
    sourceType: 'PRODUCT' | 'CATEGORY';
    sourceId: string;
    targetProductId: string;
    reason: Names;
    weight: number;
    dayparts: Daypart[];
    isActive: boolean;
  }>;
  sets: Array<{
    id: string;
    version: number;
    slug: string;
    names: Names;
    descriptions: Names;
    price: number;
    items: Array<{ productId: string; variantId: string | null; quantity: number }>;
    dayparts: Daypart[];
    isActive: boolean;
    /** What the set's dishes cost bought one by one, at their regular prices now. */
    itemsTotal: number;
  }>;
}

export async function salesRules(db: QueryContext['db'], menuId: string): Promise<SalesRules> {
  const menu = await db.menu.findUniqueOrThrow({ where: { id: menuId }, select: { locales: true, defaultLocale: true, currency: true, numeralSystem: true } });
  const categories = await db.category.findMany({ where: { menuId }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: { id: true, translations: true } });
  const products = await db.product.findMany({
    where: { menuId },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      categoryId: true,
      translations: true,
      basePrice: true,
      variants: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: { id: true, translations: true, priceDelta: true, isDefault: true } },
    },
  });
  const upgrades = await db.upsellRule.findMany({ where: { menuId }, orderBy: { id: 'asc' } });
  const pairings = await db.pairingRule.findMany({ where: { menuId }, orderBy: { id: 'asc' } });
  const sets = await db.bundle.findMany({ where: { menuId }, orderBy: [{ slug: 'asc' }, { id: 'asc' }], include: { items: { orderBy: { id: 'asc' } } } });
  const order = new Map(categories.map((category, index) => [category.id, index]));
  const priced = new Map(products.map((product) => [product.id, product]));

  return {
    locales: menu.locales.filter(isLocale),
    defaultLocale: isLocale(menu.defaultLocale) ? menu.defaultLocale : 'en',
    currency: menu.currency,
    numeralSystem: menu.numeralSystem,
    categories: categories.map((category) => ({ id: category.id, names: textsOf(category.translations, 'name') })),
    products: products
      .sort((x, y) => (order.get(x.categoryId) ?? 0) - (order.get(y.categoryId) ?? 0))
      .map((product) => ({
        id: product.id,
        categoryId: product.categoryId,
        names: textsOf(product.translations, 'name'),
        price: product.basePrice,
        variants: product.variants.map((variant) => ({ id: variant.id, names: textsOf(variant.translations, 'name'), priceDelta: variant.priceDelta, isDefault: variant.isDefault })),
      })),
    upgrades: upgrades.map((rule) => ({
      id: rule.id,
      version: rule.version,
      sourceProductId: rule.sourceProductId,
      targetProductId: rule.targetProductId,
      pitch: textsOf(rule.translations, 'pitch'),
      effect: textsOf(rule.translations, 'effect'),
      priority: rule.priority,
      dayparts: rule.dayparts as Daypart[],
      isActive: rule.isActive,
    })),
    pairings: pairings.map((rule) => ({
      id: rule.id,
      version: rule.version,
      sourceType: rule.sourceType,
      sourceId: (rule.sourceType === 'PRODUCT' ? rule.sourceProductId : rule.sourceCategoryId) ?? '',
      targetProductId: rule.targetProductId,
      reason: textsOf(rule.translations, 'reason'),
      weight: rule.weight,
      dayparts: rule.dayparts as Daypart[],
      isActive: rule.isActive,
    })),
    sets: sets.map((bundle) => {
      const items = bundle.items.map((item) => ({ productId: item.productId, variantId: item.variantId, quantity: item.quantity }));
      return {
        id: bundle.id,
        version: bundle.version,
        slug: bundle.slug,
        names: textsOf(bundle.translations, 'name'),
        descriptions: textsOf(bundle.translations, 'description'),
        price: bundle.price,
        items,
        dayparts: bundle.dayparts as Daypart[],
        isActive: bundle.isActive,
        itemsTotal: itemsTotalOf(items, priced),
      };
    }),
  };
}

