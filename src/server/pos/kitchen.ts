import type { Prisma } from '@/generated/prisma/client';
import type { AnyDb } from '@/server/data/tenant-db';
import { LOCKED_STATUSES } from '@/server/domain/pos/order-state';
import type { PosRole } from '@/server/domain/pos/permissions';
import { StudioError } from '@/server/studio/framework/result';
import { refuse } from './errors';
import { kitchenDone } from './kitchen-state';
import { bumpOrder, loadOrderForChange, optionsSnapshotSchema, readRates } from './orders';

/** Who is asking the kitchen: a KITCHEN member tied to one section sees only that section, whatever they ask for. */
export interface KitchenActor {
  userId: string;
  role: PosRole;
}

export interface KitchenCard {
  orderId: string;
  orderNumber: number;
  /** TAKEAWAY and DELIVERY have no table; they show their queue number instead. */
  kind: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';
  queueNumber: number | null;
  tableNumber: number | null;
  areaName: string | null;
  batch: number;
  sentAt: Date;
  sectionId: string | null;
  /** The section's name when the line was added; '' for lines with no section. */
  sectionName: string;
  lines: { id: string; name: string; quantity: number; options: string[]; note: string; ready: boolean }[];
  /** Sent lines cancelled before they were ready, not yet acknowledged by the kitchen. */
  cancelled: { id: string; name: string; quantity: number; reason: string }[];
  orderCancelled: boolean;
}

export interface KitchenTicket {
  orderNumber: number;
  kind: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';
  queueNumber: number | null;
  tableNumber: number | null;
  areaName: string | null;
  /** Who sent the round (else the person printing). */
  cashierName: string;
  printedAt: Date;
  sheets: { sectionId: string | null; sectionName: string; batch: number; sentAt: Date; lines: { name: string; quantity: number; options: string[]; note: string }[] }[];
  cancelSlips: { sectionId: string | null; sectionName: string; lines: { name: string; quantity: number; reason: string }[] }[];
}

export interface KitchenScope {
  print: boolean;
  screen: boolean;
  /** The one section a KITCHEN member is tied to; null when the person may see every section. */
  sectionId: string | null;
}

/** At most this many lines are read for one kitchen screen. */
export const QUEUE_LIMIT = 200;
/**
 * The kitchen screen ignores any line (and cancellation notice) sent more than this many hours ago, whatever the order's
 * status: a 12-hour-old ticket is stale. The order is untouched and the printed ticket is not limited. Without this, a
 * kitchen that only prints, where nobody marks lines ready, would pile old cards up until live orders were pushed off.
 */
export const KITCHEN_QUEUE_WINDOW_HOURS = 12;

/** A rejected order never shows. A cancelled one still shows its notices, and a paid one keeps its food to cook until ready. */
const HIDDEN = ['REJECTED'] as const;

/** Section names in name order, with "no section" ('') last. */
export function compareSectionNames(a: string, b: string): number {
  if (a === b) return 0;
  if (a === '') return 1;
  if (b === '') return -1;
  return a.localeCompare(b);
}

/** Oldest round first, then by order number, then by section ("no section" last), then by round. */
export function compareCards(
  a: Pick<KitchenCard, 'sentAt' | 'orderNumber' | 'sectionName' | 'batch'>,
  b: Pick<KitchenCard, 'sentAt' | 'orderNumber' | 'sectionName' | 'batch'>,
): number {
  return a.sentAt.getTime() - b.sentAt.getTime() || a.orderNumber - b.orderNumber || compareSectionNames(a.sectionName, b.sectionName) || a.batch - b.batch;
}

async function assertKitchenOn(db: AnyDb, restaurantId: string): Promise<void> {
  const rates = await readRates(db, restaurantId);
  if (!rates.kitchenPrintEnabled && !rates.kitchenScreenEnabled) throw refuse('CONFLICT', 'Kitchen mode is off');
}

/**
 * The section a KITCHEN member is tied to, which overrides any filter they ask for; `undefined` when they may see every
 * section. A KITCHEN member with no staff row here is refused: fail closed rather than show every section.
 */
