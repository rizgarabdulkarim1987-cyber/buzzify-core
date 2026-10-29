import { z } from 'zod';
import type { ScopedClient, ScopedTx } from '@/server/data/tenant-db';
import { canPh } from '@/server/domain/pharmacy/permissions';
import { saleNumber } from '@/server/domain/pharmacy/sale';
import { utcToday } from '@/server/domain/pharmacy/expiry';
import {
  checkReceive,
  closeStatus,
  inTransitQty,
  needsLossApproval,
  planSend,
  TransferError,
  transferPayloadHash,
  type SendBatch,
  type TransferCode,
} from '@/server/domain/pharmacy/transfers';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from './actor';
import { applyMovement } from './stock';
import { cleanMultiline, PAGE_SIZE } from './suppliers';

/**
 * Transfers (R6-1..R6-6): stock moved from one branch of a business to another. This file is the only writer of `PhTransfer` and
 * `PhTransferLine`; stock moves only through `applyMovement` (TRANSFER_OUT at the sender when sent, TRANSFER_IN at the
 * destination when received, the transfer as the reference). Every function takes the transaction of the action that calls it;
 * the action audits.
 *
 * WHO ACTS. The scoped client only confines what an actor can SEE (a transfer touching one of their branches). Who may ACT at
 * each end is decided here: a request and its changes by either end, a send by the sender's branch alone, a receipt by the
 * destination's alone (`allBranches` or the branch in `ph.branchIds`).
 *
 * LOCK ORDER (R6-6): client key (advisory, namespace 7401, `<restaurant>:<send|receive|request>:<key>`) -> the transfer row
 * `FOR UPDATE` -> its lines -> stock balances (`ORDER BY "batchId" COLLATE "C"` `FOR UPDATE`, then the batch rows `FOR SHARE`,
 * the order of a sale) -> the number lock (7402, key `tr:<fromBranchId>`, only a request takes it, before it inserts anything).
 *
 * IN TRANSIT. Between a send and a receive the units sit on the sent lines and in no branch's balance, so no sale, FEFO or
 * count can see them. Receiving books `receivedQty` into the destination's available stock (or quarantine, when the person
 * says the goods arrived warm or open, or when the batch is no longer sellable), `damagedQty` into its damaged bucket (both as
 * TRANSFER_IN), and only records `lostQty`.
 */

/** Advisory-lock namespaces of transfers: client keys (7401) and the sending branch's numbering (7402). */
const NS_KEY = 7401;
const NS_NUMBER = 7402;
const MAX_QTY = 2_147_483_647;
const WHOLE = 'Enter a whole number';
const idText = z.string().min(1).max(64);
const keyText = z.string().trim().min(8, 'Use at least 8 characters').max(100, 'Use at most 100 characters');
const noteText = z.string().transform(cleanMultiline).pipe(z.string().max(500, 'Use at most 500 characters')).default('');
const qty = z.number(WHOLE).int(WHOLE).min(1, 'Use 1 or more').max(MAX_QTY, 'Enter a smaller number');
const qtyOrZero = z.number(WHOLE).int(WHOLE).min(0, 'Use 0 or more').max(MAX_QTY, 'Enter a smaller number');

const requestLine = z.object({ productId: idText, qty });
export const requestFields = z.object({
  clientKey: keyText,
  fromBranchId: idText,
  toBranchId: idText,
  note: noteText,
  lines: z.array(requestLine).min(1, 'Add at least one line').max(100, 'Use at most 100 lines'),
});
export type RequestFields = z.infer<typeof requestFields>;

export const updateFields = z.object({
  transferId: idText,
  version: z.number().int().min(1),
  note: noteText,
  lines: z.array(requestLine).min(1, 'Add at least one line').max(100, 'Use at most 100 lines'),
});
export type UpdateFields = z.infer<typeof updateFields>;

export const cancelFields = z.object({ transferId: idText, version: z.number().int().min(1) });
export type CancelFields = z.infer<typeof cancelFields>;

export const sendFields = z.object({
  transferId: idText,
  version: z.number().int().min(1),
  clientKey: keyText,
  picks: z.array(z.object({ lineId: idText, batchId: idText, qty: qtyOrZero })).max(500, 'Use at most 100 lines').optional(),
});
export type SendFields = z.infer<typeof sendFields>;

export const receiveFields = z.object({
  transferId: idText,
  version: z.number().int().min(1),
  clientKey: keyText,
  lines: z
    .array(
      z.object({
        lineId: idText,
        receivedQty: qtyOrZero,
        damagedQty: qtyOrZero.default(0),
        lostQty: qtyOrZero.default(0),
        lostReason: z.enum(['LOST', 'OTHER'], 'Say why units were lost').optional(),
        quarantine: z.boolean().default(false),
      }),
    )
    .min(1, 'Add at least one line')
    .max(500, 'Use at most 100 lines'),
});
export type ReceiveFields = z.infer<typeof receiveFields>;

