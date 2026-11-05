import { randomBytes } from 'node:crypto';
import type { Prisma } from '@/generated/prisma/client';
import type { AnyDb } from '@/server/data/tenant-db';
import { defaultVariant } from '@/server/domain/catalog';
import { expiryCutoff, isExpired, promoDiscountPerUnit, QR_LIMITS } from '@/server/domain/pos/customer-order-rules';
import { LOCKED_STATUSES } from '@/server/domain/pos/order-state';
import { quoteCart } from '@/server/domain/pricing';
import { resolveText } from '@/server/domain/translate';
import type { CartLineInput, Catalog } from '@/server/domain/types';
import { StudioError } from '@/server/studio/framework/result';
import { refuse } from './errors';
import { bumpOrder, loadOrderForChange, openOrderIn, optionsSnapshotSchema, reopened, type OptionSnapshot } from './orders';

/** A request line as stored: the names and prices of the Menu's published catalog at the time it was priced. */
export interface PricedRequestLine {
  productId: string;
  nameSnapshot: string;
  unitPriceSnapshot: number;
  optionsSnapshot: OptionSnapshot[];
  promoDiscountPerUnit: number;
  quantity: number;
  note: string;
}

/**
 * Prices lines as the Menu would, from its published catalog, and turns each into the snapshot the cashier sees: the base
 * price, the chosen size and options, and the Menu's promotion as a per-unit discount. Null when the catalog refuses any
 * line (an unknown or unavailable product, a missing required choice); the caller says so in its own words.
 */
export function priceRequestLines(catalog: Catalog, lines: readonly (CartLineInput & { note: string })[], now: Date): PricedRequestLine[] | null {
  const quote = quoteCart(catalog, { lines: lines.map(({ productId, variantId, optionIds, quantity }) => ({ productId, variantId, optionIds, quantity })), bundles: [] }, now);
  if (quote.hasBlockingIssues) return null;
  const products = new Map(catalog.products.map((product) => [product.id, product]));
  const fallback = catalog.defaultLocale;
  const priced: PricedRequestLine[] = [];
  for (const [index, line] of quote.lines.entries()) {
    const product = products.get(line.productId);
    const source = lines[index];
    if (!product || !source) return null;
    const variant = line.variantId ? (product.variants.find((v) => v.id === line.variantId) ?? null) : defaultVariant(product);
    const chosen: OptionSnapshot[] = [];
    if (variant) chosen.push({ id: variant.id, name: resolveText(variant.translations, 'name', fallback, fallback), priceDelta: variant.priceDelta });
    for (const group of product.groups) {
      for (const option of group.options) {
        if (line.optionIds.includes(option.id)) chosen.push({ id: option.id, name: resolveText(option.translations, 'name', fallback, fallback), priceDelta: option.priceDelta });
      }
    }
    const optionsTotal = chosen.reduce((sum, option) => sum + option.priceDelta, 0);
    priced.push({
      productId: product.id,
      nameSnapshot: resolveText(product.translations, 'name', fallback, fallback),
      unitPriceSnapshot: product.basePrice,
      optionsSnapshot: chosen,
      promoDiscountPerUnit: promoDiscountPerUnit(product.basePrice, optionsTotal, line.unitPrice),
      quantity: line.quantity,
      note: source.note,
    });
  }
  return priced;
}

/** What the requests list shows of one request. */
export interface RequestSummary {
  id: string;
  tableId: string;
  tableNumber: number;
  createdAt: Date;
  lineCount: number;
  total: number;
  /** Held for the captain: placed while captain approval was on and not approved yet. The cashier cannot accept it. */
  awaitingCaptain: boolean;
  /** Held for the captain and approved by them; an edit by someone who cannot approve sends it back. */
  captainApproved: boolean;
}

export interface RequestLineView {
  id: string;
  name: string;
  quantity: number;
  note: string;
  options: OptionSnapshot[];
  unitPrice: number;
  promoDiscountPerUnit: number;
  lineTotal: number;
}

export interface RequestDetail extends RequestSummary {
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  expired: boolean;
  customerNote: string;
  locale: string;
  rejectReason: string;
  lines: RequestLineView[];
  /** The table's live order a decision would join, with the version the caller must pass; null when the table is free. */
  liveOrderId: string | null;
  liveOrderVersion: number | null;
  /** The guest ticked "use my reward" with a full stamp card: the reward's text for the cashier to give by hand; null when they did not. */
  reward: string | null;
}

