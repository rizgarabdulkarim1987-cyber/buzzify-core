/** Stock maths as pure functions (no database). Quantities are whole numbers in the product's base unit. */
import { isExpired, type ExpiryBatch } from './expiry';

export type BatchStatus = 'ACTIVE' | 'RECALLED' | 'BLOCKED';
export type StockBuckets = { available: number; reserved: number; quarantine: number; damaged: number };

/** `qty` of a unit worth `baseQty` base units, in base units. Throws unless both are whole, qty >= 0, baseQty >= 1 and the result is a safe integer. */
export function toBase(qty: number, baseQty: number): number {
  if (!Number.isSafeInteger(qty) || qty < 0) throw new RangeError(`Quantity must be a safe whole number: ${qty}`);
  if (!Number.isSafeInteger(baseQty) || baseQty < 1) throw new RangeError(`baseQty must be a positive whole number: ${baseQty}`);
  const total = qty * baseQty;
  if (!Number.isSafeInteger(total)) throw new RangeError('Quantity is too large');
  return total;
}

/**
 * The cost of `baseQty` base units of a batch whose cost is `unitCostMinor` per cost unit of `per` base units: `unitCostMinor x
 * baseQty / per`, the division FLOORED, in integers. The one line-cost rule: the sale snapshot (sales.ts, "Cost snapshot") and the
 * value of a supplier return both use it, so a unit sold and a unit sent back are valued alike. Throws unless `baseQty` is a
 * whole number >= 0 and `per` a whole number >= 1.
 */
export function costOfBaseQty(unitCostMinor: bigint, baseQty: number, per: number): bigint {
  if (!Number.isSafeInteger(baseQty) || baseQty < 0) throw new RangeError(`Quantity must be a safe whole number: ${baseQty}`);
  if (!Number.isSafeInteger(per) || per < 1) throw new RangeError(`The cost unit must be a positive whole number: ${per}`);
  return (unitCostMinor * BigInt(baseQty)) / BigInt(per);
}

/**
 * The single definition of what can be sold from one batch balance (R2-5): `available` only, and only when the batch is
 * ACTIVE and not expired. Reserved, quarantine and damaged are never sellable.
 */
export function sellableStock(
  buckets: StockBuckets,
  batch: { status: BatchStatus; expiryDate: string },
  today: string,
): number {
  if (batch.status !== 'ACTIVE' || isExpired(batch, today)) return 0;
  return buckets.available;
}

export type FefoBatch = ExpiryBatch & { id: string; lot: string };

/** Comparator: earliest expiry first, then lot, then id. Dates are 'YYYY-MM-DD' and a MONTH expiry is already its month end. */
export function fefoOrder(a: FefoBatch, b: FefoBatch): number {
  if (a.expiryDate !== b.expiryDate) return a.expiryDate < b.expiryDate ? -1 : 1;
  if (a.lot !== b.lot) return a.lot < b.lot ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export type FefoAllocation = { batchId: string; qty: number };
export type FefoResult =
  | { ok: true; allocations: FefoAllocation[] }
  | { ok: false; shortfall: number; allocations: FefoAllocation[] };

/**
 * Takes `needed` base units from batches in FEFO order. `sellable` is each batch's `sellableStock`. When the batches
 * cannot cover it, nothing is promised: `ok: false` with the missing quantity and what could be taken.
 */
export function allocateFefo(batches: (FefoBatch & { sellable: number })[], needed: number): FefoResult {
  if (!Number.isSafeInteger(needed) || needed < 0) throw new RangeError(`Quantity must be a safe whole number: ${needed}`);
  const allocations: FefoAllocation[] = [];
  let rest = needed;
  for (const b of [...batches].sort(fefoOrder)) {
    if (rest === 0) break;
    if (!Number.isSafeInteger(b.sellable) || b.sellable < 0) throw new RangeError(`Invalid sellable quantity for ${b.id}`);
    const take = Math.min(rest, b.sellable);
    if (take > 0) {
      allocations.push({ batchId: b.id, qty: take });
      rest -= take;
    }
  }
  return rest === 0 ? { ok: true, allocations } : { ok: false, shortfall: rest, allocations };
}