async function forcedSection(db: AnyDb, restaurantId: string, actor: KitchenActor): Promise<string | undefined> {
  if (actor.role !== 'KITCHEN') return undefined;
  const staff = await db.posStaff.findFirst({ where: { userId: actor.userId, restaurantId }, select: { kitchenSectionId: true } });
  if (!staff) throw new StudioError('FORBIDDEN');
  return staff.kitchenSectionId ?? undefined;
}

export async function readKitchenScope(db: AnyDb, restaurantId: string, actor: KitchenActor): Promise<KitchenScope> {
  const [rates, forced] = await Promise.all([readRates(db, restaurantId), forcedSection(db, restaurantId, actor)]);
  return { print: rates.kitchenPrintEnabled, screen: rates.kitchenScreenEnabled, sectionId: forced ?? null };
}

/**
 * Sends every live line not sent yet as the next round (batch) of the order. A READY order goes back to OPEN (the kitchen has
 * new work); a BILL_REQUESTED order keeps its status.
 */
export async function sendToKitchenIn(db: AnyDb, restaurantId: string, input: { orderId: string; expectedVersion: number }) {
  await assertKitchenOn(db, restaurantId);
  const order = await loadOrderForChange(db, restaurantId, input.orderId, input.expectedVersion);
  if (order.status === 'PENDING_APPROVAL') throw refuse('CONFLICT', 'The order is waiting for approval');
  const status = order.status === 'READY' ? 'OPEN' : order.status;
  // A takeaway or delivery goes into PREPARING when the kitchen gets work (also back from READY, when new work arrives).
  const preparing = order.kind !== 'DINE_IN' && (order.fulfillment === 'NEW' || order.fulfillment === 'READY');
  // Bumping first row-locks the order, so the lines read below cannot change under us.
  const version = await bumpOrder(db, restaurantId, order.id, input.expectedVersion, { ...(status !== order.status ? { status } : {}), ...(preparing ? { fulfillment: 'PREPARING' as const } : {}) });
  const unsent = await db.posOrderLine.findMany({ where: { orderId: order.id, restaurantId, sentAt: null, cancelledAt: null }, select: { id: true } });
  if (unsent.length === 0) throw refuse('CONFLICT', 'Nothing new to send to the kitchen');
  const last = await db.posOrderLine.aggregate({ where: { orderId: order.id, restaurantId }, _max: { batch: true } });
  const batch = (last._max.batch ?? 0) + 1;
  const { count } = await db.posOrderLine.updateMany({
    where: { id: { in: unsent.map((line) => line.id) }, restaurantId, sentAt: null, cancelledAt: null },
    data: { sentAt: new Date(), batch },
  });
  return { orderId: order.id, batch, lineCount: count, version, from: order.status, to: status };
}

const queueLineSelect = {
  id: true,
  orderId: true,
  nameSnapshot: true,
  quantity: true,
  optionsSnapshot: true,
  note: true,
  sectionId: true,
  sectionNameSnapshot: true,
  sentAt: true,
  batch: true,
  readyAt: true,
  cancelledAt: true,
  cancelReason: true,
  createdAt: true,
} as const satisfies Prisma.PosOrderLineSelect;

const optionNames = (snapshot: unknown): string[] => optionsSnapshotSchema.parse(snapshot).map((option) => option.name);

/** The reason each of these orders was cancelled with, from the audit log (the order row does not keep it). */
async function orderCancelReasons(db: AnyDb, restaurantId: string, orderIds: string[]): Promise<Map<string, string>> {
  if (orderIds.length === 0) return new Map();
  const rows = await db.auditLog.findMany({
    where: { restaurantId, entityType: 'PosOrder', action: 'pos.order.cancel', entityId: { in: orderIds } },
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    select: { entityId: true, changes: true },
  });
  const reasons = new Map<string, string>();
  for (const row of rows) {
    if (reasons.has(row.entityId)) continue;
    const after = ((row.changes as { reason?: { after?: unknown } } | null)?.reason ?? {}).after;
    reasons.set(row.entityId, typeof after === 'string' ? after : '');
  }
  return reasons;
}

/**
 * The kitchen screen: one card per order, round and section, oldest first. A card shows while it has a line left to cook or
 * a cancellation the kitchen has not acknowledged; its ready lines stay on it so the cook sees the whole round. A KITCHEN
 * member tied to a section sees only that section, whatever `sectionId` asks; others may filter (`null` is "no section").
 * No prices.
 */
