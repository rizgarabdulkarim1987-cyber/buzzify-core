import type { AnyDb } from '@/server/data/tenant-db';
import { isLocale, type Locale } from '@/lib/locale';
import { tillOfferPerUnit } from '@/server/domain/pos/line-offer';
import { lineTotal, type Discount } from '@/server/domain/pos/totals';
import { StudioError } from '@/server/studio/framework/result';
import type { DiscountWhy } from './approval';
import { refuse } from './errors';
import { loadTillOffers, pricingMoment } from './line-offers';
import {
  bumpOrder,
  assertNotHandedOver,
  loadOrderForChange,
  optionsSnapshotSchema,
  pricedLine,
  reopened,
  settleStatus,
  toDiscount,
  type OptionSnapshot,
} from './orders';

type Translations = unknown;

/** A name in the menu's default language, else in any language that has one. */
export function nameOf(translations: Translations, defaultLocale: string): string {
  if (typeof translations !== 'object' || translations === null || Array.isArray(translations)) return '';
  const map = translations as Record<string, { name?: unknown } | undefined>;
  const preferred = isLocale(defaultLocale) ? map[defaultLocale]?.name : undefined;
  if (typeof preferred === 'string' && preferred.trim() !== '') return preferred;
  for (const entry of Object.values(map)) {
    if (typeof entry?.name === 'string' && entry.name.trim() !== '') return entry.name;
  }
  return '';
}

export interface ProductForLine {
  variants: { id: string; translations: Translations; priceDelta: number; isDefault: boolean }[];
  groups: {
    id: string;
    minSelect: number;
    maxSelect: number;
    options: { id: string; translations: Translations; priceDelta: number; isAvailable: boolean }[];
  }[];
}

/**
 * The chosen variant (first) and options of a new line, each checked to belong to the product. A product with sizes needs
 * exactly one (its default, or its only one, when none is named); a group takes between its `minSelect` and `maxSelect`.
 */
export function chooseForLine(product: ProductForLine, defaultLocale: string, variantId: string | undefined, optionIds: readonly string[]): OptionSnapshot[] {
  const chosen: OptionSnapshot[] = [];
  if (product.variants.length === 0) {
    if (variantId !== undefined) throw new StudioError('NOT_FOUND');
  } else {
    const variant =
      variantId !== undefined
        ? product.variants.find((v) => v.id === variantId)
        : (product.variants.find((v) => v.isDefault) ?? (product.variants.length === 1 ? product.variants[0] : undefined));
    if (variantId !== undefined && !variant) throw new StudioError('NOT_FOUND');
    if (!variant) throw new StudioError('INVALID', 'Choose a size', { variantId: 'Choose a size' });
    chosen.push({ id: variant.id, name: nameOf(variant.translations, defaultLocale), priceDelta: variant.priceDelta });
  }

  const owner = new Map<string, string>();
  const byId = new Map<string, ProductForLine['groups'][number]['options'][number]>();
  for (const group of product.groups) {
    for (const option of group.options) {
      owner.set(option.id, group.id);
      byId.set(option.id, option);
    }
  }
  for (const id of optionIds) {
    const option = byId.get(id);
    if (!option) throw new StudioError('NOT_FOUND');
    if (!option.isAvailable) throw new StudioError('INVALID', 'That option is not available', { optionIds: 'That option is not available' });
    chosen.push({ id: option.id, name: nameOf(option.translations, defaultLocale), priceDelta: option.priceDelta });
  }
  for (const group of product.groups) {
    const count = optionIds.filter((id) => owner.get(id) === group.id).length;
    if (count < group.minSelect) throw new StudioError('INVALID', 'Choose an option for every required group', { optionIds: 'Choose an option for every required group' });
    if (count > group.maxSelect) throw new StudioError('INVALID', 'Choose only as many options as the group allows', { optionIds: 'Choose only as many options as the group allows' });
  }
  return chosen;
}

export interface AddLineInput {
  orderId: string;
  productId: string;
  quantity: number;
  note: string;
  variantId?: string;
  optionIds: string[];
  expectedVersion: number;
  /** When a till device tapped the dish while offline: the moment the menu's offers are read at (see `pricingMoment`). */
  clientAt?: Date;
}