type LineRow = {
  id: string;
  nameSnapshot: string;
  unitPriceSnapshot: number;
  optionsSnapshot: Prisma.JsonValue;
  promoDiscountPerUnit: number;
  quantity: number;
  note: string;
};

function lineView(line: LineRow): RequestLineView {
  const options = optionsSnapshotSchema.parse(line.optionsSnapshot);
  const each = line.unitPriceSnapshot + options.reduce((sum, option) => sum + option.priceDelta, 0) - line.promoDiscountPerUnit;
  return {
    id: line.id,
    name: line.nameSnapshot,
    quantity: line.quantity,
    note: line.note,
    options,
    unitPrice: line.unitPriceSnapshot,
    promoDiscountPerUnit: line.promoDiscountPerUnit,
    lineTotal: Math.max(0, each) * line.quantity,
  };
}

const waiting = (now: Date) => ({ status: 'PENDING' as const, createdAt: { gt: expiryCutoff(now) } });

/** How many requests wait per table, for the board. One query however many tables there are. */
export async function pendingByTable(db: AnyDb, restaurantId: string, now: Date = new Date()): Promise<Map<string, number>> {
  const groups = await db.posCustomerOrder.groupBy({ by: ['tableId'], where: { restaurantId, ...waiting(now) }, _count: { _all: true } });
  return new Map(groups.map((group) => [group.tableId, group._count._all]));
}

type DetailRow = {
  id: string;
  tableId: string;
  tableNumber: number;
  createdAt: Date;
  status: RequestDetail['status'];
  customerNote: string;
  locale: string;
  rejectReason: string;
  requiresCaptain: boolean;
  captainApprovedAt: Date | null;
  redeemReward: boolean;
  lines: LineRow[];
};

/** Whether a request still waits for the captain's approval. */
export function awaitingCaptain(row: { status: string; requiresCaptain: boolean; captainApprovedAt: Date | null }): boolean {
  return row.status === 'PENDING' && row.requiresCaptain && row.captainApprovedAt === null;
}

function detailOf(row: DetailRow, live: { id: string; version: number } | undefined, now: Date, reward: string): RequestDetail {
  const lines = row.lines.map(lineView);
  return {
    id: row.id,
    tableId: row.tableId,
    tableNumber: row.tableNumber,
    createdAt: row.createdAt,
    lineCount: lines.length,
    total: lines.reduce((sum, line) => sum + line.lineTotal, 0),
    awaitingCaptain: awaitingCaptain(row),
    captainApproved: row.status === 'PENDING' && row.requiresCaptain && row.captainApprovedAt !== null,
    status: row.status,
    expired: row.status === 'PENDING' && isExpired(row.createdAt, now),
    customerNote: row.customerNote,
    locale: row.locale,
    rejectReason: row.rejectReason,
    lines,
    liveOrderId: live?.id ?? null,
    liveOrderVersion: live?.version ?? null,
    reward: row.redeemReward ? reward : null,
  };
}

/** The reward's text the restaurant set for its stamp card. */
async function rewardText(db: AnyDb, restaurantId: string): Promise<string> {
  return (await db.posSettings.findFirst({ where: { restaurantId }, select: { loyaltyReward: true } }))?.loyaltyReward ?? '';
}

export async function readRequest(db: AnyDb, restaurantId: string, id: string, now: Date = new Date()): Promise<RequestDetail> {
  const row = await db.posCustomerOrder.findFirst({ where: { id, restaurantId }, include: { lines: { orderBy: { id: 'asc' } } } });
  if (!row) throw new StudioError('NOT_FOUND');
  const live = await db.posOrder.findFirst({
    where: { restaurantId, tableId: row.tableId, status: { notIn: [...LOCKED_STATUSES] } },
    select: { id: true, version: true },
  });
  return detailOf(row, live ?? undefined, now, row.redeemReward ? await rewardText(db, restaurantId) : '');
}

