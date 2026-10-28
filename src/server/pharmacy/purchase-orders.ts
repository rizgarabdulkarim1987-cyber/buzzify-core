import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ScopedClient, ScopedTx } from '@/server/data/tenant-db';
import { utcToday } from '@/server/domain/pharmacy/expiry';
import { canTransition, checkReceipt, poStatusAfterReceipt, PurchasingError, type PoStatus } from '@/server/domain/pharmacy/purchasing';
import { saleNumber } from '@/server/domain/pharmacy/sale';
import { updateWithVersion } from '@/server/studio/framework/concurrency';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from './actor';
import { mayViewCost } from './products';
import { cleanText, NS_CLIENT_KEY, PAGE_SIZE } from './suppliers';

/**
 * Purchase orders (R4-2, R4-10, R4-11, R4-12): a branch's order to one supplier in one currency. DRAFT is editable;
 * ORDERED gets its number; after that the order only moves by receiving (task 5 owns the received counters) or by a
 * cancel (nothing received) or a close (a reason). The services take the transaction (or scoped client) of the action or
 * query that calls them; the actions audit.
 *
 * Lock order of this phase (header comment of every service that locks): client key (advisory, namespace 7201) -> PO row
 * FOR UPDATE -> receipt line counters FOR UPDATE -> invoice rows FOR UPDATE ordered by id -> stock rows (phase 2/3 order)
 * -> number lock (7202). This file takes the client key, the PO row, then the number lock. Receiving against an order
 * (`lockOrderRow` then `lockOrderLines`, called by `confirmReceipt` and by `updateDraft` in receipts.ts) keeps one order
 * for every path that touches an order together with a receipt: order rows (sorted by id) -> the receipt row -> the
 * order's lines (by id) -> the branch lock -> stock rows. The received counters are written only here
 * (`applyReceiptToOrder`).
 */

/** The advisory-lock namespace of purchase order numbering (the second int is `hashtext(po:branchId)`). */
export const NS_PO_NUMBER = 7202;

export const MAX_PO_LINES = 200;
const MAX_MINOR = 9_223_372_036_854_775_807n;
const MAX_QTY = 1_000_000_000;
const WHOLE = 'Enter a whole number';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const midnight = (date: string) => new Date(`${date}T00:00:00.000Z`);

const dateText = z
  .string()
  .trim()
  .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && iso(midnight(v)) === v, 'Enter a date as YYYY-MM-DD');

export const poLineInput = z.object({
  productId: z.string().min(1).max(64),
  unitId: z.string().min(1).max(64),
  qtyOrdered: z.number(WHOLE).int(WHOLE).min(1, 'Use 1 or more').max(MAX_QTY, 'Enter a smaller number'),
  bonusOrdered: z.number(WHOLE).int(WHOLE).min(0, 'Use 0 or more').max(MAX_QTY, 'Enter a smaller number').default(0),
  unitCostMinor: z.coerce.bigint('Enter the cost').min(0n, 'Use 0 or more').max(MAX_MINOR, 'Enter a smaller amount'),
});
export type PoLineInput = z.infer<typeof poLineInput>;

/** What a person enters for an order; the branch comes from the place. */
export const poFields = z.object({
  supplierId: z.string().min(1).max(64),
  currency: z.enum(['IQD', 'USD'], 'Choose IQD or USD'),
  expectedOn: dateText.nullish(),
  note: z.string().transform(cleanText).pipe(z.string().max(500, 'Use at most 500 characters')).default(''),
  lines: z.array(poLineInput).min(1, 'Add at least one line').max(MAX_PO_LINES, 'Use at most 200 lines'),
});
export type PoFields = z.infer<typeof poFields>;

export const poListInput = z.object({
  status: z.enum(['DRAFT', 'ORDERED', 'PARTIAL', 'RECEIVED', 'CLOSED', 'CANCELLED']).optional(),
  supplierId: z.string().min(1).max(64).optional(),
  /** Matches inside the order number. */
  search: z.string().trim().max(100, 'Use at most 100 characters').optional(),
  cursor: z.string().min(1).max(64).nullish(),
});
export type PoListInput = z.infer<typeof poListInput>;

export const closeReason = z.string().transform(cleanText).pipe(z.string().min(3, 'Use at least 3 characters').max(300, 'Use at most 300 characters'));

const notFound = () => new StudioError('NOT_FOUND', 'Purchase order not found');
const notDraft = () => new StudioError('CONFLICT', 'Only a draft order can change', { phCode: 'NOT_DRAFT' });
const keyMismatch = () => new StudioError('CONFLICT', 'This key was already used for a different order', { phCode: 'CLIENT_KEY_MISMATCH' });
const badTransition = () => new StudioError('CONFLICT', 'This order cannot move to that state', { phCode: 'INVALID_TRANSITION' });
const hasReceived = () => new StudioError('CONFLICT', 'Goods were already received on this order', { phCode: 'HAS_RECEIVED' });
const archived = () => new StudioError('CONFLICT', 'This supplier is archived', { phCode: 'SUPPLIER_ARCHIVED' });
const invalid = (field: string, message: string, extra: Record<string, string> = {}) => new StudioError('INVALID', message, { [field]: message, ...extra });