export async function readKitchenQueue(db: AnyDb, restaurantId: string, actor: KitchenActor, input: { sectionId?: string | null } = {}, now = new Date()): Promise<KitchenCard[]> {
  const oldest = new Date(now.getTime() - KITCHEN_QUEUE_WINDOW_HOURS * 3_600_000);
  const forced = await forcedSection(db, restaurantId, actor);
  const section = forced ?? input.sectionId;
  const sectionWhere: Prisma.PosOrderLineWhereInput = section === undefined ? {} : { sectionId: section };
  const pending = await db.posOrderLine.findMany({
    where: {
      restaurantId,
      ...sectionWhere,
      sentAt: { not: null, gte: oldest },
      readyAt: null,
      order: { status: { notIn: [...HIDDEN] } },
      OR: [
        { cancelledAt: null, order: { status: { not: 'CANCELLED' } } },
        { cancelAckAt: null, cancelledAt: { not: null } },
        { cancelAckAt: null, order: { status: 'CANCELLED' } },
      ],
    },
    orderBy: [{ sentAt: 'asc' }, { id: 'asc' }],
    take: QUEUE_LIMIT,
    select: queueLineSelect,
  });
  if (pending.length === 0) return [];
  const keyOf = (line: { orderId: string; batch: number | null; sectionId: string | null }) => `${line.orderId}|${line.batch}|${line.sectionId ?? ''}`;
  const keys = new Set(pending.map(keyOf));
  const orderIds = [...new Set(pending.map((line) => line.orderId))];
  // The ready lines of the same cards, so a half-done round shows whole.
  const ready = await db.posOrderLine.findMany({
    where: {
      restaurantId,
      ...sectionWhere,
      orderId: { in: orderIds },
      sentAt: { not: null, gte: oldest },
      readyAt: { not: null },
      cancelledAt: null,
      order: { status: { notIn: [...HIDDEN, 'CANCELLED'] } },
    },
    select: queueLineSelect,
  });
  const orders = await db.posOrder.findMany({
    where: { restaurantId, id: { in: orderIds } },
    select: { id: true, number: true, kind: true, queueNumber: true, status: true, table: { select: { number: true, area: { select: { name: true } } } } },
  });
  const orderById = new Map(orders.map((order) => [order.id, order]));
  const reasons = await orderCancelReasons(db, restaurantId, orders.filter((order) => order.status === 'CANCELLED').map((order) => order.id));

  const lines = [...pending, ...ready.filter((line) => keys.has(keyOf(line)))].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  const cards = new Map<string, KitchenCard>();
  for (const line of lines) {
    const order = orderById.get(line.orderId);
    if (!order || line.sentAt === null || line.batch === null) continue;
    const key = keyOf(line);
    let card = cards.get(key);
    if (!card) {
      card = {
        orderId: order.id,
        orderNumber: order.number,
        kind: order.kind,
        queueNumber: order.queueNumber,
        tableNumber: order.table?.number ?? null,
        areaName: order.table?.area.name ?? null,
        batch: line.batch,
        sentAt: line.sentAt,
        sectionId: line.sectionId,
        sectionName: line.sectionNameSnapshot,
        lines: [],
        cancelled: [],
        orderCancelled: order.status === 'CANCELLED',
      };
      cards.set(key, card);
    }
    if (line.sentAt < card.sentAt) card.sentAt = line.sentAt;
    if (line.cancelledAt !== null || order.status === 'CANCELLED') {
      card.cancelled.push({ id: line.id, name: line.nameSnapshot, quantity: line.quantity, reason: line.cancelReason ?? reasons.get(order.id) ?? '' });
    } else {
      card.lines.push({ id: line.id, name: line.nameSnapshot, quantity: line.quantity, options: optionNames(line.optionsSnapshot), note: line.note, ready: line.readyAt !== null });
    }
  }
  return [...cards.values()].filter((card) => card.cancelled.length > 0 || card.lines.some((line) => !line.ready)).sort(compareCards);
}

/** The lines, all of this restaurant (else NOT_FOUND) and of the person's section (else FORBIDDEN). */
async function loadKitchenLines(db: AnyDb, restaurantId: string, actor: KitchenActor, ids: string[]) {
  const lines = await db.posOrderLine.findMany({ where: { id: { in: ids }, restaurantId }, select: { id: true, orderId: true, sectionId: true } });
  if (lines.length !== ids.length) throw new StudioError('NOT_FOUND');
  const forced = await forcedSection(db, restaurantId, actor);
  if (forced !== undefined && lines.some((line) => line.sectionId !== forced)) throw new StudioError('FORBIDDEN');
  return lines;
}