/** Every waiting request with its lines and the live order of its table, in a fixed number of queries. Oldest first. */
export async function listPendingDetails(db: AnyDb, restaurantId: string, now: Date = new Date()): Promise<RequestDetail[]> {
  const rows = await db.posCustomerOrder.findMany({
    where: { restaurantId, ...waiting(now) },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: { lines: { orderBy: { id: 'asc' } } },
  });
  const live = rows.length
    ? await db.posOrder.findMany({
        where: { restaurantId, tableId: { in: rows.map((row) => row.tableId) }, status: { notIn: [...LOCKED_STATUSES] } },
        select: { id: true, version: true, tableId: true },
      })
    : [];
  const byTable = new Map(live.map((order) => [order.tableId as string, order]));
  const reward = rows.some((row) => row.redeemReward) ? await rewardText(db, restaurantId) : '';
  return rows.map((row) => detailOf(row, byTable.get(row.tableId), now, reward));
}

/**
 * Why a request cannot be decided or edited now: unknown, already decided, or expired; for an acceptance, also held for the
 * captain.
 */
async function whyNotPending(db: AnyDb, restaurantId: string, id: string, now: Date, accepting = false): Promise<StudioError> {
  const row = await db.posCustomerOrder.findFirst({ where: { id, restaurantId }, select: { status: true, createdAt: true, requiresCaptain: true, captainApprovedAt: true } });
  if (!row) return new StudioError('NOT_FOUND');
  if (row.status !== 'PENDING') return refuse('CONFLICT', 'This request was already decided');
  if (isExpired(row.createdAt, now)) return refuse('CONFLICT', 'This request expired');
  return accepting && awaitingCaptain(row) ? refuse('CONFLICT', 'Waiting for the captain') : refuse('CONFLICT', 'This request was already decided');
}

/** Matches a request the cashier may accept: one that needs no captain, or that the captain approved. */
const cleared = { OR: [{ requiresCaptain: false }, { captainApprovedAt: { not: null } }] };

/**
 * Locks the request while it is still waiting: a no-op update that matches only a PENDING, unexpired request, so an edit and a
 * decision of the same request run one after the other and the second sees what the first did.
 */
async function lockPending(db: AnyDb, restaurantId: string, id: string, now: Date): Promise<void> {
  const { count } = await db.posCustomerOrder.updateMany({ where: { id, restaurantId, ...waiting(now) }, data: { status: 'PENDING' } });
  if (count === 0) throw await whyNotPending(db, restaurantId, id, now);
}

/**
 * After an edit by someone who may not approve (a cashier), a request the captain had approved goes back to the captain:
 * the approval covered the dishes as they were. Runs after `lockPending`, in the same transaction as the edit. True when an
 * approval was cleared. A request that needs no captain, or an edit by a captain, manager or owner, keeps what it had.
 */
async function reopenApproval(db: AnyDb, restaurantId: string, id: string, canApprove: boolean): Promise<boolean> {
  if (canApprove) return false;
  const { count } = await db.posCustomerOrder.updateMany({
    where: { id, restaurantId, requiresCaptain: true, captainApprovedAt: { not: null } },
    data: { captainApprovedAt: null, captainApprovedByUserId: null },
  });
  return count > 0;
}

/** Who edits a request: whether they hold `request.approve`, which decides whether a captain's approval survives the edit. */
export interface EditorInput {
  canApprove: boolean;
}

async function lineOf(db: AnyDb, restaurantId: string, lineId: string) {
  const line = await db.posCustomerOrderLine.findFirst({ where: { id: lineId, restaurantId }, select: { id: true, requestId: true, nameSnapshot: true, quantity: true } });
  if (!line) throw new StudioError('NOT_FOUND');
  return line;
}

export async function setRequestLineQuantityIn(db: AnyDb, restaurantId: string, input: { lineId: string; quantity: number } & EditorInput, now: Date = new Date()) {
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > QR_LIMITS.maxQuantity) {
    throw new StudioError('INVALID', 'Nothing to change', { quantity: 'Nothing to change' });
  }
  const line = await lineOf(db, restaurantId, input.lineId);
  await lockPending(db, restaurantId, line.requestId, now);
  await db.posCustomerOrderLine.updateMany({ where: { id: line.id, restaurantId }, data: { quantity: input.quantity } });
  const approvalCleared = await reopenApproval(db, restaurantId, line.requestId, input.canApprove);
  return { requestId: line.requestId, lineId: line.id, name: line.nameSnapshot, before: line.quantity, after: input.quantity, approvalCleared };
}

