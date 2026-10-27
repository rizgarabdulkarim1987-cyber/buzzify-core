import { z } from 'zod';
import type { ScopedTx } from '@/server/data/tenant-db';
import { isExpired, utcToday } from '@/server/domain/pharmacy/expiry';
import { toBase } from '@/server/domain/pharmacy/stock';
import { StudioError } from '@/server/studio/framework/result';
import { applyMovement, BUCKETS, reverseMovement, type Bucket, type Deltas } from './stock';

/**
 * Manual stock changes (Phase 2, R2-3, R2-5): adjust, damage, quarantine release and reversal. Every change is ONE
 * movement through `applyMovement`; the services take the transaction of the action that calls them, and the action
 * audits. A change is idempotent by a client key kept on the movement itself (`refType` 'clientKey', `refId` the key;
 * the partial unique index "PhStockMovement_client_key" holds one per branch): a repeat returns that movement, the same
 * key with other contents is a CONFLICT.
 */

const MAX_INT = 2_147_483_647;
const WHOLE = 'Enter a whole number';
const CLIENT_KEY = 'clientKey';

const bucket = z.enum(BUCKETS, 'Choose a bucket');
export const reasonText = z.string().trim().min(3, 'Use at least 3 characters').max(300, 'Use at most 300 characters');
export const clientKeyText = z.string().trim().min(8, 'Use at least 8 characters').max(100, 'Use at most 100 characters');

/** The quantity: base units, or a count of one of the batch's product's units. Exactly one form (see `checkQuantity`). */
export const quantityShape = {
  baseQty: z.number(WHOLE).int(WHOLE).min(1, 'Use 1 or more').max(MAX_INT, 'Enter a smaller number').optional(),
  unitId: z.string().min(1).max(64).optional(),
  qty: z.number(WHOLE).int(WHOLE).min(1, 'Use 1 or more').max(1_000_000_000, 'Enter a smaller number').optional(),
};
type QuantityFields = { baseQty?: number; unitId?: string; qty?: number };

/** Refinement for an object with the quantity fields: `baseQty` alone, or `unitId` with `qty`. */
export function checkQuantity(value: QuantityFields, ctx: z.RefinementCtx): void {
  const unitForm = value.unitId !== undefined || value.qty !== undefined;
  if (value.baseQty !== undefined && unitForm) {
    ctx.addIssue({ code: 'custom', path: ['baseQty'], message: 'Give a quantity in base units or in a unit, not both' });
  } else if (value.baseQty === undefined && !unitForm) {
    ctx.addIssue({ code: 'custom', path: ['qty'], message: 'Enter the quantity' });
  } else if (unitForm && (value.unitId === undefined || value.qty === undefined)) {
    ctx.addIssue({ code: 'custom', path: [value.unitId === undefined ? 'unitId' : 'qty'], message: 'Choose the unit and enter the quantity' });
  }
}

export const adjustShape = {
  batchId: z.string().min(1).max(64),
  direction: z.enum(['in', 'out', 'move'], 'Choose in, out or move'),
  bucketFrom: bucket.optional(),
  bucketTo: bucket.optional(),
  ...quantityShape,
  reason: reasonText,
  clientKey: clientKeyText,
};
type AdjustFields = QuantityFields & { direction: 'in' | 'out' | 'move'; bucketFrom?: Bucket; bucketTo?: Bucket };

export function checkAdjust(value: AdjustFields, ctx: z.RefinementCtx): void {
  checkQuantity(value, ctx);
  const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
  if (value.direction === 'in') {
    if (value.bucketFrom !== undefined) issue('bucketFrom', 'Stock coming in has no source bucket');
  } else if (value.direction === 'out') {
    if (value.bucketFrom === undefined) issue('bucketFrom', 'Choose the bucket to take it from');
    if (value.bucketTo !== undefined) issue('bucketTo', 'Stock going out has no destination bucket');
  } else {
    if (value.bucketFrom === undefined) issue('bucketFrom', 'Choose the bucket to take it from');
    if (value.bucketTo === undefined) issue('bucketTo', 'Choose the bucket to move it to');
    if (value.bucketFrom !== undefined && value.bucketFrom === value.bucketTo) issue('bucketTo', 'Choose a different bucket');
  }
}