/**
 * Adds a product of the catalog menu to the order, copying its name, price, section and the chosen variant and options as
 * they are now, and what the menu's live offer takes off a unit (kept apart from the regular price, so reports and the
 * receipt show it as a discount). A product that is switched off, sold out at the till, or in an inactive category cannot be added.
 */
export async function addLineIn(db: AnyDb, restaurantId: string, menuId: string, input: AddLineInput, now: Date = new Date()) {
  const order = await loadOrderForChange(db, restaurantId, input.orderId, input.expectedVersion);
  assertNotHandedOver(order);
  const product = await db.product.findFirst({
    where: { id: input.productId, menuId, category: { isActive: true } },
    include: {
      variants: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
      groups: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], include: { options: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } } },
    },
  });
  if (!product) throw new StudioError('NOT_FOUND');
  const [setting, categorySetting, menu] = await Promise.all([
    db.posProductSetting.findFirst({ where: { productId: product.id, restaurantId }, select: { sectionId: true, soldOutOverride: true } }),
    db.posCategorySetting.findFirst({ where: { categoryId: product.categoryId, restaurantId }, select: { sectionId: true } }),
    db.menu.findFirst({ where: { id: menuId, restaurantId }, select: { defaultLocale: true } }),
  ]);
  if (!product.isAvailable || setting?.soldOutOverride) throw refuse('CONFLICT', 'This product is not available');
  const defaultLocale: Locale | string = menu?.defaultLocale ?? 'en';
  const options = chooseForLine(product, defaultLocale, input.variantId, input.optionIds);
  const { offers, timeZone } = await loadTillOffers(db, restaurantId, menuId);
  const regularUnit = product.basePrice + options.reduce((sum, option) => sum + option.priceDelta, 0);
  const promoDiscountPerUnit = tillOfferPerUnit(product, regularUnit, offers, pricingMoment(input.clientAt, now), timeZone);

  const sectionId = setting?.sectionId ?? categorySetting?.sectionId ?? null;
  const section = sectionId ? await db.posKitchenSection.findFirst({ where: { id: sectionId, restaurantId }, select: { id: true, name: true } }) : null;

  const status = reopened(order.status, ['READY', 'BILL_REQUESTED']);
  const version = await bumpOrder(db, restaurantId, order.id, input.expectedVersion, status !== order.status ? { status } : {});
  const line = await db.posOrderLine.create({
    data: {
      restaurantId,
      orderId: order.id,
      productId: product.id,
      nameSnapshot: nameOf(product.translations, defaultLocale),
      unitPriceSnapshot: product.basePrice,
      promoDiscountPerUnit,
      quantity: input.quantity,
      note: input.note,
      optionsSnapshot: options,
      sectionId: section?.id ?? null,
      sectionNameSnapshot: section?.name ?? '',
    },
  });
  return { orderId: order.id, lineId: line.id, version, name: line.nameSnapshot, unitPrice: line.unitPriceSnapshot, quantity: line.quantity, options };
}

export interface UpdateLineInput {
  lineId: string;
  expectedVersion: number;
  quantity?: number;
  note?: string;
  discount?: Discount | null;
  /** Why a discount was given and who approved it; stored with the discount, cleared with it. */
  why?: DiscountWhy;
}

async function loadLineForChange(db: AnyDb, restaurantId: string, lineId: string, expected: number) {
  const line = await db.posOrderLine.findFirst({ where: { id: lineId, restaurantId } });
  if (!line) throw new StudioError('NOT_FOUND');
  const order = await loadOrderForChange(db, restaurantId, line.orderId, expected);
  assertNotHandedOver(order);
  if (line.cancelledAt) throw refuse('CONFLICT', 'The line is cancelled');
  if (line.paymentId !== null) throw refuse('CONFLICT', 'This line is already paid');
  return { line, order };
}

/**
 * Changes a line's quantity, note or discount (`discount: null` clears it). A line already sent to the kitchen keeps its
 * quantity and note, since the kitchen cooks what it was sent: more of the same is a new line, less is a cancel.
 */