export async function removeRequestLineIn(db: AnyDb, restaurantId: string, input: { lineId: string } & EditorInput, now: Date = new Date()) {
  const line = await lineOf(db, restaurantId, input.lineId);
  await lockPending(db, restaurantId, line.requestId, now);
  await db.posCustomerOrderLine.deleteMany({ where: { id: line.id, restaurantId } });
  const approvalCleared = await reopenApproval(db, restaurantId, line.requestId, input.canApprove);
  return { requestId: line.requestId, lineId: line.id, name: line.nameSnapshot, quantity: line.quantity, approvalCleared };
}

export interface AddRequestLineInput extends EditorInput {
  requestId: string;
  productId: string;
  quantity: number;
  note?: string;
  /** The size and options, as on the Menu; the default size and no options when left out. */
  variantId?: string | null;
  optionIds?: string[];
}

/**
 * Adds a dish to a waiting request, priced from the Menu's published catalog as a guest's own line is. Refuses a dish the
 * till marked sold out, one the catalog does not offer, and a request that already holds the most lines a guest may send.
 */
export async function addRequestLineIn(db: AnyDb, restaurantId: string, catalog: Catalog, input: AddRequestLineInput, now: Date = new Date()) {
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > QR_LIMITS.maxQuantity) {
    throw new StudioError('INVALID', 'Nothing to change', { quantity: 'Nothing to change' });
  }
  const priced = priceRequestLines(
    catalog,
    [{ productId: input.productId, variantId: input.variantId ?? null, optionIds: input.optionIds ?? [], quantity: input.quantity, note: input.note ?? '' }],
    now,
  );
  const line = priced?.[0];
  if (!line) throw refuse('CONFLICT', 'This product is not available');
  await lockPending(db, restaurantId, input.requestId, now);
  const [lines, soldOut, product] = await Promise.all([
    db.posCustomerOrderLine.count({ where: { requestId: input.requestId, restaurantId } }),
    db.posProductSetting.count({ where: { restaurantId, productId: line.productId, soldOutOverride: true } }),
    db.product.findFirst({ where: { id: line.productId, menuId: catalog.menuId }, select: { id: true } }),
  ]);
  if (soldOut > 0 || !product) throw refuse('CONFLICT', 'This product is not available');
  if (lines >= QR_LIMITS.maxLines) throw refuse('CONFLICT', 'The request has too many items');
  const created = await db.posCustomerOrderLine.create({
    data: {
      restaurantId,
      requestId: input.requestId,
      productId: line.productId,
      nameSnapshot: line.nameSnapshot,
      unitPriceSnapshot: line.unitPriceSnapshot,
      optionsSnapshot: line.optionsSnapshot,
      promoDiscountPerUnit: line.promoDiscountPerUnit,
      quantity: line.quantity,
      note: line.note,
    },
    select: { id: true },
  });
  const approvalCleared = await reopenApproval(db, restaurantId, input.requestId, input.canApprove);
  return { requestId: input.requestId, lineId: created.id, name: line.nameSnapshot, quantity: line.quantity, approvalCleared };
}

export interface CaptainRequestInput {
  userId: string;
  tableNumber: number;
  lines: { productId: string; quantity: number; note?: string; variantId?: string | null; optionIds?: string[] }[];
  note?: string;
}

/**
 * A captain's order for a table, taken by mouth: stored as a request already approved by them, so the cashier accepts it
 * as any guest order. Priced from the Menu's published catalog; the line, quantity and note limits apply as to a guest,
 * the guests' per-table and per-hour rate limits do not (this is a staff action).
 */