export const damageShape = {
  batchId: z.string().min(1).max(64),
  fromBucket: z.enum(['available', 'quarantine'], 'Choose available or quarantine'),
  ...quantityShape,
  reason: reasonText,
  clientKey: clientKeyText.optional(),
};

export const releaseShape = {
  batchId: z.string().min(1).max(64),
  decision: z.enum(['RESTOCK', 'DAMAGE'], 'Choose restock or damage'),
  ...quantityShape,
  reason: reasonText,
  clientKey: clientKeyText.optional(),
};

export const reverseShape = {
  movementId: z.string().min(1).max(64),
  reason: reasonText,
};

/** The types a person may correct here. A SALE or a COUNT is corrected by its own flow. */
const REVERSIBLE: ReadonlySet<string> = new Set(['ADJUST', 'DAMAGE', 'QUARANTINE_RELEASE', 'RECEIPT']);

export interface Who {
  restaurantId: string;
  branchId: string;
  userId: string;
}

/** What a change did, for the answer and the audit entry. */
export interface MovementDone {
  id: string;
  replayed: boolean;
  /** On a replay: whether the movement has been reversed since. */
  reversed: boolean;
  type: string;
  batchId: string;
  from: Bucket | null;
  to: Bucket | null;
  baseQty: number;
}

const refuse = (code: string, message: string) => new StudioError('CONFLICT', message, { phCode: code });
const invalid = (field: string, message: string) => new StudioError('INVALID', message, { [field]: message });

interface BatchRow {
  id: string;
  productId: string;
  status: string;
  expiryDate: string;
}

async function batchOf(tx: ScopedTx, restaurantId: string, batchId: string): Promise<BatchRow> {
  const batch = await tx.phBatch.findFirst({
    where: { id: batchId, restaurantId },
    select: { id: true, productId: true, status: true, expiryDate: true },
  });
  if (!batch) throw new StudioError('NOT_FOUND', 'Batch not found');
  return { id: batch.id, productId: batch.productId, status: batch.status, expiryDate: batch.expiryDate.toISOString().slice(0, 10) };
}

/** The quantity in base units: as given, or `qty` of a unit of the batch's own product. */
async function baseQtyOf(tx: ScopedTx, productId: string, q: QuantityFields): Promise<number> {
  if (q.baseQty !== undefined) return q.baseQty;
  const unit = await tx.phProductUnit.findFirst({ where: { id: q.unitId, productId }, select: { baseQty: true } });
  if (!unit) throw invalid('unitId', 'Choose one of this product’s units');
  let total: number;
  try {
    total = toBase(q.qty ?? 0, unit.baseQty);
  } catch {
    throw invalid('qty', 'Enter a smaller number');
  }
  if (total < 1 || total > MAX_INT) throw invalid('qty', 'Enter a smaller number');
  return total;
}

/** Stock may not be put into `available` of a batch that cannot be sold (R2-5): expired, recalled or blocked. */
function assertSellableHome(batch: { status: string; expiryDate: string }): void {
  if (isExpired(batch, utcToday())) throw refuse('EXPIRED', 'This batch is expired: it cannot go back on sale');
  if (batch.status !== 'ACTIVE') throw refuse('BATCH_NOT_ACTIVE', 'This batch is not active: it cannot go back on sale');
}

interface Spec {
  type: 'ADJUST' | 'DAMAGE' | 'QUARANTINE_RELEASE';
  batchId: string;
  deltas: Deltas;
  reason: string;
  clientKey?: string | undefined;
}

const fromOf = (deltas: Deltas): Bucket | null => BUCKETS.find((b) => (deltas[b] ?? 0) < 0) ?? null;
const toOf = (deltas: Deltas): Bucket | null => BUCKETS.find((b) => (deltas[b] ?? 0) > 0) ?? null;

const sameDeltas = (row: Record<`${Bucket}Delta`, number>, deltas: Deltas) => BUCKETS.every((b) => row[`${b}Delta`] === (deltas[b] ?? 0));

