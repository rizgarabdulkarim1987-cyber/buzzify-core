/**
 * The rules of a stock transfer between two branches, as pure functions (no database, no clock: today comes in). Quantities
 * are whole numbers of the product's base unit. R6-1..R6-4 of the phase 6 plan.
 *
 * A transfer is REQUESTED -> SENT -> RECEIVED | PARTIAL, or REQUESTED -> CANCELLED. Stock leaves the sender when it is sent and
 * enters the destination when it is received; in between it exists only on the sent lines, as "in transit":
 * `sentQty - receivedQty - damagedQty - lostQty`, summed over the lines of SENT transfers.
 */
import { createHash } from 'node:crypto';
import { isExpired, type ExpiryPrecision } from './expiry';
import { allocateFefo, fefoOrder, type BatchStatus, type StockBuckets } from './stock';

export type TransferStatus = 'REQUESTED' | 'SENT' | 'RECEIVED' | 'PARTIAL' | 'CANCELLED';
export type LostReason = 'LOST' | 'OTHER';

/**
 * The most sent lines (one per batch) a transfer may have, for a send and for a receive alike: a receive must report every sent line
 * in one call, so a transfer that was sent must never have more lines than a receive accepts. A request has at most 100 lines; FEFO
 * may split each over many batches, which is what this caps.
 */
export const MAX_SENT_LINES = 500;

export type TransferCode =
  | 'INVALID_QUANTITY'
  | 'INSUFFICIENT_STOCK'
  | 'NOTHING_TO_SEND'
  | 'DUPLICATE_LINE'
  | 'PICK_LINE_UNKNOWN'
  | 'PICK_BATCH_INVALID'
  | 'DUPLICATE_PICK'
  | 'BATCH_NOT_SENDABLE'
  | 'OVER_REQUESTED'
  | 'OVER_SENT'
  | 'UNACCOUNTED'
  | 'REASON_REQUIRED'
  | 'TOO_MANY_LINES';

/** What a product was short by when a transfer could not be sent in full. */
export interface Shortfall {
  productId: string;
  requested: number;
  available: number;
}

/** An input the transfer rules refuse (a validation error, not a business outcome). */
export class TransferError extends Error {
  constructor(
    readonly code: TransferCode,
    message?: string,
    readonly detail: { shortfalls?: Shortfall[]; batchId?: string; lineId?: string } = {},
  ) {
    super(message ?? code);
    this.name = 'TransferError';
  }

  get shortfalls(): Shortfall[] | undefined {
    return this.detail.shortfalls;
  }
}

const EDGES: Record<TransferStatus, readonly TransferStatus[]> = {
  REQUESTED: ['SENT', 'CANCELLED'],
  SENT: ['RECEIVED', 'PARTIAL'],
  RECEIVED: [],
  PARTIAL: [],
  CANCELLED: [],
};

/** Whether a transfer may move from one status to another. A sent transfer is never cancelled: it is received, with the difference recorded. */
export function canTransition(from: TransferStatus, to: TransferStatus): boolean {
  return EDGES[from].includes(to);
}

/** A stable hash of a request, a send or a receive, so a repeated key can be compared with what it first did. */
export function transferPayloadHash(kind: 'request' | 'send' | 'receive', payload: unknown): string {
  return createHash('sha256').update(JSON.stringify([`transfer-${kind}`, payload])).digest('hex');
}

function whole(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TransferError('INVALID_QUANTITY', 'A quantity is a whole number, zero or more');
  return value;
}

// Sending -------------------------------------------------------------------------------------------------------------

/** A batch of a product at the sending branch: its `available` bucket and what decides whether it may leave. */
export interface SendBatch {
  id: string;
  productId: string;
  lot: string;
  expiryDate: string;
  expiryPrecision: ExpiryPrecision;
  status: BatchStatus;
  available: number;
}

/** A request line: what was asked of one product. One request line per product. */
export interface SendLine {
  lineId: string;
  productId: string;
  requestedQty: number;
}

/** The quantity a person chose to take from one batch for one request line. A line with picks sends exactly its picks. */
export interface SendPick {
  lineId: string;
  batchId: string;
  qty: number;
}

export interface SendAllocation {
  lineId: string;
  productId: string;
  batchId: string;
  qty: number;
  /** True when the line's picks are not what FEFO would have taken for the same total. */
  override: boolean;
}

export interface SendPlan {
  allocations: SendAllocation[];
  /** Whether any line was sent out of FEFO order. */
  override: boolean;
  totalQty: number;
}