export async function createCaptainRequestIn(db: AnyDb, restaurantId: string, catalog: Catalog, input: CaptainRequestInput, now: Date = new Date()) {
  if (input.lines.length === 0 || input.lines.length > QR_LIMITS.maxLines) throw refuse('CONFLICT', 'The request has no items');
  if (input.lines.some((line) => !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > QR_LIMITS.maxQuantity)) {
    throw new StudioError('INVALID', 'Nothing to change', { quantity: 'Nothing to change' });
  }
  const note = (input.note ?? '').trim();
  if (note.length > QR_LIMITS.maxNote || input.lines.some((line) => (line.note ?? '').trim().length > QR_LIMITS.maxNote)) {
    throw new StudioError('INVALID', 'Use at most 300 characters');
  }
  const priced = priceRequestLines(
    catalog,
    input.lines.map((line) => ({ productId: line.productId, variantId: line.variantId ?? null, optionIds: line.optionIds ?? [], quantity: line.quantity, note: (line.note ?? '').trim() })),
    now,
  );
  if (!priced) throw refuse('CONFLICT', 'This product is not available');
  const productIds = [...new Set(priced.map((line) => line.productId))];
  const [table, soldOut, known] = await Promise.all([
    db.posTable.findFirst({ where: { restaurantId, number: input.tableNumber }, select: { id: true } }),
    db.posProductSetting.count({ where: { restaurantId, productId: { in: productIds }, soldOutOverride: true } }),
    db.product.count({ where: { id: { in: productIds }, menuId: catalog.menuId } }),
  ]);
  if (!table) throw new StudioError('NOT_FOUND');
  if (soldOut > 0 || known !== productIds.length) throw refuse('CONFLICT', 'This product is not available');
  const request = await db.posCustomerOrder.create({
    data: {
      restaurantId,
      tableId: table.id,
      publicId: randomBytes(16).toString('base64url'),
      tableNumber: input.tableNumber,
      locale: catalog.defaultLocale,
      customerNote: note,
      requiresCaptain: false,
      captainApprovedAt: now,
      captainApprovedByUserId: input.userId,
      createdByUserId: input.userId,
      createdAt: now,
      lines: {
        create: priced.map((line) => ({
          restaurantId,
          productId: line.productId,
          nameSnapshot: line.nameSnapshot,
          unitPriceSnapshot: line.unitPriceSnapshot,
          optionsSnapshot: line.optionsSnapshot,
          promoDiscountPerUnit: line.promoDiscountPerUnit,
          quantity: line.quantity,
          note: line.note,
        })),
      },
    },
    select: { id: true },
  });
  return { requestId: request.id, lines: priced.length };
}

/**
 * The captain's approval of a request held for them: after it the cashier may accept it. One guarded update, so two
 * approvals, or an approval and a decision, cannot both win.
 */
/**
 * Captain approval was switched off: no captain is coming, so the orders still held for one go to the cashier. Only waiting,
 * unexpired requests that were never approved change; approved, decided and expired ones keep what they had. Called in the
 * transaction that saves the switch, after its settings row is written (a guest submission locks that row first, so one
 * sent at the same moment is either released here or stamped free). Returns how many were released.
 */
export async function releaseHeldRequestsIn(db: AnyDb, restaurantId: string, now: Date = new Date()): Promise<number> {
  const { count } = await db.posCustomerOrder.updateMany({
    where: { restaurantId, ...waiting(now), requiresCaptain: true, captainApprovedAt: null },
    data: { requiresCaptain: false },
  });
  return count;
}

export async function approveRequestIn(db: AnyDb, restaurantId: string, input: { requestId: string; userId: string }, now: Date = new Date()) {
  const { count } = await db.posCustomerOrder.updateMany({
    where: { id: input.requestId, restaurantId, ...waiting(now), requiresCaptain: true, captainApprovedAt: null },
    data: { captainApprovedAt: now, captainApprovedByUserId: input.userId },
  });
  if (count === 0) throw await whyNotPending(db, restaurantId, input.requestId, now);
  // Read after the guarded update holds the row, so a line removed just before is seen; the caller's transaction undoes the approval.
  const request = await db.posCustomerOrder.findFirstOrThrow({
    where: { id: input.requestId, restaurantId },
    select: { tableNumber: true, _count: { select: { lines: true } } },
  });
  if (request._count.lines === 0) throw refuse('CONFLICT', 'The request has no items');
  return { requestId: input.requestId, tableNumber: request.tableNumber, approvedAt: now };
}

export interface AcceptInput {
  requestId: string;
  userId: string;
  /** The version of the table's live order the screen showed; required when the table has one. */
  expectedOrderVersion?: number;
}

/**
 * Accepts a waiting request: on a free table it opens a dine-in order with the lines, on a table with a live order it adds
 * them to it (the caller names the order's version). The lines keep the prices the guest was quoted, with the Menu's promotion
 * as a line discount. Two decisions of one request cannot both win. A lost race for the order number or the table is a unique
 * violation: the caller retries the whole call.
 */
