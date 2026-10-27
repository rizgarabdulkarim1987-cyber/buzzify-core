import type { Prisma } from '@/generated/prisma/client';
import type { AnyDb } from '@/server/data/tenant-db';
import { expiryCutoff, isExpired, QR_LIMITS } from '@/server/domain/pos/customer-order-rules';
import { LOCKED_STATUSES } from '@/server/domain/pos/order-state';
import { StudioError } from '@/server/studio/framework/result';
import { refuse } from './errors';
import { bumpOrder, loadOrderForChange, openOrderIn, optionsSnapshotSchema, reopened, type OptionSnapshot } from './orders';

/** What the requests list shows of one request. */
export interface RequestSummary {
  id: string;
  tableId: string;
  tableNumber: number;
  createdAt: Date;
  lineCount: number;
  total: number;
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
  lines: LineRow[];
};

function detailOf(row: DetailRow, live: { id: string; version: number } | undefined, now: Date): RequestDetail {
  const lines = row.lines.map(lineView);
  return {
    id: row.id,
    tableId: row.tableId,
    tableNumber: row.tableNumber,
    createdAt: row.createdAt,
    lineCount: lines.length,
    total: lines.reduce((sum, line) => sum + line.lineTotal, 0),
    status: row.status,
    expired: row.status === 'PENDING' && isExpired(row.createdAt, now),
    customerNote: row.customerNote,
    locale: row.locale,
    rejectReason: row.rejectReason,
    lines,
    liveOrderId: live?.id ?? null,
    liveOrderVersion: live?.version ?? null,
  };
}

export async function readRequest(db: AnyDb, restaurantId: string, id: string, now: Date = new Date()): Promise<RequestDetail> {
  const row = await db.posCustomerOrder.findFirst({ where: { id, restaurantId }, include: { lines: { orderBy: { id: 'asc' } } } });
  if (!row) throw new StudioError('NOT_FOUND');
  const live = await db.posOrder.findFirst({
    where: { restaurantId, tableId: row.tableId, status: { notIn: [...LOCKED_STATUSES] } },
    select: { id: true, version: true },
  });
  return detailOf(row, live ?? undefined, now);
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
  return rows.map((row) => detailOf(row, byTable.get(row.tableId), now));
}

/** Why a request cannot be decided or edited now: unknown, already decided, or expired. */
async function whyNotPending(db: AnyDb, restaurantId: string, id: string, now: Date): Promise<StudioError> {
  const row = await db.posCustomerOrder.findFirst({ where: { id, restaurantId }, select: { status: true, createdAt: true } });
  if (!row) return new StudioError('NOT_FOUND');
  if (row.status !== 'PENDING') return refuse('CONFLICT', 'This request was already decided');
  return isExpired(row.createdAt, now) ? refuse('CONFLICT', 'This request expired') : refuse('CONFLICT', 'This request was already decided');
}

/**
 * Locks the request while it is still waiting: a no-op update that matches only a PENDING, unexpired request, so an edit and a
 * decision of the same request run one after the other and the second sees what the first did.
 */
async function lockPending(db: AnyDb, restaurantId: string, id: string, now: Date): Promise<void> {
  const { count } = await db.posCustomerOrder.updateMany({ where: { id, restaurantId, ...waiting(now) }, data: { status: 'PENDING' } });
  if (count === 0) throw await whyNotPending(db, restaurantId, id, now);
}

async function lineOf(db: AnyDb, restaurantId: string, lineId: string) {
  const line = await db.posCustomerOrderLine.findFirst({ where: { id: lineId, restaurantId }, select: { id: true, requestId: true, nameSnapshot: true, quantity: true } });
  if (!line) throw new StudioError('NOT_FOUND');
  return line;
}

export async function setRequestLineQuantityIn(db: AnyDb, restaurantId: string, input: { lineId: string; quantity: number }, now: Date = new Date()) {
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > QR_LIMITS.maxQuantity) {
    throw new StudioError('INVALID', 'Nothing to change', { quantity: 'Nothing to change' });
  }
  const line = await lineOf(db, restaurantId, input.lineId);
  await lockPending(db, restaurantId, line.requestId, now);
  await db.posCustomerOrderLine.updateMany({ where: { id: line.id, restaurantId }, data: { quantity: input.quantity } });
  return { requestId: line.requestId, lineId: line.id, name: line.nameSnapshot, before: line.quantity, after: input.quantity };
}

export async function removeRequestLineIn(db: AnyDb, restaurantId: string, input: { lineId: string }, now: Date = new Date()) {
  const line = await lineOf(db, restaurantId, input.lineId);
  await lockPending(db, restaurantId, line.requestId, now);
  await db.posCustomerOrderLine.deleteMany({ where: { id: line.id, restaurantId } });
  return { requestId: line.requestId, lineId: line.id, name: line.nameSnapshot, quantity: line.quantity };
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
  const { count } = await db.posCustomerOrder.updateMany({
    where: { id: input.requestId, restaurantId, ...waiting(now) },
    data: { status: 'ACCEPTED', decidedAt: now, decidedByUserId: input.userId },
  });
  if (count === 0) throw await whyNotPending(db, restaurantId, input.requestId, now);

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
        ...(line.promoDiscountPerUnit > 0 ? { discountKind: 'AMOUNT' as const, discountValue: line.promoDiscountPerUnit * line.quantity } : {}),
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