export const transferListInput = z.object({
  status: z.enum(['REQUESTED', 'SENT', 'RECEIVED', 'PARTIAL', 'CANCELLED']).optional(),
  direction: z.enum(['in', 'out', 'all']).default('all'),
  branchId: idText.optional(),
  cursor: z.string().min(1).max(100).nullish(),
});
export type TransferListInput = z.infer<typeof transferListInput>;

export const inTransitInput = z.object({ branchId: idText.optional(), productId: idText.optional() });
export type InTransitInput = z.infer<typeof inTransitInput>;

// Refusals -------------------------------------------------------------------------------------------------------------

const notFound = () => new StudioError('NOT_FOUND', 'Transfer not found');
const keyMismatch = () => new StudioError('CONFLICT', 'This key was already used for a different transfer', { phCode: 'CLIENT_KEY_MISMATCH' });
const stale = () => new StudioError('CONFLICT', 'Someone else changed this transfer: reload it', { phCode: 'VERSION_CONFLICT' });
const notRequested = () => new StudioError('CONFLICT', 'Only a requested transfer can be changed or sent', { phCode: 'NOT_REQUESTED' });
const notSent = () => new StudioError('CONFLICT', 'Only a sent transfer can be received', { phCode: 'NOT_SENT' });
const forbidden = (phCode: string) => new StudioError('FORBIDDEN', undefined, { phCode });

const SENTENCE: Record<TransferCode, string> = {
  INVALID_QUANTITY: 'Enter a whole number',
  INSUFFICIENT_STOCK: 'Not enough stock to send',
  NOTHING_TO_SEND: 'Send at least one unit',
  DUPLICATE_LINE: 'Each product can be on a transfer once',
  PICK_LINE_UNKNOWN: 'A pick names a line that is not on this transfer',
  PICK_BATCH_INVALID: 'Choose a batch of this product',
  DUPLICATE_PICK: 'A batch can be picked once for a line',
  BATCH_NOT_SENDABLE: 'A batch that is expired, recalled or blocked cannot be sent',
  OVER_REQUESTED: 'A line cannot send more than was requested',
  OVER_SENT: 'More was received than was sent',
  UNACCOUNTED: 'Every unit sent is received, damaged or lost',
  REASON_REQUIRED: 'Say why units were lost',
};

/** A refusal of the pure rules, as the error a person is shown. */
function refused(error: TransferError): StudioError {
  const fields: Record<string, string> = { phCode: error.code };
  const first = error.shortfalls?.[0];
  if (first) {
    fields.productId = first.productId;
    fields.requested = String(first.requested);
    fields.available = String(first.available);
    fields.rows = String(error.shortfalls!.length);
  }
  if (error.detail.batchId) fields.batchId = error.detail.batchId;
  return new StudioError(error.code === 'INSUFFICIENT_STOCK' || error.code === 'NOTHING_TO_SEND' ? 'CONFLICT' : 'INVALID', SENTENCE[error.code], fields);
}

/** Runs pure rules and turns their refusal into a `StudioError`. */
function rule<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof TransferError) throw refused(error);
    throw error;
  }
}

/** A deadlock or serialisation failure is a conflict the person can retry, not a crash. */
export function asRetryableTransfer(error: unknown): unknown {
  const e = error as { code?: unknown; message?: unknown; meta?: unknown } | null;
  const text = `${String(e?.code ?? '')} ${String(e?.message ?? '')} ${JSON.stringify(e?.meta ?? '')}`;
  if (e?.code === 'P2034' || /40P01|40001|deadlock detected/i.test(text)) return stale();
  return error;
}

/** Whether the actor works at this branch. */
export const mayUseBranch = (ph: PhActor, branchId: string): boolean => ph.allBranches || ph.branchIds.includes(branchId);

const iso = (d: Date) => d.toISOString().slice(0, 10);
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