export async function acceptRequestIn(db: AnyDb, restaurantId: string, input: AcceptInput, now: Date = new Date()) {
  // A request held for the captain is refused here, by the same guarded update, before any order is touched.
  const { count } = await db.posCustomerOrder.updateMany({
    where: { id: input.requestId, restaurantId, ...waiting(now), ...cleared },
    data: { status: 'ACCEPTED', decidedAt: now, decidedByUserId: input.userId },
  });
  if (count === 0) throw await whyNotPending(db, restaurantId, input.requestId, now, true);

  const request = await db.posCustomerOrder.findFirstOrThrow({ where: { id: input.requestId, restaurantId }, include: { lines: { orderBy: { id: 'asc' } } } });
  if (request.lines.length === 0) throw refuse('CONFLICT', 'The request has no items');

  const live = await db.posOrder.findFirst({ where: { restaurantId, tableId: request.tableId, status: { notIn: [...LOCKED_STATUSES] } } });
  let orderId: string;
  let version: number;
  let created: boolean;
  if (live) {
    if (live.status === 'PENDING_APPROVAL') throw refuse('CONFLICT', 'The table has an order that cannot take more items');
    if (input.expectedOrderVersion === undefined) throw refuse('CONFLICT', 'The order was changed by someone else. Reload it and try again.');
    await loadOrderForChange(db, restaurantId, live.id, input.expectedOrderVersion);
    const status = reopened(live.status, ['READY', 'BILL_REQUESTED']);
    version = await bumpOrder(db, restaurantId, live.id, input.expectedOrderVersion, status !== live.status ? { status } : {});
    orderId = live.id;
    created = false;
  } else {
    const opened = await openOrderIn(db, restaurantId, request.tableId);
    orderId = opened.orderId;
    version = opened.version;
    created = true;
  }

  const productIds = [...new Set(request.lines.flatMap((line) => (line.productId ? [line.productId] : [])))];
  const products = productIds.length ? await db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, categoryId: true } }) : [];
  const [productSettings, categorySettings, sections] = await Promise.all([
    db.posProductSetting.findMany({ where: { restaurantId, productId: { in: productIds } }, select: { productId: true, sectionId: true } }),
    db.posCategorySetting.findMany({ where: { restaurantId, categoryId: { in: products.map((p) => p.categoryId) } }, select: { categoryId: true, sectionId: true } }),
    db.posKitchenSection.findMany({ where: { restaurantId }, select: { id: true, name: true } }),
  ]);
  const sectionName = new Map(sections.map((section) => [section.id, section.name]));
  const categoryOf = new Map(products.map((p) => [p.id, p.categoryId]));
  const productSection = new Map(productSettings.map((s) => [s.productId, s.sectionId]));
  const categorySection = new Map(categorySettings.map((s) => [s.categoryId, s.sectionId]));

  await db.posOrderLine.createMany({
    data: request.lines.map((line) => {
      const categoryId = line.productId ? categoryOf.get(line.productId) : undefined;
      const wanted = (line.productId ? productSection.get(line.productId) : null) ?? (categoryId ? categorySection.get(categoryId) : null) ?? null;
      const sectionId = wanted && sectionName.has(wanted) ? wanted : null;
      return {
        restaurantId,
        orderId,
        productId: line.productId,
        nameSnapshot: line.nameSnapshot,
        unitPriceSnapshot: line.unitPriceSnapshot,
        quantity: line.quantity,
        note: line.note,
        optionsSnapshot: line.optionsSnapshot as Prisma.InputJsonValue,
        promoDiscountPerUnit: line.promoDiscountPerUnit,
        sectionId,
        sectionNameSnapshot: sectionId ? (sectionName.get(sectionId) ?? '') : '',
      };
    }),
  });
  await db.posCustomerOrder.updateMany({ where: { id: request.id, restaurantId }, data: { orderId } });
  return { requestId: request.id, orderId, created, version, tableNumber: request.tableNumber, lineCount: request.lines.length };
}

export async function rejectRequestIn(db: AnyDb, restaurantId: string, input: { requestId: string; userId: string; reason: string }, now: Date = new Date()) {
  const { count } = await db.posCustomerOrder.updateMany({
    where: { id: input.requestId, restaurantId, ...waiting(now) },
    data: { status: 'REJECTED', decidedAt: now, decidedByUserId: input.userId, rejectReason: input.reason },
  });
  if (count === 0) throw await whyNotPending(db, restaurantId, input.requestId, now);
  const request = await db.posCustomerOrder.findFirstOrThrow({ where: { id: input.requestId, restaurantId }, select: { tableNumber: true } });
  return { requestId: input.requestId, tableNumber: request.tableNumber, reason: input.reason };
}