export async function updateLineIn(db: AnyDb, restaurantId: string, input: UpdateLineInput) {
  const { line, order } = await loadLineForChange(db, restaurantId, input.lineId, input.expectedVersion);
  if (line.sentAt !== null && (input.quantity !== undefined || input.note !== undefined)) {
    throw refuse('CONFLICT', 'The line was sent to the kitchen and can no longer change');
  }
  if (input.discount?.kind === 'AMOUNT') {
    const gross = lineTotal({ ...pricedLine(line), discount: undefined, quantity: input.quantity ?? line.quantity });
    if (input.discount.value > gross) throw new StudioError('INVALID', 'The discount is larger than the line', { discount: 'The discount is larger than the line' });
  }
  const status = reopened(order.status, ['BILL_REQUESTED']);
  const version = await bumpOrder(db, restaurantId, order.id, input.expectedVersion, status !== order.status ? { status } : {});

  const changes: Record<string, { before: unknown; after: unknown }> = {};
  const data: {
    quantity?: number;
    note?: string;
    discountKind?: Discount['kind'] | null;
    discountValue?: number | null;
    discountReason?: DiscountWhy['reason'] | null;
    discountNote?: string | null;
    discountApprovedByStaffId?: string | null;
  } = {};
  if (input.quantity !== undefined) {
    data.quantity = input.quantity;
    changes.quantity = { before: line.quantity, after: input.quantity };
  }
  if (input.note !== undefined) {
    data.note = input.note;
    changes.note = { before: line.note, after: input.note };
  }
  if (input.discount !== undefined) {
    data.discountKind = input.discount?.kind ?? null;
    data.discountValue = input.discount?.value ?? null;
    const why = input.discount ? input.why : undefined;
    data.discountReason = why?.reason ?? null;
    data.discountNote = why?.note ?? null;
    data.discountApprovedByStaffId = why?.approvedByStaffId ?? null;
    changes.discount = { before: toDiscount(line.discountKind, line.discountValue) ?? null, after: input.discount };
  }
  // sentAt: null too when the quantity or note changes, so a send that won the row lock first cannot be overwritten.
  const { count } = await db.posOrderLine.updateMany({
    where: { id: line.id, restaurantId, cancelledAt: null, ...(input.quantity !== undefined || input.note !== undefined ? { sentAt: null } : {}) },
    data,
  });
  if (count === 0) throw refuse('CONFLICT', 'The line is cancelled');
  const finalStatus = await settleStatus(db, restaurantId, order.id, status, version);
  if (finalStatus !== order.status) changes.status = { before: order.status, after: finalStatus };
  return { orderId: order.id, lineId: line.id, version, changes };
}

/** Cancels a line, keeping it with the reason. A cancelled line cannot be cancelled or changed again. */
export async function cancelLineIn(db: AnyDb, restaurantId: string, input: { lineId: string; expectedVersion: number; reason: string }) {
  const { line, order } = await loadLineForChange(db, restaurantId, input.lineId, input.expectedVersion);
  const status = reopened(order.status, ['BILL_REQUESTED']);
  const version = await bumpOrder(db, restaurantId, order.id, input.expectedVersion, status !== order.status ? { status } : {});
  const { count } = await db.posOrderLine.updateMany({
    where: { id: line.id, restaurantId, cancelledAt: null },
    data: { cancelledAt: new Date(), cancelReason: input.reason },
  });
  if (count === 0) throw refuse('CONFLICT', 'The line is cancelled');
  // Cancelling the last line the kitchen was still cooking, or the last line not sent yet, can finish the order.
  const finalStatus = await settleStatus(db, restaurantId, order.id, status, version);
  // A part of the bill is already paid and nothing unpaid is left: the order is complete (otherwise it could never close).
  const unpaidLeft = await db.posOrderLine.count({ where: { orderId: order.id, restaurantId, cancelledAt: null, paymentId: null } });
  if (unpaidLeft === 0 && (await db.posPayment.count({ where: { orderId: order.id, restaurantId } })) > 0) {
    const closed = await db.posOrder.updateMany({ where: { id: order.id, restaurantId, version }, data: { status: 'PAID', version: { increment: 1 } } });
    if (closed.count === 0) throw refuse('CONFLICT', 'The order was changed by someone else. Reload it and try again.');
    return { orderId: order.id, lineId: line.id, version: version + 1, name: line.nameSnapshot, quantity: line.quantity, sent: line.sentAt !== null, from: order.status, to: 'PAID' as const };
  }
  return { orderId: order.id, lineId: line.id, version, name: line.nameSnapshot, quantity: line.quantity, sent: line.sentAt !== null, from: order.status, to: finalStatus };
}

export { optionsSnapshotSchema };