/**
 * Marks sent lines ready. Lines already ready, cancelled or not sent are skipped, so a repeat (or a second cook) is harmless.
 * When the kitchen is done with an OPEN order (`kitchenDone`) it goes READY and the table turns green. The order is row-locked
 * first, so a send, a cancel and another mark of the same order happen one after the other and the count is exact. A paid
 * order's lines are still marked (the food was paid for before it was cooked) with no status change; a cancelled or rejected
 * order's lines are skipped.
 */
export async function markLinesReadyIn(db: AnyDb, restaurantId: string, input: { lineIds: string[]; actor: KitchenActor }) {
  const lines = await loadKitchenLines(db, restaurantId, input.actor, input.lineIds);
  await assertKitchenOn(db, restaurantId);
  const markedLineIds: { lineId: string; orderId: string }[] = [];
  const readied: { orderId: string; number: number }[] = [];
  // One order at a time, in id order, so two calls lock their orders in the same order and cannot deadlock.
  for (const orderId of [...new Set(lines.map((line) => line.orderId))].sort()) {
    const { count: live } = await db.posOrder.updateMany({ where: { id: orderId, restaurantId, status: { notIn: [...LOCKED_STATUSES] } }, data: { restaurantId } });
    if (live === 0) {
      const locked = await db.posOrder.findFirst({ where: { id: orderId, restaurantId }, select: { status: true } });
      if (locked?.status !== 'PAID') continue;
    }
    for (const line of lines.filter((l) => l.orderId === orderId)) {
      const { count } = await db.posOrderLine.updateMany({
        where: { id: line.id, restaurantId, sentAt: { not: null }, cancelledAt: null, readyAt: null },
        data: { readyAt: new Date() },
      });
      if (count === 1) markedLineIds.push({ lineId: line.id, orderId });
    }
    const order = await db.posOrder.findFirstOrThrow({ where: { id: orderId, restaurantId }, select: { status: true, number: true, kind: true, fulfillment: true } });
    if (live > 0 && order.status === 'OPEN' && (await kitchenDone(db, restaurantId, orderId))) {
      // The kitchen finishing a takeaway or delivery also makes it READY to hand over (unless the cashier already moved it on).
      const handOver = order.kind !== 'DINE_IN' && (order.fulfillment === 'NEW' || order.fulfillment === 'PREPARING');
      await db.posOrder.updateMany({ where: { id: orderId, restaurantId, status: 'OPEN' }, data: { status: 'READY', version: { increment: 1 }, ...(handOver ? { fulfillment: 'READY' as const } : {}) } });
      readied.push({ orderId, number: order.number });
    }
  }
  return { ready: markedLineIds.length, marked: markedLineIds, readied };
}

/**
 * The kitchen saw these cancellations: they leave the screen and the cancel slips. Only sent, not-ready lines that were
 * cancelled (or whose order was cancelled) and not acknowledged yet count; others are skipped.
 */
export async function acknowledgeCancellationsIn(db: AnyDb, restaurantId: string, input: { lineIds: string[]; actor: KitchenActor }) {
  const lines = await loadKitchenLines(db, restaurantId, input.actor, input.lineIds);
  await assertKitchenOn(db, restaurantId);
  // A cancelled order is final, so reading its status before the writes is safe.
  const cancelledOrders = new Set(
    (await db.posOrder.findMany({ where: { restaurantId, id: { in: [...new Set(lines.map((line) => line.orderId))] }, status: 'CANCELLED' }, select: { id: true } })).map((order) => order.id),
  );
  const acknowledged: { lineId: string; orderId: string }[] = [];
  for (const line of lines) {
    const { count } = await db.posOrderLine.updateMany({
      where: {
        id: line.id,
        restaurantId,
        sentAt: { not: null },
        readyAt: null,
        cancelAckAt: null,
        ...(cancelledOrders.has(line.orderId) ? {} : { cancelledAt: { not: null } }),
      },
      data: { cancelAckAt: new Date() },
    });
    if (count === 1) acknowledged.push({ lineId: line.id, orderId: line.orderId });
  }
  return { acknowledged: acknowledged.length, lines: acknowledged };
}