/** Only an ACTIVE batch that is not expired (the expiry day itself still counts) may leave a branch: the rule of a sale. */
const sendable = (batch: SendBatch, today: string) => batch.status === 'ACTIVE' && !isExpired(batch, today);

/**
 * Plans which batches a send takes from. A line without picks takes its full request FEFO from the sendable batches (all or
 * nothing: a short product is named in the error, and nothing is planned). A line with picks sends exactly its picks, which
 * may add up to less than was requested (a partial send) and never more; picks that are not what FEFO would take for that
 * total are flagged `override`, for the caller to allow or refuse. Recalled, blocked, expired and empty batches are skipped by
 * FEFO and refused as picks. At least one unit must go. `lines` holds one line per product and `batches` all the sender's
 * batches of those products.
 */
export function planSend(args: { lines: readonly SendLine[]; batches: readonly SendBatch[]; picks?: readonly SendPick[]; today: string }): SendPlan {
  const { lines, batches, today } = args;
  const picks = args.picks ?? [];
  const lineById = new Map<string, SendLine>();
  const products = new Set<string>();
  for (const line of lines) {
    if (products.has(line.productId)) throw new TransferError('DUPLICATE_LINE', 'A product is on a transfer once', { lineId: line.lineId });
    products.add(line.productId);
    lineById.set(line.lineId, { ...line, requestedQty: whole(line.requestedQty) });
  }
  const batchById = new Map(batches.map((b) => [b.id, b]));

  const picksByLine = new Map<string, SendPick[]>();
  const seen = new Set<string>();
  for (const pick of picks) {
    const line = lineById.get(pick.lineId);
    if (!line) throw new TransferError('PICK_LINE_UNKNOWN', 'A pick names a line that is not on the transfer', { lineId: pick.lineId });
    const batch = batchById.get(pick.batchId);
    if (!batch || batch.productId !== line.productId) {
      throw new TransferError('PICK_BATCH_INVALID', 'A pick names a batch that is not of the line’s product', { lineId: pick.lineId, batchId: pick.batchId });
    }
    const key = `${pick.lineId}|${pick.batchId}`;
    if (seen.has(key)) throw new TransferError('DUPLICATE_PICK', 'A batch is picked once per line', { lineId: pick.lineId, batchId: pick.batchId });
    seen.add(key);
    whole(pick.qty);
    if (pick.qty > 0 && !sendable(batch, today)) {
      throw new TransferError('BATCH_NOT_SENDABLE', 'A batch that is expired, recalled or blocked cannot be sent', { lineId: pick.lineId, batchId: pick.batchId });
    }
    if (pick.qty > batch.available) {
      throw new TransferError('INSUFFICIENT_STOCK', 'Not enough stock in the picked batch', {
        batchId: pick.batchId,
        shortfalls: [{ productId: line.productId, requested: pick.qty, available: batch.available }],
      });
    }
    picksByLine.set(pick.lineId, [...(picksByLine.get(pick.lineId) ?? []), pick]);
  }

  const allocations: SendAllocation[] = [];
  const short: Shortfall[] = [];
  for (const line of lines) {
    const candidates = batches
      .filter((b) => b.productId === line.productId && sendable(b, today) && b.available > 0)
      .map((b) => ({ id: b.id, lot: b.lot, expiryDate: b.expiryDate, expiryPrecision: b.expiryPrecision, sellable: b.available }));
    const own = picksByLine.get(line.lineId);
    if (own === undefined) {
      const fefo = allocateFefo(candidates, line.requestedQty);
      if (!fefo.ok) {
        short.push({ productId: line.productId, requested: line.requestedQty, available: candidates.reduce((sum, b) => sum + b.sellable, 0) });
        continue;
      }
      for (const a of fefo.allocations) allocations.push({ lineId: line.lineId, productId: line.productId, batchId: a.batchId, qty: a.qty, override: false });
      continue;
    }
    const total = own.reduce((sum, p) => sum + p.qty, 0);
    if (total > line.requestedQty) throw new TransferError('OVER_REQUESTED', 'A line cannot send more than was requested', { lineId: line.lineId });
    if (total === 0) continue;
    // Out of FEFO order only when a sendable batch that expires EARLIER than a picked one still has stock left after the picks:
    // batches that expire the same day are equally first in line (their lot and id order only makes the default plan deterministic).
    const taken = new Map(own.map((p) => [p.batchId, p.qty]));
    const latest = own.filter((p) => p.qty > 0).reduce((max, p) => (batchById.get(p.batchId)!.expiryDate > max ? batchById.get(p.batchId)!.expiryDate : max), '');
    const same = !candidates.some((c) => c.expiryDate < latest && c.sellable - (taken.get(c.id) ?? 0) > 0);
    const ordered = own
      .filter((p) => p.qty > 0)
      .map((p) => ({ pick: p, batch: batchById.get(p.batchId)! }))
      .sort((x, y) => fefoOrder(x.batch, y.batch));
    for (const { pick } of ordered) allocations.push({ lineId: line.lineId, productId: line.productId, batchId: pick.batchId, qty: pick.qty, override: !same });
  }
  if (short.length > 0) throw new TransferError('INSUFFICIENT_STOCK', 'Not enough stock to send', { shortfalls: short });
  if (allocations.length > MAX_SENT_LINES) throw new TransferError('TOO_MANY_LINES', 'A transfer can be sent from at most 500 batches');
  const totalQty = allocations.reduce((sum, a) => sum + a.qty, 0);
  if (totalQty === 0) throw new TransferError('NOTHING_TO_SEND', 'Send at least one unit');
  return { allocations, override: allocations.some((a) => a.override), totalQty };
}

