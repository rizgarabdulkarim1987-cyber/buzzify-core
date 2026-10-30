import { z } from 'zod';
import { canonicalSet } from '@/lib/canonical';
import { isLocale, type Locale } from '@/lib/locale';
import type { Badge } from '@/lib/product-tags';
import type { ScopedTx } from '@/server/data/tenant-db';
import { resolveEngineConfig, salesSettings, type SalesSettings } from '@/server/domain/config';
import { localDate } from '@/server/domain/offers';
import { DAYPARTS, PROMOTION_KINDS, type Daypart, type PromotionKind } from '@/server/domain/types';
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

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar date written `YYYY-MM-DD`. */
function isDate(value: string): boolean {
  if (!DATE_SHAPE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
const dateField = z.string().refine(isDate, 'Use a date such as 2026-10-31').nullable();
const minuteField = z.number().int().min(0, 'Choose a time of day').max(1439, 'Choose a time of day').nullable();
export const PERCENT_OFF_MIN = 5;
export const PERCENT_OFF_MAX = 90;

export const offerFields = {
  offerId: idField.optional(),
  version: versionField.optional(),
  kind: z.enum(PROMOTION_KINDS),
  percentOff: z.number().int().min(PERCENT_OFF_MIN, 'Use 5% to 90% off').max(PERCENT_OFF_MAX, 'Use 5% to 90% off').nullable(),
  productIds: z.array(idField).max(500),
  categoryIds: z.array(idField).max(100),
  startsOn: dateField,
  endsOn: dateField,
  startMinute: minuteField,
  endMinute: minuteField,
  daysOfWeek: z.number().int().min(1, 'Choose at least one day').max(127, 'Choose at least one day'),
  title: namesField,
  text: namesField,
  isActive: z.boolean(),
};
export type OfferSave = z.infer<z.ZodObject<typeof offerFields>>;
export const sameOfferRef = (row: { offerId?: string | undefined; version?: number | undefined }) =>
  (row.offerId === undefined) === (row.version === undefined);

export const settingsFields = {
  version: versionField,
  priceStyle: z.enum(['symbol', 'plain']),
  showMostOrdered: z.boolean(),
  showLowStock: z.boolean(),
  upsellMaxOffers: z.number().int().min(1, 'Use 1 to 5').max(5, 'Use 1 to 5'),
  pairingMaxOffers: z.number().int().min(1, 'Use 1 to 5').max(5, 'Use 1 to 5'),
  upsellDeltaCapRatio: z.number().min(0.25, 'Use 25% to 200%').max(2, 'Use 25% to 200%'),
  cartPairingMaxOffers: z.number().int().min(1, 'Use 1 to 5').max(5, 'Use 1 to 5'),
  mealCategoryIds: z.array(idField).max(100),
};
export type SettingsSave = z.infer<z.ZodObject<typeof settingsFields>>;

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
    // The row being edited must be this menu's own before anything else is said about it.
    const editing = input.ruleId === undefined ? null : await tx.upsellRule.findFirst({ where: { id: input.ruleId } });
    if (input.ruleId !== undefined && !editing) throw new StudioError('NOT_FOUND');
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
    const row = editing;
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
    const editing = input.ruleId === undefined ? null : await tx.pairingRule.findFirst({ where: { id: input.ruleId } });
    if (input.ruleId !== undefined && !editing) throw new StudioError('NOT_FOUND');
    const twin = await tx.pairingRule.findFirst({
      where: {
        sourceType: input.source.kind,
        ...(input.source.kind === 'PRODUCT' ? { sourceProductId: input.source.id } : { sourceCategoryId: input.source.id }),
        targetProductId: input.targetProductId,
        ...(input.ruleId ? { id: { not: input.ruleId } } : {}),
      },
      select: { id: true },
    });
    if (twin) throw new StudioError('INVALID', undefined, { targetProductId: 'This pairing already exists' });

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
    const row = editing;
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
      // A set is a lower price for its dishes: its price, its dishes and when it shows are all price decisions. Only its
      // name and description are words.
      const itemsKey = (list: ReadonlyArray<{ productId: string; variantId: string | null; quantity: number }>) =>
        JSON.stringify(list.map((item) => [item.productId, item.variantId, item.quantity]).sort());
      if (
        row.price !== input.price ||
        itemsKey(row.items) !== itemsKey(items) ||
        JSON.stringify(row.dayparts) !== JSON.stringify(fields.dayparts) ||
        row.isActive !== fields.isActive
      ) {
        requirePrices(ctx);
      }
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
  requirePrices(ctx);
  return editDraft(ctx, async (tx) => {
    const row = await tx.bundle.findFirst({ where: { id: input.bundleId } });
    if (!row) throw new StudioError('NOT_FOUND');
    await tx.bundleItem.deleteMany({ where: { bundleId: row.id } });
    await deleteWithVersion(tx.bundle, { id: row.id, version: input.version, entityType: 'Bundle' }, tx);
    ctx.audit({ action: 'set.deleted', entityType: 'Bundle', entityId: row.id, changes: { names: { before: textsOf(row.translations, 'name'), after: null }, price: { before: row.price, after: null } } });
    return { deleted: true };
  });
}

// Offers --------------------------------------------------------------------------------------------------------------

/** What an offer's fields cannot state alone, as per-field messages; empty when it may be saved. */
function offerProblems(input: OfferSave, defaultLocale: Locale): Record<string, string> {
  const fields: Record<string, string> = {};
  if (input.productIds.length + input.categoryIds.length === 0) fields.productIds = 'Choose at least one dish or category';
  if (input.kind === 'DISCOUNT' && input.percentOff === null) fields.percentOff = 'Use 5% to 90% off';
  if (input.kind === 'SPECIAL' && input.percentOff !== null) fields.percentOff = 'A special changes no price: leave the discount empty';
  if (input.startsOn !== null && input.endsOn !== null && input.endsOn < input.startsOn) fields.endsOn = 'End on or after the start date';
  if ((input.startMinute === null) !== (input.endMinute === null)) fields.endMinute = 'Give both a start and an end time, or neither';
  else if (input.startMinute !== null && input.startMinute === input.endMinute) fields.endMinute = 'End at a different time than the start';
  if (!present(input.title)[defaultLocale]) fields.title = 'Enter a title in the main language of the menu';
  return fields;
}

/**
 * Creates an offer (a special, or a discount while it is live), or saves one at the version the person read. A
 * discount is a price decision: it needs `content.prices`, and so does turning a discount into a special or back.
 */
export function saveOffer(ctx: ActionContext, input: OfferSave): Promise<{ id: string; version: number }> {
  return editDraft(ctx, async (tx, menuId) => {
    const menu = await tx.menu.findFirstOrThrow({ where: { id: menuId }, select: { defaultLocale: true } });
    const problems = offerProblems(input, isLocale(menu.defaultLocale) ? menu.defaultLocale : 'en');
    if (Object.keys(problems).length > 0) throw new StudioError('INVALID', undefined, problems);

    // In a fixed order, so choosing the same dishes again never looks like an unpublished change.
    const productIds = [...new Set(input.productIds)].sort();
    const categoryIds = [...new Set(input.categoryIds)].sort();
    if ((await tx.product.count({ where: { id: { in: productIds } } })) !== productIds.length) throw new StudioError('NOT_FOUND');
    if ((await tx.category.count({ where: { id: { in: categoryIds } } })) !== categoryIds.length) throw new StudioError('NOT_FOUND');

    const fields = {
      kind: input.kind as PromotionKind,
      percentOff: input.kind === 'DISCOUNT' ? input.percentOff : null,
      productIds,
      categoryIds,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      startMinute: input.startMinute,
      endMinute: input.endMinute,
      daysOfWeek: input.daysOfWeek,
      isActive: input.isActive,
    };
    if (input.offerId === undefined || input.version === undefined) {
      if (fields.kind === 'DISCOUNT') requirePrices(ctx);
      const last = await tx.promotion.aggregate({ _max: { sortOrder: true } });
      const sortOrder = last._max.sortOrder === null ? 0 : last._max.sortOrder + 1;
      const translations = withTexts({}, { title: input.title, text: input.text });
      const row = await tx.promotion.create({ data: { menuId, ...fields, sortOrder, translations }, select: { id: true } });
      ctx.audit({ action: 'offer.created', entityType: 'Promotion', entityId: row.id, changes: { title: { before: null, after: present(input.title) }, kind: { before: null, after: fields.kind }, percentOff: { before: null, after: fields.percentOff } } });
      return { id: row.id, version: 1 };
    }

    const row = await tx.promotion.findFirst({ where: { id: input.offerId } });
    if (!row) throw new StudioError('NOT_FOUND');
    // A discount's reach (its dishes, dates, hours, days and whether it runs) is as much a price decision as its
    // percentage; only its title and text are words. A special changes no price, unless it becomes a discount.
    const reachChanged =
      JSON.stringify([row.productIds, row.categoryIds, row.startsOn, row.endsOn, row.startMinute, row.endMinute, row.daysOfWeek, row.isActive]) !==
      JSON.stringify([fields.productIds, fields.categoryIds, fields.startsOn, fields.endsOn, fields.startMinute, fields.endMinute, fields.daysOfWeek, fields.isActive]);
    const discount = row.kind === 'DISCOUNT' || fields.kind === 'DISCOUNT';
    if (row.kind !== fields.kind || row.percentOff !== fields.percentOff || (discount && reachChanged)) requirePrices(ctx);
    const translations = withTexts(row.translations, { title: input.title, text: input.text });
    await updateWithVersion(tx.promotion, { id: row.id, version: input.version, data: { ...fields, translations }, entityType: 'Promotion' }, tx);
    ctx.audit({
      action: 'offer.updated',
      entityType: 'Promotion',
      entityId: row.id,
      changes: changed({
        title: [textsOf(row.translations, 'title'), present(input.title)],
        text: [textsOf(row.translations, 'text'), present(input.text)],
        kind: [row.kind, fields.kind],
        percentOff: [row.percentOff, fields.percentOff],
        productIds: [row.productIds, fields.productIds],
        categoryIds: [row.categoryIds, fields.categoryIds],
        startsOn: [row.startsOn, fields.startsOn],
        endsOn: [row.endsOn, fields.endsOn],
        startMinute: [row.startMinute, fields.startMinute],
        endMinute: [row.endMinute, fields.endMinute],
        daysOfWeek: [row.daysOfWeek, fields.daysOfWeek],
        isActive: [row.isActive, fields.isActive],
      }),
    });
    return { id: row.id, version: input.version + 1 };
  });
}

export function deleteOffer(ctx: ActionContext, input: { offerId: string; version: number }): Promise<{ deleted: true }> {
  return editDraft(ctx, async (tx) => {
    const row = await tx.promotion.findFirst({ where: { id: input.offerId } });
    if (!row) throw new StudioError('NOT_FOUND');
    // Removing a discount raises prices: a price decision.
    if (row.kind === 'DISCOUNT') requirePrices(ctx);
    await deleteWithVersion(tx.promotion, { id: row.id, version: input.version, entityType: 'Promotion' }, tx);
    ctx.audit({ action: 'offer.deleted', entityType: 'Promotion', entityId: row.id, changes: { title: { before: textsOf(row.translations, 'title'), after: null } } });
    return { deleted: true };
  });
}

/** Puts the menu's offers in the order given, which must name each of them once. A reorder moves no version. */
export function reorderOffers(ctx: ActionContext, input: { order: string[] }): Promise<{ reordered: true }> {
  return editDraft(ctx, async (tx, menuId) => {
    const rows = await tx.promotion.findMany({ select: { id: true, sortOrder: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
    const ids = new Set(rows.map((row) => row.id));
    if (input.order.some((id) => !ids.has(id))) throw new StudioError('NOT_FOUND');
    if (input.order.length !== rows.length || new Set(input.order).size !== rows.length) {
      throw new StudioError('INVALID', 'The offers changed while you were editing. Reload to see them.');
    }
    const current = new Map(rows.map((row) => [row.id, row.sortOrder]));
    for (const [index, id] of input.order.entries()) {
      if (current.get(id) !== index) await tx.promotion.updateMany({ where: { id }, data: { sortOrder: index } });
    }
    const before = rows.map((row) => row.id);
    if (JSON.stringify(before) !== JSON.stringify(input.order)) {
      ctx.audit({ action: 'offer.reordered', entityType: 'PromotionOrder', entityId: menuId, changes: { order: { before, after: input.order } } });
    }
    return { reordered: true };
  });
}

// Settings ------------------------------------------------------------------------------------------------------------

/**
 * Saves the menu's sales settings at the version the person read: the labels guests see and how many suggestions they
 * get go into the engine settings (keeping what this does not set, such as the weights); the categories that complete
 * a meal are marked on the categories, which moves none of their versions.
 */
export function saveSalesSettings(ctx: ActionContext, input: SettingsSave): Promise<{ version: number }> {
  return editDraft(ctx, async (tx, menuId) => {
    const menu = await tx.menu.findFirstOrThrow({ where: { id: menuId }, select: { engineConfig: true } });
    const categoryIds = [...new Set(input.mealCategoryIds)];
    if ((await tx.category.count({ where: { id: { in: categoryIds } } })) !== categoryIds.length) throw new StudioError('NOT_FOUND');

    const stored = (menu.engineConfig && typeof menu.engineConfig === 'object' && !Array.isArray(menu.engineConfig) ? menu.engineConfig : {}) as Record<string, unknown>;
    const before = resolveEngineConfig(stored);
    const sales: SalesSettings = { priceStyle: input.priceStyle, showMostOrdered: input.showMostOrdered, showLowStock: input.showLowStock };
    const mealBefore = (await tx.category.findMany({ where: { completesMeal: true }, select: { id: true }, orderBy: { id: 'asc' } })).map((row) => row.id);

    // Saved unchanged: nothing is written, so the draft does not look changed and no audit row says it was.
    const unchanged =
      JSON.stringify(salesSettings(before)) === JSON.stringify(sales) &&
      before.upsellMaxOffers === input.upsellMaxOffers &&
      before.pairingMaxOffers === input.pairingMaxOffers &&
      before.upsellDeltaCapRatio === input.upsellDeltaCapRatio &&
      before.cartPairingMaxOffers === input.cartPairingMaxOffers &&
      JSON.stringify(mealBefore) === JSON.stringify([...categoryIds].sort());
    if (unchanged) return { version: input.version };

    const engineConfig = {
      ...stored,
      upsellMaxOffers: input.upsellMaxOffers,
      pairingMaxOffers: input.pairingMaxOffers,
      upsellDeltaCapRatio: input.upsellDeltaCapRatio,
      cartPairingMaxOffers: input.cartPairingMaxOffers,
      sales: { ...sales },
    };
    await updateWithVersion(tx.menu, { id: menuId, version: input.version, data: { engineConfig }, entityType: 'Menu' }, tx);

    await tx.category.updateMany({ where: { id: { notIn: categoryIds } }, data: { completesMeal: false } });
    if (categoryIds.length > 0) await tx.category.updateMany({ where: { id: { in: categoryIds } }, data: { completesMeal: true } });

    ctx.audit({
      action: 'menu.sales_settings_changed',
      entityType: 'Menu',
      entityId: menuId,
      changes: changed({
        sales: [salesSettings(before), sales],
        upsellMaxOffers: [before.upsellMaxOffers, input.upsellMaxOffers],
        pairingMaxOffers: [before.pairingMaxOffers, input.pairingMaxOffers],
        upsellDeltaCapRatio: [before.upsellDeltaCapRatio, input.upsellDeltaCapRatio],
        cartPairingMaxOffers: [before.cartPairingMaxOffers, input.cartPairingMaxOffers],
        mealCategories: [mealBefore, [...categoryIds].sort()],
      }),
    });
    return { version: input.version + 1 };
  });
}

export interface SalesSettingsView extends SalesSettings {
  version: number;
  defaultLocale: Locale;
  upsellMaxOffers: number;
  pairingMaxOffers: number;
  upsellDeltaCapRatio: number;
  cartPairingMaxOffers: number;
  categories: Array<{ id: string; names: Names; completesMeal: boolean }>;
  /** The owner's switch for the order and view counts on dish cards (read live; the plan's grant is in `upgrade`). */
  dishCountsEnabled: boolean;
}

export async function salesSettingsView(db: QueryContext['db'], menuId: string): Promise<SalesSettingsView> {
  const menu = await db.menu.findUniqueOrThrow({ where: { id: menuId }, select: { engineConfig: true, version: true, defaultLocale: true, dishCountsEnabled: true } });
  const categories = await db.category.findMany({ where: { menuId }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: { id: true, translations: true, completesMeal: true } });
  const config = resolveEngineConfig(menu.engineConfig);
  return {
    ...salesSettings(config),
    version: menu.version,
    dishCountsEnabled: menu.dishCountsEnabled,
    defaultLocale: isLocale(menu.defaultLocale) ? menu.defaultLocale : 'en',
    upsellMaxOffers: config.upsellMaxOffers,
    pairingMaxOffers: config.pairingMaxOffers,
    upsellDeltaCapRatio: config.upsellDeltaCapRatio,
    cartPairingMaxOffers: config.cartPairingMaxOffers,
    categories: categories.map((category) => ({ id: category.id, names: textsOf(category.translations, 'name'), completesMeal: category.completesMeal })),
  };
}

// What the Sales tab reads ----------------------------------------------------------------------------------------------

export interface SalesRules {
  locales: Locale[];
  defaultLocale: Locale;
  /** The menu's time zone, which every offer's dates and hours are read in. */
  timeZone: string;
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
  offers: Array<{
    id: string;
    version: number;
    kind: PromotionKind;
    percentOff: number | null;
    productIds: string[];
    categoryIds: string[];
    startsOn: string | null;
    endsOn: string | null;
    startMinute: number | null;
    endMinute: number | null;
    daysOfWeek: number;
    title: Names;
    text: Names;
    isActive: boolean;
    sortOrder: number;
    /** Its end date has passed in the menu's time zone: guests no longer see it. */
    ended: boolean;
  }>;
}

/** Every dish's selling settings, by category, with the version each is saved at (Sales > Dishes). */
export interface SalesDishes {
  locales: Locale[];
  defaultLocale: Locale;
  currency: string;
  numeralSystem: string;
  categories: Array<{
    id: string;
    names: Names;
    products: Array<{
      id: string;
      version: number;
      names: Names;
      isSignature: boolean;
      isFeatured: boolean;
      badges: Badge[];
      cost: number | null;
      priority: number;
      serves: number | null;
      lowStockThreshold: number | null;
    }>;
  }>;
}

export async function salesDishes(db: QueryContext['db'], menuId: string): Promise<SalesDishes> {
  const menu = await db.menu.findUniqueOrThrow({ where: { id: menuId }, select: { locales: true, defaultLocale: true, currency: true, numeralSystem: true } });
  const order = [{ sortOrder: 'asc' as const }, { id: 'asc' as const }];
  const categories = await db.category.findMany({ where: { menuId }, orderBy: order, select: { id: true, translations: true } });
  const products = await db.product.findMany({
    where: { menuId },
    orderBy: order,
    select: {
      id: true,
      categoryId: true,
      translations: true,
      version: true,
      isSignature: true,
      isFeatured: true,
      badges: true,
      cost: true,
      priority: true,
      serves: true,
      lowStockThreshold: true,
    },
  });
  return {
    locales: menu.locales.filter(isLocale),
    defaultLocale: isLocale(menu.defaultLocale) ? menu.defaultLocale : 'en',
    currency: menu.currency,
    numeralSystem: menu.numeralSystem,
    categories: categories.map((category) => ({
      id: category.id,
      names: textsOf(category.translations, 'name'),
      products: products
        .filter((product) => product.categoryId === category.id)
        .map((product) => ({
          id: product.id,
          version: product.version,
          names: textsOf(product.translations, 'name'),
          isSignature: product.isSignature,
          isFeatured: product.isFeatured,
          badges: product.badges as Badge[],
          cost: product.cost,
          priority: product.priority,
          serves: product.serves,
          lowStockThreshold: product.lowStockThreshold,
        })),
    })),
  };
}

export async function salesRules(db: QueryContext['db'], menuId: string, now: Date = new Date()): Promise<SalesRules> {
  const menu = await db.menu.findUniqueOrThrow({
    where: { id: menuId },
    select: { locales: true, defaultLocale: true, currency: true, numeralSystem: true, timezone: true },
  });
  const today = localDate(now, menu.timezone);
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
  const offers = await db.promotion.findMany({ where: { menuId }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
  const order = new Map(categories.map((category, index) => [category.id, index]));
  const priced = new Map(products.map((product) => [product.id, product]));

  return {
    locales: menu.locales.filter(isLocale),
    defaultLocale: isLocale(menu.defaultLocale) ? menu.defaultLocale : 'en',
    timeZone: menu.timezone,
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
    offers: offers.map((offer) => ({
      id: offer.id,
      version: offer.version,
      kind: offer.kind,
      percentOff: offer.percentOff,
      productIds: offer.productIds,
      categoryIds: offer.categoryIds,
      startsOn: offer.startsOn,
      endsOn: offer.endsOn,
      startMinute: offer.startMinute,
      endMinute: offer.endMinute,
      daysOfWeek: offer.daysOfWeek,
      title: textsOf(offer.translations, 'title'),
      text: textsOf(offer.translations, 'text'),
      isActive: offer.isActive,
      sortOrder: offer.sortOrder,
      ended: offer.endsOn !== null && offer.endsOn < today,
    })),
  };
}