/** The name of whoever sent the round, from the audit log; else the person asking. */
async function senderName(db: AnyDb, restaurantId: string, actor: KitchenActor, orderId: string, batch: number | null): Promise<string> {
  const sent =
    batch === null
      ? null
      : await db.auditLog.findFirst({
          where: { restaurantId, entityType: 'PosOrder', entityId: orderId, action: 'pos.order.kitchen.send', changes: { path: ['batch', 'after'], equals: batch } },
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
          select: { actorId: true },
        });
  const user = await db.user.findFirst({ where: { id: sent?.actorId ?? actor.userId }, select: { name: true } });
  return user?.name ?? '';
}

/**
 * The printed kitchen ticket of one round (the latest by default): one sheet per section, plus a CANCELLED slip per section
 * for sent lines cancelled before they were ready and not acknowledged yet. No prices.
 */
export async function readKitchenTicket(db: AnyDb, restaurantId: string, actor: KitchenActor, input: { orderId: string; batch?: number }): Promise<KitchenTicket> {
  const order = await db.posOrder.findFirst({
    where: { id: input.orderId, restaurantId },
    select: { id: true, number: true, kind: true, queueNumber: true, status: true, table: { select: { number: true, area: { select: { name: true } } } } },
  });
  if (!order) throw new StudioError('NOT_FOUND');
  const forced = await forcedSection(db, restaurantId, actor);
  const sectionWhere: Prisma.PosOrderLineWhereInput = forced === undefined ? {} : { sectionId: forced };
  const batch = input.batch ?? (await db.posOrderLine.aggregate({ where: { orderId: order.id, restaurantId }, _max: { batch: true } }))._max.batch;
  const orderCancelled = order.status === 'CANCELLED';

  const sheetLines =
    batch === null || orderCancelled
      ? []
      : await db.posOrderLine.findMany({
          where: { orderId: order.id, restaurantId, ...sectionWhere, batch, sentAt: { not: null }, cancelledAt: null },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: queueLineSelect,
        });
  const sheets = new Map<string, KitchenTicket['sheets'][number]>();
  for (const line of sheetLines) {
    if (line.sentAt === null || line.batch === null) continue;
    const key = line.sectionId ?? '';
    let sheet = sheets.get(key);
    if (!sheet) {
      sheet = { sectionId: line.sectionId, sectionName: line.sectionNameSnapshot, batch: line.batch, sentAt: line.sentAt, lines: [] };
      sheets.set(key, sheet);
    }
    sheet.lines.push({ name: line.nameSnapshot, quantity: line.quantity, options: optionNames(line.optionsSnapshot), note: line.note });
  }

  const cancelledLines = await db.posOrderLine.findMany({
    where: { orderId: order.id, restaurantId, ...sectionWhere, sentAt: { not: null }, readyAt: null, cancelAckAt: null, ...(orderCancelled ? {} : { cancelledAt: { not: null } }) },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: queueLineSelect,
  });
  const orderReason = orderCancelled ? ((await orderCancelReasons(db, restaurantId, [order.id])).get(order.id) ?? '') : '';
  const slips = new Map<string, KitchenTicket['cancelSlips'][number]>();
  for (const line of cancelledLines) {
    const key = line.sectionId ?? '';
    let slip = slips.get(key);
    if (!slip) {
      slip = { sectionId: line.sectionId, sectionName: line.sectionNameSnapshot, lines: [] };
      slips.set(key, slip);
    }
    slip.lines.push({ name: line.nameSnapshot, quantity: line.quantity, reason: line.cancelReason ?? orderReason });
  }

  return {
    orderNumber: order.number,
    kind: order.kind,
    queueNumber: order.queueNumber,
    tableNumber: order.table?.number ?? null,
    areaName: order.table?.area.name ?? null,
    cashierName: await senderName(db, restaurantId, actor, order.id, batch),
    printedAt: new Date(),
    sheets: [...sheets.values()].sort((a, b) => compareSectionNames(a.sectionName, b.sectionName)),
    cancelSlips: [...slips.values()].sort((a, b) => compareSectionNames(a.sectionName, b.sectionName)),
  };
}