// Receiving -----------------------------------------------------------------------------------------------------------

/** What the receiving branch reports for one sent line. Every unit sent is accounted for: received, damaged or lost. */
export interface ReceiveInput {
  lineId: string;
  sentQty: number;
  receivedQty: number;
  damagedQty: number;
  lostQty: number;
  lostReason?: LostReason | null | undefined;
  /** The goods arrived warm or open: the received units go to quarantine, not to available. */
  quarantine: boolean;
}

export interface ReceivedLine {
  lineId: string;
  sentQty: number;
  receivedQty: number;
  damagedQty: number;
  lostQty: number;
  lostReason: LostReason | null;
  quarantine: boolean;
}

/**
 * Checks what was received. Quantities are whole and not negative; received, damaged and lost together equal what was sent
 * (more is refused, less leaves units that are nowhere); a lost quantity says LOST or OTHER, and a reason with nothing lost is
 * dropped. A damaged quantity needs no reason: it books into the damaged bucket and speaks for itself.
 */
export function checkReceive(lines: readonly ReceiveInput[]): ReceivedLine[] {
  return lines.map((line) => {
    const sentQty = whole(line.sentQty);
    const receivedQty = whole(line.receivedQty);
    const damagedQty = whole(line.damagedQty);
    const lostQty = whole(line.lostQty);
    const accounted = receivedQty + damagedQty + lostQty;
    if (accounted > sentQty) throw new TransferError('OVER_SENT', 'More was received than was sent', { lineId: line.lineId });
    if (accounted < sentQty) throw new TransferError('UNACCOUNTED', 'Every unit sent is received, damaged or lost', { lineId: line.lineId });
    if (lostQty > 0 && !line.lostReason) throw new TransferError('REASON_REQUIRED', 'Say why units were lost', { lineId: line.lineId });
    return { lineId: line.lineId, sentQty, receivedQty, damagedQty, lostQty, lostReason: lostQty > 0 ? (line.lostReason ?? null) : null, quarantine: line.quarantine };
  });
}

type Counted = { sentQty: number; receivedQty: number; damagedQty: number; lostQty: number };

/** RECEIVED when every line was received in full, else PARTIAL. */
export function closeStatus(lines: readonly Counted[]): 'RECEIVED' | 'PARTIAL' {
  return lines.every((l) => l.receivedQty === l.sentQty) ? 'RECEIVED' : 'PARTIAL';
}

/** Whether closing needs a person who sees losses: any LOST or OTHER quantity (damaged goods exist and are booked). */
export function needsLossApproval(lines: readonly Pick<Counted, 'lostQty'>[]): boolean {
  return lines.some((l) => l.lostQty > 0);
}

// In transit and conservation -----------------------------------------------------------------------------------------

/** Units still on the way: `sentQty - receivedQty - damagedQty - lostQty` over the sent lines of SENT transfers. */
export function inTransitQty(lines: readonly Counted[]): number {
  return lines.reduce((sum, l) => sum + Math.max(0, l.sentQty - l.receivedQty - l.damagedQty - l.lostQty), 0);
}

/** Every bucket of every branch, what is in transit and what was lost: constant for the stock of a batch that nobody sold or wrote off. */
export function conservation(args: { branchBuckets: readonly StockBuckets[]; inTransit: number; lost: number }): number {
  const held = args.branchBuckets.reduce((sum, b) => sum + b.available + b.reserved + b.quarantine + b.damaged, 0);
  return held + args.inTransit + args.lost;
}