async function advisory(tx: ScopedTx, restaurantId: string, kind: string, key: string): Promise<void> {
  // eslint-disable-next-line no-restricted-properties -- an advisory lock touches no tenant rows: it only serialises one client key
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NS_KEY}::int, hashtext(${`${restaurantId}:${kind}:${key}`}))`;
}

interface Header {
  id: string;
  number: string | null;
  status: 'REQUESTED' | 'SENT' | 'RECEIVED' | 'PARTIAL' | 'CANCELLED';
  version: number;
  fromBranchId: string;
  toBranchId: string;
}

/** The transfer the actor can see, locked `FOR UPDATE` and read fresh. NOT_FOUND when it is not theirs. */
async function lockTransfer(tx: ScopedTx, restaurantId: string, transferId: string): Promise<Header> {
  const visible = await tx.phTransfer.findFirst({ where: { id: transferId }, select: { id: true } });
  if (!visible) throw notFound();
  // eslint-disable-next-line no-restricted-properties -- a row lock on one transfer the scoped client just showed this actor; it names the actor's business
  await tx.$queryRaw`SELECT "id" FROM "PhTransfer" WHERE "restaurantId" = ${restaurantId} AND "id" = ${transferId} FOR UPDATE`;
  const row = await tx.phTransfer.findFirst({ where: { id: transferId }, select: { id: true, number: true, status: true, version: true, fromBranchId: true, toBranchId: true } });
  if (!row) throw notFound();
  return row;
}

function assertVersion(header: Header, version: number): void {
  if (header.version !== version) throw stale();
}

// Request, update, cancel ------------------------------------------------------------------------------------------------

export interface TransferCreated {
  id: string;
  number: string;
  status: 'REQUESTED';
  fromBranchId: string;
  toBranchId: string;
  version: number;
  lines: { lineNo: number; productId: string; requestedQty: number }[];
  replayed: boolean;
}

async function checkRequest(tx: ScopedTx, ph: PhActor, input: { fromBranchId?: string; toBranchId?: string; lines: readonly { productId: string }[] }) {
  const products = new Set<string>();
  for (const l of input.lines) {
    if (products.has(l.productId)) throw refused(new TransferError('DUPLICATE_LINE'));
    products.add(l.productId);
  }
  const found = await tx.phProduct.findMany({ where: { id: { in: [...products] } }, select: { id: true } });
  if (found.length !== products.size) throw new StudioError('NOT_FOUND', 'Product not found');
  void ph;
}

/** A new REQUESTED transfer, or the one this key made before (same person, same payload). Either end's actor may ask. */
export async function requestTransfer(
  tx: ScopedTx,
  args: { restaurantId: string; ph: PhActor; clientKey: string; input: RequestFields; now?: Date },
): Promise<TransferCreated> {
  const { ph, input } = args;
  const now = args.now ?? new Date();
  const hash = transferPayloadHash('request', { from: input.fromBranchId, to: input.toBranchId, note: input.note, lines: input.lines.map((l) => [l.productId, l.qty]) });
  await advisory(tx, args.restaurantId, 'request', args.clientKey);
  const earlier = await tx.phTransfer.findFirst({
    where: { clientKey: args.clientKey },
    include: { lines: { where: { requestLineId: null }, orderBy: { lineNo: 'asc' }, select: { lineNo: true, productId: true, requestedQty: true } } },
  });
  if (earlier) {
    if (earlier.requestedById !== ph.userId || earlier.payloadHash !== hash) throw keyMismatch();
    return { id: earlier.id, number: earlier.number ?? '', status: 'REQUESTED', fromBranchId: earlier.fromBranchId, toBranchId: earlier.toBranchId, version: earlier.version, lines: earlier.lines, replayed: true };
  }

  if (input.fromBranchId === input.toBranchId) throw new StudioError('INVALID', 'Choose two different branches', { toBranchId: 'Choose two different branches' });
  if (!mayUseBranch(ph, input.fromBranchId) && !mayUseBranch(ph, input.toBranchId)) throw forbidden('NOT_YOUR_BRANCH');
  const branches = await tx.branch.findMany({ where: { id: { in: [input.fromBranchId, input.toBranchId] } }, select: { id: true } });
  if (branches.length !== 2) throw new StudioError('NOT_FOUND', 'Branch not found');
  await checkRequest(tx, ph, input);

  // The number first (the only lock this request takes after its key), counted raw: the count is of the sender's whole day.
  // eslint-disable-next-line no-restricted-properties -- an advisory lock touches no tenant rows: it only serialises one branch's transfer numbers
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NS_NUMBER}::int, hashtext(${`tr:${input.fromBranchId}`}))`;
  const prefix = `T-${iso(now).replaceAll('-', '')}-`;
  // eslint-disable-next-line no-restricted-properties -- counts the sending branch's numbers of the day under the number lock; the filter names the business and the branch
  const counted = await tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "PhTransfer" WHERE "restaurantId" = ${args.restaurantId} AND "fromBranchId" = ${input.fromBranchId} AND "number" LIKE ${`${prefix}%`}`;
  const number = `T-${saleNumber(now.toISOString(), Number(counted[0]?.n ?? 0n) + 1)}`;

  const made = await tx.phTransfer.create({
    data: {
      restaurantId: args.restaurantId,
      fromBranchId: input.fromBranchId,
      toBranchId: input.toBranchId,
      number,
      clientKey: args.clientKey,
      payloadHash: hash,
      note: input.note,
      requestedById: ph.userId,
      requestedAt: now,
    },
    select: { id: true, version: true },
  });
  const lines = input.lines.map((l, index) => ({ lineNo: index + 1, productId: l.productId, requestedQty: l.qty }));
  await tx.phTransferLine.createMany({
    data: lines.map((l) => ({ restaurantId: args.restaurantId, transferId: made.id, fromBranchId: input.fromBranchId, toBranchId: input.toBranchId, ...l })),
  });
  return { id: made.id, number, status: 'REQUESTED', fromBranchId: input.fromBranchId, toBranchId: input.toBranchId, version: made.version, lines, replayed: false };
}

export interface TransferChanged {
  id: string;
  number: string;
  status: 'REQUESTED' | 'CANCELLED';
  version: number;
  lineCount: number;
}

/** Replaces the lines and note of a transfer that is still REQUESTED. Either end's actor may. */
export async function updateTransfer(tx: ScopedTx, args: { restaurantId: string; ph: PhActor; input: UpdateFields }): Promise<TransferChanged> {
  const { ph, input } = args;
  const header = await lockTransfer(tx, args.restaurantId, input.transferId);
  if (!mayUseBranch(ph, header.fromBranchId) && !mayUseBranch(ph, header.toBranchId)) throw forbidden('NOT_YOUR_BRANCH');
  assertVersion(header, input.version);
  if (header.status !== 'REQUESTED') throw notRequested();
  await checkRequest(tx, ph, input);
  await tx.phTransferLine.deleteMany({ where: { transferId: header.id } });
  await tx.phTransferLine.createMany({
    data: input.lines.map((l, index) => ({
      restaurantId: args.restaurantId,
      transferId: header.id,
      fromBranchId: header.fromBranchId,
      toBranchId: header.toBranchId,
      lineNo: index + 1,
      productId: l.productId,
      requestedQty: l.qty,
    })),
  });
  const next = await tx.phTransfer.update({ where: { id: header.id }, data: { note: input.note, version: { increment: 1 } }, select: { version: true } });
  return { id: header.id, number: header.number ?? '', status: 'REQUESTED', version: next.version, lineCount: input.lines.length };
}

/** Cancels a transfer that is still REQUESTED. A sent transfer is never cancelled: it is received. */
export async function cancelTransfer(tx: ScopedTx, args: { restaurantId: string; ph: PhActor; input: CancelFields; now?: Date }): Promise<TransferChanged> {
  const { ph, input } = args;
  const header = await lockTransfer(tx, args.restaurantId, input.transferId);
  if (!mayUseBranch(ph, header.fromBranchId) && !mayUseBranch(ph, header.toBranchId)) throw forbidden('NOT_YOUR_BRANCH');
  assertVersion(header, input.version);
  if (header.status !== 'REQUESTED') throw notRequested();
  const count = await tx.phTransferLine.count({ where: { transferId: header.id } });
  const next = await tx.phTransfer.update({
    where: { id: header.id },
    data: { status: 'CANCELLED', cancelledById: ph.userId, cancelledAt: args.now ?? new Date(), version: { increment: 1 } },
    select: { version: true },
  });
  return { id: header.id, number: header.number ?? '', status: 'CANCELLED', version: next.version, lineCount: count };
}

// Send -----------------------------------------------------------------------------------------------------------------

export interface TransferSent {
  id: string;
  number: string;
  status: 'SENT';
  version: number;
  fromBranchId: string;
  toBranchId: string;
  override: boolean;
  totalQty: number;
  lines: { lineId: string; requestLineId: string; productId: string; batchId: string; sentQty: number }[];
  movementIds: string[];
  replayed: boolean;
}

/**
 * Sends a REQUESTED transfer from the sender's branch: FEFO from the sender's available stock for each request line (or the
 * picks given), one sent line and one TRANSFER_OUT per batch. All or nothing: a short product fails the whole send. Picks that
 * are not FEFO's need `batch.override`. Replaying the same key by the same person with the same picks returns the first result.
 */
export async function sendTransfer(
  tx: ScopedTx,
  args: { restaurantId: string; ph: PhActor; input: SendFields; now?: Date },
): Promise<TransferSent> {
  const { ph, input, restaurantId } = args;
  const now = args.now ?? new Date();
  const picks = (input.picks ?? []).map((p) => ({ lineId: p.lineId, batchId: p.batchId, qty: p.qty }));
  const hash = transferPayloadHash('send', { id: input.transferId, picks: [...picks].sort((a, b) => compare(a.lineId, b.lineId) || compare(a.batchId, b.batchId)) });
  await advisory(tx, restaurantId, 'send', input.clientKey);
  const earlier = await tx.phTransfer.findFirst({ where: { sendKey: input.clientKey }, select: { id: true } });
  if (earlier) {
    const same = await tx.phTransfer.findFirst({ where: { id: earlier.id, sendHash: hash, sentById: ph.userId } });
    if (!same || same.id !== input.transferId) throw keyMismatch();
    return sentResult(tx, same.id, true);
  }

  const header = await lockTransfer(tx, restaurantId, input.transferId);
  if (!mayUseBranch(ph, header.fromBranchId)) throw forbidden('NOT_SENDER');
  assertVersion(header, input.version);
  if (header.status !== 'REQUESTED') throw notRequested();

  const requestLines = await tx.phTransferLine.findMany({
    where: { transferId: header.id, requestLineId: null },
    orderBy: { lineNo: 'asc' },
    select: { id: true, lineNo: true, productId: true, requestedQty: true },
  });
  const products = requestLines.map((l) => l.productId);
  const pickBatches = picks.map((p) => p.batchId);

  // Stock rows of the sender, in batch order, then the batch rows (a recall or block racing this send waits or is seen).
  // eslint-disable-next-line no-restricted-properties -- row locks on the sender's balances; every filter names the business and the branch
  const locked = await tx.$queryRaw<{ batchId: string; productId: string; available: number }[]>`
    SELECT "batchId", "productId", "available" FROM "PhStockBalance"
    WHERE "restaurantId" = ${restaurantId} AND "branchId" = ${header.fromBranchId}
      AND "productId" = ANY(${products}) AND ("available" > 0 OR "batchId" = ANY(${pickBatches}))
    ORDER BY "batchId" COLLATE "C" FOR UPDATE`;
  const batchIds = [...new Set([...locked.map((r) => r.batchId), ...pickBatches])];
  if (batchIds.length > 0) {
    // eslint-disable-next-line no-restricted-properties -- row locks on this business's batches, listed by id; the rows are read below through the scoped client
    await tx.$queryRaw`SELECT "id" FROM "PhBatch" WHERE "restaurantId" = ${restaurantId} AND "id" = ANY(${batchIds}) ORDER BY "id" COLLATE "C" FOR SHARE`;
  }
  const rows = await tx.phBatch.findMany({
    where: { id: { in: batchIds } },
    select: { id: true, productId: true, lot: true, status: true, expiryDate: true, expiryPrecision: true },
  });
  const availableOf = new Map(locked.map((r) => [r.batchId, r.available]));
  const batches: SendBatch[] = rows.map((b) => ({
    id: b.id,
    productId: b.productId,
    lot: b.lot,
    expiryDate: iso(b.expiryDate),
    expiryPrecision: b.expiryPrecision,
    status: b.status,
    available: availableOf.get(b.id) ?? 0,
  }));

  const plan = rule(() => planSend({ lines: requestLines.map((l) => ({ lineId: l.id, productId: l.productId, requestedQty: l.requestedQty })), batches, picks, today: utcToday(now) }));
  if (plan.override && (ph.role === null || !canPh(ph.role, 'batch.override'))) throw forbidden('OVERRIDE_NEEDED');

  const movementIds: string[] = [];
  const ordered = [...plan.allocations].sort((a, b) => compare(a.batchId, b.batchId));
  for (const a of ordered) {
    const moved = await applyMovement(tx, {
      restaurantId,
      branchId: header.fromBranchId,
      batchId: a.batchId,
      type: 'TRANSFER_OUT',
      deltas: { available: -a.qty },
      reason: '',
      userId: ph.userId,
      refType: 'PhTransfer',
      refId: header.id,
    });
    movementIds.push(moved.id);
  }
  const lastNo = requestLines.reduce((max, l) => Math.max(max, l.lineNo), 0);
  await tx.phTransferLine.createMany({
    data: plan.allocations.map((a, index) => ({
      restaurantId,
      transferId: header.id,
      fromBranchId: header.fromBranchId,
      toBranchId: header.toBranchId,
      lineNo: lastNo + index + 1,
      productId: a.productId,
      batchId: a.batchId,
      requestLineId: a.lineId,
      requestedQty: 0,
      sentQty: a.qty,
    })),
  });
  await tx.phTransfer.update({
    where: { id: header.id },
    data: { status: 'SENT', sentById: ph.userId, sentAt: now, sendKey: input.clientKey, sendHash: hash, version: { increment: 1 } },
  });
  const result = await sentResult(tx, header.id, false);
  return { ...result, override: plan.override, movementIds };
}

async function sentResult(tx: ScopedTx, transferId: string, replayed: boolean): Promise<TransferSent> {
  const t = await tx.phTransfer.findFirst({
    where: { id: transferId },
    include: { lines: { where: { requestLineId: { not: null } }, orderBy: { lineNo: 'asc' } } },
  });
  if (!t) throw notFound();
  return {
    id: t.id,
    number: t.number ?? '',
    status: 'SENT',
    version: t.version,
    fromBranchId: t.fromBranchId,
    toBranchId: t.toBranchId,
    override: false,
    totalQty: t.lines.reduce((sum, l) => sum + l.sentQty, 0),
    lines: t.lines.map((l) => ({ lineId: l.id, requestLineId: l.requestLineId!, productId: l.productId, batchId: l.batchId!, sentQty: l.sentQty })),
    movementIds: [],
    replayed,
  };
}

// Receive --------------------------------------------------------------------------------------------------------------

export interface TransferReceived {
  id: string;
  number: string;
  status: 'RECEIVED' | 'PARTIAL';
  version: number;
  receivedQty: number;
  damagedQty: number;
  lostQty: number;
  movementIds: string[];
  replayed: boolean;
}

/**
 * Receives a SENT transfer at the destination's branch. Every sent line is reported once, and received + damaged + lost equals
 * what was sent. Received units go to available (or quarantine when flagged, or when the batch can no longer be sold), damaged
 * units to the damaged bucket; lost units are only recorded, and need `report.view` (and a reason). A transfer is received
 * once: the status is RECEIVED when every line came in full, else PARTIAL.
 */
export async function receiveTransfer(
  tx: ScopedTx,
  args: { restaurantId: string; ph: PhActor; input: ReceiveFields; now?: Date },
): Promise<TransferReceived> {
  const { ph, input, restaurantId } = args;
  const now = args.now ?? new Date();
  const normal = [...input.lines]
    .map((l) => [l.lineId, l.receivedQty, l.damagedQty, l.lostQty, l.lostQty > 0 ? (l.lostReason ?? null) : null, l.quarantine] as const)
    .sort((a, b) => compare(a[0], b[0]));
  const hash = transferPayloadHash('receive', { id: input.transferId, lines: normal });
  await advisory(tx, restaurantId, 'receive', input.clientKey);
  const earlier = await tx.phTransfer.findFirst({ where: { receiveKey: input.clientKey }, select: { id: true } });
  if (earlier) {
    const same = await tx.phTransfer.findFirst({ where: { id: earlier.id, receiveHash: hash, receivedById: ph.userId } });
    if (!same || same.id !== input.transferId) throw keyMismatch();
    return receivedResult(tx, same.id, true);
  }

  const header = await lockTransfer(tx, restaurantId, input.transferId);
  if (!mayUseBranch(ph, header.toBranchId)) throw forbidden('NOT_RECEIVER');
  assertVersion(header, input.version);
  if (header.status !== 'SENT') throw notSent();

  const sentLines = await tx.phTransferLine.findMany({
    where: { transferId: header.id, requestLineId: { not: null } },
    orderBy: { lineNo: 'asc' },
    select: { id: true, productId: true, batchId: true, sentQty: true },
  });
  const wanted = new Set(sentLines.map((l) => l.id));
  const given = new Set(input.lines.map((l) => l.lineId));
  if (given.size !== input.lines.length || given.size !== wanted.size || [...given].some((id) => !wanted.has(id))) {
    throw new StudioError('INVALID', 'Report every line of the transfer once', { lines: 'Report every line of the transfer once', phCode: 'LINES_MISMATCH' });
  }
  const byId = new Map(input.lines.map((l) => [l.lineId, l]));
  const checked = rule(() =>
    checkReceive(
      sentLines.map((s) => {
        const l = byId.get(s.id)!;
        return { lineId: s.id, sentQty: s.sentQty, receivedQty: l.receivedQty, damagedQty: l.damagedQty, lostQty: l.lostQty, lostReason: l.lostReason ?? null, quarantine: l.quarantine };
      }),
    ),
  );
  if (needsLossApproval(checked) && (ph.role === null || !canPh(ph.role, 'report.view'))) throw forbidden('LOSS_NEEDS_REPORT_VIEW');

  // Destination balances that exist, in batch order, then the batch rows: the order of a sale.
  const batchIds = [...new Set(sentLines.map((l) => l.batchId!))].sort(compare);
  // eslint-disable-next-line no-restricted-properties -- row locks on the destination's balances; every filter names the business and the branch
  await tx.$queryRaw`SELECT "batchId" FROM "PhStockBalance" WHERE "restaurantId" = ${restaurantId} AND "branchId" = ${header.toBranchId} AND "batchId" = ANY(${batchIds}) ORDER BY "batchId" COLLATE "C" FOR UPDATE`;
  // eslint-disable-next-line no-restricted-properties -- row locks on this business's batches, listed by id; the rows are read below through the scoped client
  await tx.$queryRaw`SELECT "id" FROM "PhBatch" WHERE "restaurantId" = ${restaurantId} AND "id" = ANY(${batchIds}) ORDER BY "id" COLLATE "C" FOR SHARE`;
  const batches = await tx.phBatch.findMany({ where: { id: { in: batchIds } }, select: { id: true, status: true, expiryDate: true } });
  const batchById = new Map(batches.map((b) => [b.id, b]));
  const today = utcToday(now);

  const movementIds: string[] = [];
  const ordered = [...checked].sort((a, b) => compare(sentLines.find((s) => s.id === a.lineId)!.batchId!, sentLines.find((s) => s.id === b.lineId)!.batchId!));
  for (const line of ordered) {
    const sent = sentLines.find((s) => s.id === line.lineId)!;
    const batch = batchById.get(sent.batchId!);
    if (!batch) throw new StudioError('NOT_FOUND', 'Batch not found');
    const sellable = batch.status === 'ACTIVE' && iso(batch.expiryDate) >= today;
    const base = { restaurantId, branchId: header.toBranchId, batchId: sent.batchId!, type: 'TRANSFER_IN' as const, reason: '', userId: ph.userId, refType: 'PhTransfer', refId: header.id };
    if (line.receivedQty > 0) {
      const moved = await applyMovement(tx, { ...base, deltas: line.quarantine || !sellable ? { quarantine: line.receivedQty } : { available: line.receivedQty } });
      movementIds.push(moved.id);
    }
    if (line.damagedQty > 0) {
      const moved = await applyMovement(tx, { ...base, deltas: { damaged: line.damagedQty } });
      movementIds.push(moved.id);
    }
    await tx.phTransferLine.update({
      where: { id: line.lineId },
      data: { receivedQty: line.receivedQty, damagedQty: line.damagedQty, lostQty: line.lostQty, lostReason: line.lostReason, quarantine: line.quarantine },
    });
  }
  await tx.phTransfer.update({
    where: { id: header.id },
    data: { status: closeStatus(checked), receivedById: ph.userId, receivedAt: now, receiveKey: input.clientKey, receiveHash: hash, version: { increment: 1 } },
  });
  const result = await receivedResult(tx, header.id, false);
  return { ...result, movementIds };
}

async function receivedResult(tx: ScopedTx, transferId: string, replayed: boolean): Promise<TransferReceived> {
  const t = await tx.phTransfer.findFirst({ where: { id: transferId }, include: { lines: { where: { requestLineId: { not: null } } } } });
  if (!t) throw notFound();
  return {
    id: t.id,
    number: t.number ?? '',
    status: t.status as 'RECEIVED' | 'PARTIAL',
    version: t.version,
    receivedQty: t.lines.reduce((sum, l) => sum + l.receivedQty, 0),
    damagedQty: t.lines.reduce((sum, l) => sum + l.damagedQty, 0),
    lostQty: t.lines.reduce((sum, l) => sum + l.lostQty, 0),
    movementIds: [],
    replayed,
  };
}

// Reads ----------------------------------------------------------------------------------------------------------------

export interface TransferSummary {
  id: string;
  number: string | null;
  status: Header['status'];
  fromBranchId: string;
  toBranchId: string;
  fromBranchName: string;
  toBranchName: string;
  requestedAt: string;
  lineCount: number;
  requestedQty: number;
  sentQty: number;
  inTransitQty: number;
  version: number;
}

type ListRow = {
  id: string;
  number: string | null;
  status: Header['status'];
  fromBranchId: string;
  toBranchId: string;
  requestedAt: Date;
  version: number;
  fromBranch: { name: string };
  toBranch: { name: string };
  lines: { requestLineId: string | null; requestedQty: number; sentQty: number; receivedQty: number; damagedQty: number; lostQty: number }[];
};

function summaryOf(r: ListRow): TransferSummary {
  const request = r.lines.filter((l) => l.requestLineId === null);
  const sent = r.lines.filter((l) => l.requestLineId !== null);
  return {
    id: r.id,
    number: r.number,
    status: r.status,
    fromBranchId: r.fromBranchId,
    toBranchId: r.toBranchId,
    fromBranchName: r.fromBranch.name,
    toBranchName: r.toBranch.name,
    requestedAt: r.requestedAt.toISOString(),
    lineCount: request.length,
    requestedQty: request.reduce((sum, l) => sum + l.requestedQty, 0),
    sentQty: sent.reduce((sum, l) => sum + l.sentQty, 0),
    inTransitQty: r.status === 'SENT' ? inTransitQty(sent) : 0,
    version: r.version,
  };
}

const encode = (r: { requestedAt: Date; id: string }) => `${r.requestedAt.getTime()}.${r.id}`;
function decode(cursor: string): { at: Date; id: string } | null {
  const dot = cursor.indexOf('.');
  const ms = Number(cursor.slice(0, dot));
  const id = cursor.slice(dot + 1);
  return dot > 0 && Number.isFinite(ms) && id ? { at: new Date(ms), id } : null;
}

/** Newest first by a keyset cursor (requested time, id). A branch-limited actor sees only transfers touching their branches. */
export async function listTransfers(scoped: ScopedClient, ph: PhActor, input: TransferListInput): Promise<{ items: TransferSummary[]; nextCursor: string | null }> {
  const mine = ph.allBranches ? null : ph.branchIds;
  const at = input.branchId ? [input.branchId] : mine;
  const where: Record<string, unknown>[] = [];
  if (input.status) where.push({ status: input.status });
  if (input.direction === 'out' && at) where.push({ fromBranchId: { in: at } });
  else if (input.direction === 'in' && at) where.push({ toBranchId: { in: at } });
  else if (input.branchId) where.push({ OR: [{ fromBranchId: input.branchId }, { toBranchId: input.branchId }] });
  const cursor = input.cursor ? decode(input.cursor) : null;
  if (cursor) where.push({ OR: [{ requestedAt: { lt: cursor.at } }, { requestedAt: cursor.at, id: { lt: cursor.id } }] });
  const rows = await scoped.phTransfer.findMany({
    where: { AND: where },
    include: {
      fromBranch: { select: { name: true } },
      toBranch: { select: { name: true } },
      lines: { select: { requestLineId: true, requestedQty: true, sentQty: true, receivedQty: true, damagedQty: true, lostQty: true } },
    },
    orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
    take: PAGE_SIZE + 1,
  });
  const more = rows.length > PAGE_SIZE;
  const page = more ? rows.slice(0, PAGE_SIZE) : rows;
  return { items: page.map(summaryOf), nextCursor: more ? encode(page[page.length - 1]!) : null };
}

export interface TransferDetail extends TransferSummary {
  note: string;
  requestedById: string;
  sentAt: string | null;
  receivedAt: string | null;
  cancelledAt: string | null;
  requestLines: { lineId: string; lineNo: number; productId: string; productName: string; requestedQty: number; sentQty: number }[];
  sentLines: {
    lineId: string;
    requestLineId: string;
    productId: string;
    productName: string;
    batchId: string;
    lot: string;
    expiryDate: string;
    sentQty: number;
    receivedQty: number;
    damagedQty: number;
    lostQty: number;
    lostReason: 'LOST' | 'OTHER' | null;
    quarantine: boolean;
    inTransitQty: number;
  }[];
}

/** One transfer with its request lines, its sent lines (batch, lot, expiry) and what is still in transit. No cost. */
export async function getTransfer(scoped: ScopedClient, transferId: string): Promise<TransferDetail> {
  const t = await scoped.phTransfer.findFirst({
    where: { id: transferId },
    include: {
      fromBranch: { select: { name: true } },
      toBranch: { select: { name: true } },
      lines: { orderBy: { lineNo: 'asc' } },
    },
  });
  if (!t) throw notFound();
  const productIds = [...new Set(t.lines.map((l) => l.productId))];
  const batchIds = [...new Set(t.lines.flatMap((l) => (l.batchId ? [l.batchId] : [])))];
  const products = await scoped.phProduct.findMany({ where: { id: { in: productIds } }, select: { id: true, tradeName: true } });
  const batches = batchIds.length === 0 ? [] : await scoped.phBatch.findMany({ where: { id: { in: batchIds } }, select: { id: true, lot: true, expiryDate: true } });
  const name = new Map(products.map((p) => [p.id, p.tradeName]));
  const batch = new Map(batches.map((b) => [b.id, b]));
  const requestLines = t.lines.filter((l) => l.requestLineId === null);
  const sentLines = t.lines.filter((l) => l.requestLineId !== null);
  return {
    ...summaryOf(t),
    note: t.note,
    requestedById: t.requestedById,
    sentAt: t.sentAt?.toISOString() ?? null,
    receivedAt: t.receivedAt?.toISOString() ?? null,
    cancelledAt: t.cancelledAt?.toISOString() ?? null,
    requestLines: requestLines.map((l) => ({
      lineId: l.id,
      lineNo: l.lineNo,
      productId: l.productId,
      productName: name.get(l.productId) ?? '',
      requestedQty: l.requestedQty,
      sentQty: sentLines.filter((s) => s.requestLineId === l.id).reduce((sum, s) => sum + s.sentQty, 0),
    })),
    sentLines: sentLines.map((l) => ({
      lineId: l.id,
      requestLineId: l.requestLineId!,
      productId: l.productId,
      productName: name.get(l.productId) ?? '',
      batchId: l.batchId!,
      lot: batch.get(l.batchId!)?.lot ?? '',
      expiryDate: batch.get(l.batchId!) ? iso(batch.get(l.batchId!)!.expiryDate) : '',
      sentQty: l.sentQty,
      receivedQty: l.receivedQty,
      damagedQty: l.damagedQty,
      lostQty: l.lostQty,
      lostReason: l.lostReason,
      quarantine: l.quarantine,
      inTransitQty: t.status === 'SENT' ? inTransitQty([l]) : 0,
    })),
  };
}

export interface InTransitItem {
  productId: string;
  productName: string;
  batchId: string;
  lot: string;
  expiryDate: string;
  fromBranchId: string;
  toBranchId: string;
  qty: number;
}

/** What is on the road: per product, batch and destination, the units sent and not yet received, damaged or lost. */
export async function inTransit(scoped: ScopedClient, input: InTransitInput): Promise<InTransitItem[]> {
  const open = await scoped.phTransfer.findMany({ where: { status: 'SENT' }, select: { id: true } });
  if (open.length === 0) return [];
  const lines = await scoped.phTransferLine.findMany({
    where: {
      transferId: { in: open.map((t) => t.id) },
      requestLineId: { not: null },
      ...(input.productId ? { productId: input.productId } : {}),
      ...(input.branchId ? { OR: [{ fromBranchId: input.branchId }, { toBranchId: input.branchId }] } : {}),
    },
    select: { productId: true, batchId: true, fromBranchId: true, toBranchId: true, sentQty: true, receivedQty: true, damagedQty: true, lostQty: true },
  });
  const sums = new Map<string, InTransitItem>();
  const productIds = [...new Set(lines.map((l) => l.productId))];
  const batchIds = [...new Set(lines.map((l) => l.batchId!))];
  const products = productIds.length === 0 ? [] : await scoped.phProduct.findMany({ where: { id: { in: productIds } }, select: { id: true, tradeName: true } });
  const batches = batchIds.length === 0 ? [] : await scoped.phBatch.findMany({ where: { id: { in: batchIds } }, select: { id: true, lot: true, expiryDate: true } });
  const name = new Map(products.map((p) => [p.id, p.tradeName]));
  const batch = new Map(batches.map((b) => [b.id, b]));
  for (const l of lines) {
    const key = `${l.productId}|${l.batchId}|${l.fromBranchId}|${l.toBranchId}`;
    const left = inTransitQty([l]);
    if (left === 0) continue;
    const b = batch.get(l.batchId!);
    const item = sums.get(key) ?? {
      productId: l.productId,
      productName: name.get(l.productId) ?? '',
      batchId: l.batchId!,
      lot: b?.lot ?? '',
      expiryDate: b ? iso(b.expiryDate) : '',
      fromBranchId: l.fromBranchId,
      toBranchId: l.toBranchId,
      qty: 0,
    };
    item.qty += left;
    sums.set(key, item);
  }
  return [...sums.values()].sort((a, b) => compare(a.productName, b.productName) || compare(a.batchId, b.batchId) || compare(a.toBranchId, b.toBranchId));
}