/** Writes the movement, or finds the one this key wrote before. The caller has checked the batch and the quantity. */
async function perform(tx: ScopedTx, who: Who, spec: Spec, batch: BatchRow, baseQty: number): Promise<MovementDone> {
  const done = (id: string, replayed: boolean, reversed = false): MovementDone => ({ id, replayed, reversed, type: spec.type, batchId: spec.batchId, from: fromOf(spec.deltas), to: toOf(spec.deltas), baseQty });
  if (spec.clientKey !== undefined) {
    const earlier = await tx.phStockMovement.findFirst({
      where: { branchId: who.branchId, refType: CLIENT_KEY, refId: spec.clientKey, reversesId: null },
    });
    if (earlier) {
      const same = earlier.type === spec.type && earlier.batchId === spec.batchId && earlier.reason === spec.reason.trim() && sameDeltas(earlier, spec.deltas);
      if (!same) throw refuse('CLIENT_KEY_MISMATCH', 'This key was already used for a different change');
      const reversal = await tx.phStockMovement.findFirst({ where: { reversesId: earlier.id }, select: { id: true } });
      return done(earlier.id, true, reversal !== null);
    }
  }
  // A repeat is answered above, before the batch is judged again: it was fine when it was written.
  if ((spec.deltas.available ?? 0) > 0) assertSellableHome(batch);
  const moved = await applyMovement(tx, {
    restaurantId: who.restaurantId,
    branchId: who.branchId,
    batchId: spec.batchId,
    type: spec.type,
    deltas: spec.deltas,
    reason: spec.reason,
    userId: who.userId,
    ...(spec.clientKey !== undefined ? { refType: CLIENT_KEY, refId: spec.clientKey } : {}),
  });
  return done(moved.id, false);
}

export async function adjustStock(tx: ScopedTx, who: Who, input: AdjustFields & { batchId: string; reason: string; clientKey: string }): Promise<MovementDone> {
  const batch = await batchOf(tx, who.restaurantId, input.batchId);
  const n = await baseQtyOf(tx, batch.productId, input);
  const deltas: Deltas = {};
  if (input.direction === 'in') deltas[input.bucketTo ?? 'available'] = n;
  else if (input.direction === 'out') deltas[input.bucketFrom!] = -n;
  else {
    deltas[input.bucketFrom!] = -n;
    deltas[input.bucketTo!] = n;
  }
  return perform(tx, who, { type: 'ADJUST', batchId: batch.id, deltas, reason: input.reason, clientKey: input.clientKey }, batch, n);
}

export async function damageStock(tx: ScopedTx, who: Who, input: QuantityFields & { batchId: string; fromBucket: 'available' | 'quarantine'; reason: string; clientKey?: string | undefined }): Promise<MovementDone> {
  const batch = await batchOf(tx, who.restaurantId, input.batchId);
  const n = await baseQtyOf(tx, batch.productId, input);
  return perform(tx, who, { type: 'DAMAGE', batchId: batch.id, deltas: { [input.fromBucket]: -n, damaged: n }, reason: input.reason, clientKey: input.clientKey }, batch, n);
}

export async function releaseQuarantine(
  tx: ScopedTx,
  who: Who,
  input: QuantityFields & { batchId: string; decision: 'RESTOCK' | 'DAMAGE'; reason: string; clientKey?: string | undefined },
): Promise<MovementDone> {
  const batch = await batchOf(tx, who.restaurantId, input.batchId);
  const n = await baseQtyOf(tx, batch.productId, input);
  const restock = input.decision === 'RESTOCK';
  return perform(
    tx,
    who,
    { type: restock ? 'QUARANTINE_RELEASE' : 'DAMAGE', batchId: batch.id, deltas: { quarantine: -n, [restock ? 'available' : 'damaged']: n }, reason: input.reason, clientKey: input.clientKey },
    batch,
    n,
  );
}

export async function reverseStock(tx: ScopedTx, who: Who, input: { movementId: string; reason: string }): Promise<{ id: string; reversesId: string; type: string; batchId: string }> {
  const original = await tx.phStockMovement.findFirst({
    where: { id: input.movementId, branchId: who.branchId },
    select: { id: true, type: true, batchId: true, availableDelta: true },
  });
  if (!original) throw new StudioError('NOT_FOUND', 'Movement not found');
  if (!REVERSIBLE.has(original.type)) throw refuse('REVERSE_NOT_ALLOWED', 'This kind of movement cannot be reversed here');
  // A reversal that gives stock back to `available` is held to the same rule as any other way in (R2-5).
  if (original.availableDelta < 0) assertSellableHome(await batchOf(tx, who.restaurantId, original.batchId));
  const reversal = await reverseMovement(tx, original.id, { userId: who.userId, reason: input.reason });
  return { id: reversal.id, reversesId: original.id, type: original.type, batchId: original.batchId };
}