// Lines and header -----------------------------------------------------------------------------------------------------

/** The hash a replayed `clientKey` is compared by: every field of the request that makes the order, canonically ordered. */
export function poPayloadHash(branchId: string, input: PoFields): string {
  const canonical = JSON.stringify([
    branchId,
    input.supplierId,
    input.currency,
    input.expectedOn ?? null,
    input.note,
    input.lines.map((l) => [l.productId, l.unitId, l.qtyOrdered, l.bonusOrdered, l.unitCostMinor.toString()]),
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

/** The supplier must be the business's own and live. A foreign id is as missing as a made-up one. */
async function liveSupplier(tx: ScopedTx, supplierId: string): Promise<void> {
  const supplier = await tx.phSupplier.findFirst({ where: { id: supplierId }, select: { active: true } });
  if (!supplier) throw new StudioError('NOT_FOUND', 'Supplier not found');
  if (!supplier.active) throw archived();
}

/** One line per product and unit; each product is the business's own and active; each unit is a unit of its product. */
async function checkLines(tx: ScopedTx, lines: readonly PoLineInput[]): Promise<void> {
  const seen = new Set<string>();
  lines.forEach((l, i) => {
    const key = `${l.productId}|${l.unitId}`;
    if (seen.has(key)) throw invalid(`lines.${i}.productId`, 'Each product and unit can be on an order once', { phCode: 'DUPLICATE_LINE' });
    seen.add(key);
  });
  const productIds = [...new Set(lines.map((l) => l.productId))];
  const [products, units] = await Promise.all([
    tx.phProduct.findMany({ where: { id: { in: productIds } }, select: { id: true, active: true } }),
    tx.phProductUnit.findMany({ where: { productId: { in: productIds } }, select: { id: true, productId: true } }),
  ]);
  const live = new Set(products.filter((p) => p.active).map((p) => p.id));
  const unitProduct = new Map(units.map((u) => [u.id, u.productId]));
  lines.forEach((l, i) => {
    if (!live.has(l.productId)) throw invalid(`lines.${i}.productId`, 'Choose one of this pharmacy’s active products');
    if (unitProduct.get(l.unitId) !== l.productId) throw invalid(`lines.${i}.unitId`, 'Choose one of this product’s units');
  });
}

function lineRows(restaurantId: string, purchaseOrderId: string, lines: readonly PoLineInput[]) {
  return lines.map((l, i) => ({
    restaurantId,
    purchaseOrderId,
    lineNo: i + 1,
    productId: l.productId,
    unitId: l.unitId,
    qtyOrdered: l.qtyOrdered,
    bonusOrdered: l.bonusOrdered,
    unitCostMinor: l.unitCostMinor,
  }));
}

// Create ---------------------------------------------------------------------------------------------------------------

export interface PoCreated {
  id: string;
  version: number;
  status: PoStatus;
  currency: 'IQD' | 'USD';
  lineCount: number;
  replayed: boolean;
}

/**
 * A new DRAFT order in `branchId`, or the one the same `clientKey` already made (a repeat changes nothing). A repeat must
 * come from the same person, for the same branch, with the same payload: anything else is `CLIENT_KEY_MISMATCH`.
 */
export async function createPurchaseOrder(
  tx: ScopedTx,
  args: { restaurantId: string; branchId: string; userId: string; clientKey: string; input: PoFields },
): Promise<PoCreated> {
  const { input } = args;
  const hash = poPayloadHash(args.branchId, input);
  // eslint-disable-next-line no-restricted-properties -- an advisory lock touches no tenant rows: it only serialises one client key
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NS_CLIENT_KEY}::int, hashtext(${`${args.restaurantId}:${args.clientKey}`}))`;
  const earlier = await tx.phPurchaseOrder.findFirst({
    where: { clientKey: args.clientKey },
    select: { id: true, version: true, status: true, currency: true, branchId: true, createdById: true, payloadHash: true, _count: { select: { lines: true } } },
  });
  if (earlier) {
    if (earlier.branchId !== args.branchId || earlier.createdById !== args.userId || earlier.payloadHash !== hash) throw keyMismatch();
    return { id: earlier.id, version: earlier.version, status: earlier.status, currency: earlier.currency, lineCount: earlier._count.lines, replayed: true };
  }
  await liveSupplier(tx, input.supplierId);
  await checkLines(tx, input.lines);
  const order = await tx.phPurchaseOrder.create({
    data: {
      restaurantId: args.restaurantId,
      branchId: args.branchId,
      supplierId: input.supplierId,
      currency: input.currency,
      clientKey: args.clientKey,
      payloadHash: hash,
      expectedOn: input.expectedOn ? midnight(input.expectedOn) : null,
      note: input.note,
      createdById: args.userId,
    },
    select: { id: true, version: true, currency: true },
  });
  await tx.phPurchaseOrderLine.createMany({ data: lineRows(args.restaurantId, order.id, input.lines) });
  return { id: order.id, version: order.version, status: 'DRAFT', currency: order.currency, lineCount: input.lines.length, replayed: false };
}

// State changes ----------------------------------------------------------------------------------------------------------

interface Head {
  id: string;
  status: PoStatus;
  version: number;
  branchId: string;
  supplierId: string;
  currency: 'IQD' | 'USD';
  number: string | null;
}

/**
 * The order, locked `FOR UPDATE` and read again after the lock (so a change that committed while this waited is seen).
 * An order of another business or of a branch the actor may not use is not found, whether or not it exists.
 */
async function lockHead(tx: ScopedTx, restaurantId: string, purchaseOrderId: string): Promise<Head> {
  const visible = await tx.phPurchaseOrder.findFirst({ where: { id: purchaseOrderId }, select: { id: true } });
  if (!visible) throw notFound();
  // eslint-disable-next-line no-restricted-properties -- a row lock on one order, found above through the scoped client
  await tx.$queryRaw`SELECT "id" FROM "PhPurchaseOrder" WHERE "id" = ${purchaseOrderId} AND "restaurantId" = ${restaurantId} FOR UPDATE`;
  const head = await tx.phPurchaseOrder.findFirst({
    where: { id: purchaseOrderId },
    select: { id: true, status: true, version: true, branchId: true, supplierId: true, currency: true, number: true },
  });
  if (!head) throw notFound();
  return head;
}

/** A stale `expectedVersion` is `CONFLICT` (with who changed it last, from the audit log); the row lock is held, so it cannot win by luck. */
async function assertVersion(tx: ScopedTx, head: Head, expectedVersion: number): Promise<void> {
  if (head.version === expectedVersion) return;
  await updateWithVersion(tx.phPurchaseOrder, { id: head.id, version: expectedVersion, data: {}, entityType: 'PhPurchaseOrder' }, tx);
  throw new StudioError('CONFLICT');
}

export interface PoChanged {
  id: string;
  version: number;
  status: PoStatus;
  before: PoStatus;
  currency: 'IQD' | 'USD';
  lineCount: number;
  number: string | null;
  /** What the order was before this change (for the audit trail). */
  currencyBefore: 'IQD' | 'USD';
  lineCountBefore: number;
  supplierIdBefore: string;
  supplierId: string;
}

/** Replaces a DRAFT's header and lines, if it is still a draft at `expectedVersion`. */
export async function updatePurchaseOrder(
  tx: ScopedTx,
  args: { restaurantId: string; purchaseOrderId: string; expectedVersion: number; input: PoFields },
): Promise<PoChanged> {
  const head = await lockHead(tx, args.restaurantId, args.purchaseOrderId);
  await assertVersion(tx, head, args.expectedVersion);
  if (head.status !== 'DRAFT') throw notDraft();
  const { input } = args;
  await liveSupplier(tx, input.supplierId);
  await checkLines(tx, input.lines);
  const lineCountBefore = await tx.phPurchaseOrderLine.count({ where: { purchaseOrderId: head.id } });
  await updateWithVersion(
    tx.phPurchaseOrder,
    {
      id: head.id,
      version: args.expectedVersion,
      data: { supplierId: input.supplierId, currency: input.currency, expectedOn: input.expectedOn ? midnight(input.expectedOn) : null, note: input.note },
      entityType: 'PhPurchaseOrder',
    },
    tx,
  );
  await tx.phPurchaseOrderLine.deleteMany({ where: { purchaseOrderId: head.id } });
  await tx.phPurchaseOrderLine.createMany({ data: lineRows(args.restaurantId, head.id, input.lines) });
  return {
    id: head.id,
    version: args.expectedVersion + 1,
    status: 'DRAFT',
    before: 'DRAFT',
    currency: input.currency,
    lineCount: input.lines.length,
    number: null,
    currencyBefore: head.currency,
    lineCountBefore,
    supplierIdBefore: head.supplierId,
    supplierId: input.supplierId,
  };
}

/** DRAFT to ORDERED: the supplier must still be live; the order gets its per-branch, per-UTC-day number. */
export async function placeOrder(
  tx: ScopedTx,
  args: { restaurantId: string; purchaseOrderId: string; expectedVersion: number; userId: string; now?: Date },
): Promise<PoChanged> {
  const now = args.now ?? new Date();
  const head = await lockHead(tx, args.restaurantId, args.purchaseOrderId);
  await assertVersion(tx, head, args.expectedVersion);
  if (head.status !== 'DRAFT') throw notDraft();
  await liveSupplier(tx, head.supplierId);
  const lineCount = await tx.phPurchaseOrderLine.count({ where: { purchaseOrderId: head.id } });
  // The branch's numbering: taken last (R4-11). The day's count is stable under the lock, and the unique key is the backstop.
  // eslint-disable-next-line no-restricted-properties -- an advisory lock touches no tenant rows: it only serialises one branch's order numbers
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NS_PO_NUMBER}::int, hashtext(${`po:${head.branchId}`}))`;
  const day = utcToday(now).replaceAll('-', '');
  const issued = await tx.phPurchaseOrder.count({ where: { branchId: head.branchId, number: { startsWith: `PO-${day}-` } } });
  const number = `PO-${saleNumber(now.toISOString(), issued + 1)}`;
  await updateWithVersion(
    tx.phPurchaseOrder,
    { id: head.id, version: args.expectedVersion, data: { status: 'ORDERED', number, orderedAt: now, orderedById: args.userId }, entityType: 'PhPurchaseOrder' },
    tx,
  );
  return { id: head.id, version: args.expectedVersion + 1, status: 'ORDERED', before: 'DRAFT', currency: head.currency, lineCount, number, currencyBefore: head.currency, lineCountBefore: lineCount, supplierIdBefore: head.supplierId, supplierId: head.supplierId };
}

/** Whether any line of the order has received anything (the counters task 5 maintains). */
async function anyReceived(tx: ScopedTx, purchaseOrderId: string): Promise<boolean> {
  const lines = await tx.phPurchaseOrderLine.findMany({ where: { purchaseOrderId }, select: { receivedQty: true, receivedBonus: true } });
  return lines.some((l) => l.receivedQty + l.receivedBonus > 0);
}

async function moveTo(
  tx: ScopedTx,
  args: { restaurantId: string; purchaseOrderId: string; expectedVersion: number },
  to: 'CANCELLED' | 'CLOSED',
  data: Record<string, unknown>,
): Promise<PoChanged> {
  const head = await lockHead(tx, args.restaurantId, args.purchaseOrderId);
  await assertVersion(tx, head, args.expectedVersion);
  const received = await anyReceived(tx, head.id);
  if (!canTransition(head.status, to, received)) {
    // Goods came in: say so, rather than "cannot move" (a cancel is for an order nothing was received on).
    throw to === 'CANCELLED' && received && (head.status === 'ORDERED' || head.status === 'PARTIAL' || head.status === 'RECEIVED') ? hasReceived() : badTransition();
  }
  await updateWithVersion(tx.phPurchaseOrder, { id: head.id, version: args.expectedVersion, data: { status: to, ...data }, entityType: 'PhPurchaseOrder' }, tx);
  const lineCount = await tx.phPurchaseOrderLine.count({ where: { purchaseOrderId: head.id } });
  return {
    id: head.id,
    version: args.expectedVersion + 1,
    status: to,
    before: head.status,
    currency: head.currency,
    lineCount,
    number: head.number,
    currencyBefore: head.currency,
    lineCountBefore: lineCount,
    supplierIdBefore: head.supplierId,
    supplierId: head.supplierId,
  };
}

/** DRAFT, or ORDERED with nothing received, to CANCELLED. */
export function cancelPurchaseOrder(tx: ScopedTx, args: { restaurantId: string; purchaseOrderId: string; expectedVersion: number; now?: Date }): Promise<PoChanged> {
  return moveTo(tx, args, 'CANCELLED', { cancelledAt: args.now ?? new Date() });
}

/** ORDERED, PARTIAL or RECEIVED to CLOSED: stop waiting for the rest, with a reason. */
export function closePurchaseOrder(
  tx: ScopedTx,
  args: { restaurantId: string; purchaseOrderId: string; expectedVersion: number; userId: string; reason: string; now?: Date },
): Promise<PoChanged> {
  return moveTo(tx, args, 'CLOSED', { closedAt: args.now ?? new Date(), closedById: args.userId, closeReason: args.reason });
}

// Receiving against an order (R4-3) --------------------------------------------------------------------------------------

const notOnOrder = (field: string) => invalid(field, 'This product is not on the order', { phCode: 'NOT_ON_ORDER' });
const orderNotOpen = () => new StudioError('CONFLICT', 'This order is not open for receiving', { phCode: 'ORDER_NOT_OPEN' });
const supplierMismatch = () => invalid('supplierId', 'This supplier is not the order’s supplier', { phCode: 'SUPPLIER_MISMATCH' });
const overReceipt = () => new StudioError('CONFLICT', 'More was received than was ordered', { phCode: 'OVER_RECEIPT' });

/** What a receipt draft says about its supplier and order, as the receipts service validates it. */
export interface ReceiptLinksInput {
  supplierId?: string | undefined;
  purchaseOrderId?: string | undefined;
  supplierName: string;
  lines: readonly { productId: string; unitId: string; purchaseOrderLineId?: string | undefined }[];
}

/**
 * Checks a receipt draft's supplier and order against the business and the receipt's branch, and returns what to store:
 * with an order, its supplier (a different `supplierId` is refused) and every line on one of its lines (same product and
 * unit); without one, a live supplier at most and no order line. The name text is filled from the supplier when empty.
 * An order of another branch or business is not found. Counters are not touched: a draft reserves nothing.
 */
export async function resolveReceiptLinks(
  tx: ScopedTx,
  args: { branchId: string; input: ReceiptLinksInput },
): Promise<{ supplierId: string | null; purchaseOrderId: string | null; supplierName: string }> {
  const { input } = args;
  if (!input.purchaseOrderId) {
    input.lines.forEach((l, i) => {
      if (l.purchaseOrderLineId) throw notOnOrder(`lines.${i}.purchaseOrderLineId`);
    });
    if (!input.supplierId) return { supplierId: null, purchaseOrderId: null, supplierName: input.supplierName };
    const supplier = await tx.phSupplier.findFirst({ where: { id: input.supplierId }, select: { name: true, active: true } });
    if (!supplier) throw new StudioError('NOT_FOUND', 'Supplier not found');
    if (!supplier.active) throw archived();
    return { supplierId: input.supplierId, purchaseOrderId: null, supplierName: input.supplierName || supplier.name };
  }
  const order = await tx.phPurchaseOrder.findFirst({
    where: { id: input.purchaseOrderId },
    select: { branchId: true, supplierId: true, status: true, supplier: { select: { name: true } }, lines: { select: { id: true, productId: true, unitId: true } } },
  });
  if (!order || order.branchId !== args.branchId) throw notFound();
  if (order.status !== 'ORDERED' && order.status !== 'PARTIAL') throw orderNotOpen();
  if (input.supplierId && input.supplierId !== order.supplierId) throw supplierMismatch();
  const byId = new Map(order.lines.map((l) => [l.id, l]));
  input.lines.forEach((l, i) => {
    const target = l.purchaseOrderLineId ? byId.get(l.purchaseOrderLineId) : undefined;
    if (!target || target.productId !== l.productId || target.unitId !== l.unitId) throw notOnOrder(`lines.${i}.purchaseOrderLineId`);
  });
  return { supplierId: order.supplierId, purchaseOrderId: input.purchaseOrderId, supplierName: input.supplierName || order.supplier.name };
}

/**
 * Step one of confirming a receipt for an order: the order row FOR UPDATE (a parallel cancel or close waits on it, so it
 * can never end CANCELLED while a confirm adds to the counters). Taken before the receipt row, as `updateDraft` does.
 */
export async function lockOrderRow(tx: ScopedTx, args: { restaurantId: string; purchaseOrderId: string }): Promise<void> {
  await lockHead(tx, args.restaurantId, args.purchaseOrderId);
}

/**
 * Step three: with the receipt row already locked, lock the order's lines ordered by id and refuse an order that is no
 * longer ORDERED or PARTIAL (read under the order row lock, so it is the committed truth).
 */
export async function lockOrderLines(tx: ScopedTx, args: { restaurantId: string; purchaseOrderId: string }): Promise<void> {
  // eslint-disable-next-line no-restricted-properties -- row locks on the order's lines, in id order (R4-11), after the order and receipt rows
  await tx.$queryRaw`SELECT "id" FROM "PhPurchaseOrderLine" WHERE "purchaseOrderId" = ${args.purchaseOrderId} AND "restaurantId" = ${args.restaurantId} ORDER BY "id" FOR UPDATE`;
  const head = await tx.phPurchaseOrder.findFirst({ where: { id: args.purchaseOrderId }, select: { status: true } });
  if (!head) throw notFound();
  if (head.status !== 'ORDERED' && head.status !== 'PARTIAL') throw orderNotOpen();
}

/**
 * Saving a draft receipt that names (or named) orders: FOR SHARE on each order row, sorted by id, before the receipt row
 * is touched. SHARE is enough and keeps two drafts of one order from queueing behind each other: what matters is that a
 * confirm (FOR UPDATE on its order first), a cancel or a close cannot slip between the order check and the save, and
 * that this path takes order rows before the receipt row, as the confirm does. Unknown or foreign ids lock nothing.
 */
export async function lockOrdersShared(tx: ScopedTx, args: { restaurantId: string; purchaseOrderIds: readonly (string | null | undefined)[] }): Promise<void> {
  const ids = [...new Set(args.purchaseOrderIds.filter((id): id is string => !!id))].sort();
  for (const id of ids) {
    // eslint-disable-next-line no-restricted-properties -- a share lock on one order of this business, in id order, before the receipt row
    await tx.$queryRaw`SELECT "id" FROM "PhPurchaseOrder" WHERE "id" = ${id} AND "restaurantId" = ${args.restaurantId} FOR SHARE`;
  }
}

/**
 * Adds a confirmed receipt's quantities to the order's line counters (the only place they are written) and moves the
 * order's status and version. The caller holds `lockOrderForReceipt`. Quantity and bonus are checked separately against
 * what was ordered, over everything already received: more is `OVER_RECEIPT` (the caller's transaction rolls back).
 */
export async function applyReceiptToOrder(
  tx: ScopedTx,
  args: { purchaseOrderId: string; lines: readonly { purchaseOrderLineId: string | null; qty: number; bonusQty: number }[] },
): Promise<{ before: PoStatus; after: PoStatus }> {
  const order = await tx.phPurchaseOrder.findFirst({ where: { id: args.purchaseOrderId }, select: { id: true, status: true, version: true } });
  if (!order) throw notFound();
  const orderLines = await tx.phPurchaseOrderLine.findMany({
    where: { purchaseOrderId: args.purchaseOrderId },
    select: { id: true, qtyOrdered: true, bonusOrdered: true, receivedQty: true, receivedBonus: true },
    orderBy: { id: 'asc' },
  });
  const byId = new Map(orderLines.map((l) => [l.id, l]));
  const sums = new Map<string, { qty: number; bonus: number }>();
  for (const l of args.lines) {
    if (!l.purchaseOrderLineId || !byId.has(l.purchaseOrderLineId)) throw notOnOrder('lines');
    const sum = sums.get(l.purchaseOrderLineId) ?? { qty: 0, bonus: 0 };
    sums.set(l.purchaseOrderLineId, { qty: sum.qty + l.qty, bonus: sum.bonus + l.bonusQty });
  }
  for (const [id, sum] of [...sums].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const line = byId.get(id)!;
    try {
      const next = checkReceipt(line, sum.qty, sum.bonus);
      await tx.phPurchaseOrderLine.update({ where: { id }, data: { receivedQty: next.receivedQty, receivedBonus: next.receivedBonus } });
      line.receivedQty = next.receivedQty;
      line.receivedBonus = next.receivedBonus;
    } catch (error) {
      if (error instanceof PurchasingError && error.code === 'OVER_RECEIPT') throw overReceipt();
      throw error;
    }
  }
  const after = poStatusAfterReceipt(orderLines);
  if (!canTransition(order.status, after, true)) throw badTransition();
  await updateWithVersion(tx.phPurchaseOrder, { id: order.id, version: order.version, data: { status: after }, entityType: 'PhPurchaseOrder' }, tx);
  return { before: order.status, after };
}

export interface OrderReceiptView {
  id: string;
  number: string | null;
  status: 'DRAFT' | 'CONFIRMED' | 'VOID';
  receivedOn: string;
  lines: { purchaseOrderLineId: string | null; productName: string; unitLabel: string; qty: number; bonusQty: number; lot: string; expiryDate: string }[];
}

/** The receipts (confirmed and draft, not void) answering one order, oldest first. No money. */
export async function listOrderReceipts(scoped: ScopedClient, purchaseOrderId: string): Promise<OrderReceiptView[]> {
  const order = await scoped.phPurchaseOrder.findFirst({ where: { id: purchaseOrderId }, select: { id: true } });
  if (!order) throw notFound();
  const rows = await scoped.phReceipt.findMany({
    where: { purchaseOrderId, status: { not: 'VOID' } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      number: true,
      status: true,
      receivedOn: true,
      lines: {
        orderBy: { lineNo: 'asc' },
        select: { purchaseOrderLineId: true, qty: true, bonusQty: true, lot: true, expiryDate: true, product: { select: { tradeName: true } }, unit: { select: { label: true } } },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    status: r.status,
    receivedOn: iso(r.receivedOn),
    lines: r.lines.map((l) => ({
      purchaseOrderLineId: l.purchaseOrderLineId,
      productName: l.product.tradeName,
      unitLabel: l.unit.label,
      qty: l.qty,
      bonusQty: l.bonusQty,
      lot: l.lot,
      expiryDate: iso(l.expiryDate),
    })),
  }));
}

// Reads ------------------------------------------------------------------------------------------------------------------

export interface PoSummary {
  id: string;
  number: string | null;
  status: PoStatus;
  branchId: string;
  supplierId: string;
  supplierName: string;
  currency: 'IQD' | 'USD';
  expectedOn: string | null;
  lineCount: number;
  version: number;
  createdAt: string;
  /** Present only for a role with `cost.view`: the sum of quantity times unit cost, in the order's currency. */
  totalMinor?: string;
}

/** Newest first, by cursor. The scoped client keeps a branch-limited actor to their branches. */
export async function listPurchaseOrders(
  scoped: ScopedClient,
  ph: PhActor,
  input: PoListInput & { branchId?: string },
): Promise<{ items: PoSummary[]; nextCursor: string | null }> {
  const search = input.search ? cleanText(input.search) : '';
  // Continue after the cursor order's (createdAt, id) read without the filters: an order that changed status since the last page may have left the status filter.
  let afterCursor: object[] = [];
  if (input.cursor) {
    const at = await scoped.phPurchaseOrder.findFirst({ where: { id: input.cursor }, select: { id: true, createdAt: true } });
    if (!at) throw new StudioError('INVALID', 'Check the highlighted fields', { cursor: 'This page of results is no longer available' });
    afterCursor = [{ OR: [{ createdAt: { lt: at.createdAt } }, { createdAt: at.createdAt, id: { lt: at.id } }] }];
  }
  const rows = await scoped.phPurchaseOrder.findMany({
    where: {
      AND: afterCursor,
      ...(input.branchId ? { branchId: input.branchId } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.supplierId ? { supplierId: input.supplierId } : {}),
      ...(search ? { number: { contains: search, mode: 'insensitive' as const } } : {}),
    },
    select: {
      id: true,
      number: true,
      status: true,
      branchId: true,
      supplierId: true,
      currency: true,
      expectedOn: true,
      version: true,
      createdAt: true,
      supplier: { select: { name: true } },
      _count: { select: { lines: true } },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: PAGE_SIZE + 1,
  });
  const more = rows.length > PAGE_SIZE;
  const page = more ? rows.slice(0, PAGE_SIZE) : rows;
  const withCost = mayViewCost(ph);
  const totals = new Map<string, bigint>();
  if (withCost && page.length > 0) {
    const lines = await scoped.phPurchaseOrderLine.findMany({
      where: { purchaseOrderId: { in: page.map((r) => r.id) } },
      select: { purchaseOrderId: true, qtyOrdered: true, unitCostMinor: true },
    });
    for (const l of lines) totals.set(l.purchaseOrderId, (totals.get(l.purchaseOrderId) ?? 0n) + BigInt(l.qtyOrdered) * l.unitCostMinor);
  }
  return {
    items: page.map((r) => ({
      id: r.id,
      number: r.number,
      status: r.status,
      branchId: r.branchId,
      supplierId: r.supplierId,
      supplierName: r.supplier.name,
      currency: r.currency,
      expectedOn: r.expectedOn ? iso(r.expectedOn) : null,
      lineCount: r._count.lines,
      version: r.version,
      createdAt: r.createdAt.toISOString(),
      ...(withCost ? { totalMinor: String(totals.get(r.id) ?? 0n) } : {}),
    })),
    nextCursor: more ? page[page.length - 1]!.id : null,
  };
}

export interface PoLineView {
  lineNo: number;
  lineId: string;
  productId: string;
  productName: string;
  unitId: string;
  unitLabel: string;
  qtyOrdered: number;
  bonusOrdered: number;
  receivedQty: number;
  receivedBonus: number;
  /** Quantity and bonus on confirmed receipt lines already covered by supplier invoices. */
  invoicedQty: number;
  /** Quantity and bonus still to arrive. */
  toReceive: number;
  /** Present only for a role with `cost.view`. */
  unitCostMinor?: string;
  lineTotalMinor?: string;
}

export interface PoDetail extends PoSummary {
  note: string;
  orderedAt: string | null;
  closedAt: string | null;
  closeReason: string;
  cancelledAt: string | null;
  lines: PoLineView[];
  /** Present only for a role with `cost.view`: one entry per currency (an order has one). */
  totals?: { currency: 'IQD' | 'USD'; totalMinor: string }[];
}

/** One order with its lines and the ordered / received / invoiced quantities of each. Cost keys only for `cost.view`. */
export async function getPurchaseOrder(scoped: ScopedClient, ph: PhActor, purchaseOrderId: string): Promise<PoDetail> {
  const o = await scoped.phPurchaseOrder.findFirst({
    where: { id: purchaseOrderId },
    include: {
      supplier: { select: { name: true } },
      lines: {
        orderBy: { lineNo: 'asc' },
        include: { product: { select: { tradeName: true } }, unit: { select: { label: true } }, receiptLines: { select: { invoicedQty: true } } },
      },
    },
  });
  if (!o) throw notFound();
  const withCost = mayViewCost(ph);
  let total = 0n;
  const lines: PoLineView[] = o.lines.map((l) => {
    const lineTotal = BigInt(l.qtyOrdered) * l.unitCostMinor;
    total += lineTotal;
    return {
      lineNo: l.lineNo,
      lineId: l.id,
      productId: l.productId,
      productName: l.product.tradeName,
      unitId: l.unitId,
      unitLabel: l.unit.label,
      qtyOrdered: l.qtyOrdered,
      bonusOrdered: l.bonusOrdered,
      receivedQty: l.receivedQty,
      receivedBonus: l.receivedBonus,
      invoicedQty: l.receiptLines.reduce((sum, r) => sum + r.invoicedQty, 0),
      toReceive: Math.max(0, l.qtyOrdered + l.bonusOrdered - l.receivedQty - l.receivedBonus),
      ...(withCost ? { unitCostMinor: String(l.unitCostMinor), lineTotalMinor: String(lineTotal) } : {}),
    };
  });
  return {
    id: o.id,
    number: o.number,
    status: o.status,
    branchId: o.branchId,
    supplierId: o.supplierId,
    supplierName: o.supplier.name,
    currency: o.currency,
    expectedOn: o.expectedOn ? iso(o.expectedOn) : null,
    lineCount: lines.length,
    version: o.version,
    createdAt: o.createdAt.toISOString(),
    note: o.note,
    orderedAt: o.orderedAt ? o.orderedAt.toISOString() : null,
    closedAt: o.closedAt ? o.closedAt.toISOString() : null,
    closeReason: o.closeReason,
    cancelledAt: o.cancelledAt ? o.cancelledAt.toISOString() : null,
    lines,
    ...(withCost ? { totalMinor: String(total), totals: [{ currency: o.currency, totalMinor: String(total) }] } : {}),
  };
}

export const poSuggestInput = z.object({
  /** Narrows the list to products this supplier has delivered before (confirmed receipts naming it). */
  supplierId: z.string().min(1).max(64).optional(),
});

export interface PoSuggestion {
  productId: string;
  productName: string;
  baseUnitId: string;
  baseUnitLabel: string;
  /** Sellable stock at the branch (available in ACTIVE, unexpired batches). */
  available: number;
  minQty: number;
  reorderQty: number;
  /** In base units: the product's reorder quantity, or what is missing from the minimum when it has none. */
  suggestedQty: number;
}

/**
 * Products of one branch whose sellable stock is below their minimum (R2-5: quarantine, reserved, damaged, expired and
 * blocked stock do not count). A product with no minimum (0) is never suggested. Read-only; the order is by name.
 */
export async function suggestOrders(scoped: ScopedClient, args: { branchId: string; supplierId?: string; now?: Date }): Promise<PoSuggestion[]> {
  const today = new Date(`${utcToday(args.now)}T00:00:00.000Z`);
  if (args.supplierId) {
    const supplier = await scoped.phSupplier.findFirst({ where: { id: args.supplierId }, select: { id: true } });
    if (!supplier) throw new StudioError('NOT_FOUND', 'Supplier not found');
  }
  const minimums = await scoped.phProductBranch.findMany({
    where: { branchId: args.branchId, minQty: { gt: 0 }, product: { active: true } },
    select: { productId: true, minQty: true, reorderQty: true },
  });
  if (minimums.length === 0) return [];
  const productIds = minimums.map((m) => m.productId);
  const [sums, products, delivered] = await Promise.all([
    scoped.phStockBalance.groupBy({
      by: ['productId'],
      where: { branchId: args.branchId, productId: { in: productIds }, batch: { status: 'ACTIVE', expiryDate: { gte: today } } },
      _sum: { available: true },
    }),
    scoped.phProduct.findMany({
      where: { id: { in: productIds } },
      select: { id: true, tradeName: true, units: { where: { level: 0 }, select: { id: true, label: true }, take: 1 } },
    }),
    args.supplierId
      ? scoped.phReceiptLine.findMany({
          where: { productId: { in: productIds }, receipt: { supplierId: args.supplierId, status: 'CONFIRMED' } },
          select: { productId: true },
          distinct: ['productId'],
        })
      : Promise.resolve(null),
  ]);
  const availableOf = new Map(sums.map((s) => [s.productId, s._sum.available ?? 0]));
  const productOf = new Map(products.map((p) => [p.id, p]));
  const allowed = delivered ? new Set(delivered.map((d) => d.productId)) : null;
  const out: PoSuggestion[] = [];
  for (const m of minimums) {
    const available = availableOf.get(m.productId) ?? 0;
    const product = productOf.get(m.productId);
    const base = product?.units[0];
    if (!product || !base || available >= m.minQty || (allowed && !allowed.has(m.productId))) continue;
    out.push({
      productId: m.productId,
      productName: product.tradeName,
      baseUnitId: base.id,
      baseUnitLabel: base.label,
      available,
      minQty: m.minQty,
      reorderQty: m.reorderQty,
      suggestedQty: m.reorderQty > 0 ? m.reorderQty : m.minQty - available,
    });
  }
  return out.sort((a, b) => a.productName.localeCompare(b.productName) || a.productId.localeCompare(b.productId));
}
