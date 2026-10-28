import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ScopedClient, ScopedTx } from '@/server/data/tenant-db';
import { saleNumber } from '@/server/domain/pharmacy/sale';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from './actor';
import { mayViewCost } from './products';
import { applyMovement } from './stock';
import { cleanMultiline, cleanText, NS_CLIENT_KEY, PAGE_SIZE } from './suppliers';

/**
 * Supplier returns (R4-7, R4-7a, R4-10, R4-11): stock sent back to a supplier from one branch. This file is the only writer
 * of `PhSupplierReturn` and `PhSupplierReturnLine`; the stock itself moves only through `applyMovement` (type
 * SUPPLIER_RETURN, one movement per line, the return as its reference). The service takes the transaction of the action
 * that calls it; the action audits. A return is created confirmed, in one transaction: if any line is short the whole
 * return rolls back with its movements.
 *
 * Lock order of this phase (header comment of every service that locks): client key (advisory, namespace 7201) -> PO row ->
 * receipt line counters -> credit note row -> invoice rows -> stock rows (balances in batch id order, the phase 2/3 order) ->
 * number lock (7202, key `sr:<branchId>`, distinct from the order numbering). A return takes its client key, inserts its
 * own new rows (nothing to lock), then the balances, and the number last, so two returns of one branch queue on the number
 * only after their stock is taken.
 *
 * The supplier is not checked against the batch (phase 2 ruling: the supplier is not part of a batch's identity). Recalled,
 * blocked and expired batches can go back: that is the main use. Quantities are whole base units.
 */

/** The advisory-lock namespace shared with purchase order numbering (7202); the second int is `hashtext(sr:branchId)`. */
const NS_NUMBER = 7202;
const MAX_QTY = 2_147_483_647;
const WHOLE = 'Enter a whole number';

const idText = z.string().min(1).max(64);
const dateText = z
  .string()
  .trim()
  .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00.000Z`).toISOString().slice(0, 10) === v, 'Enter a date as YYYY-MM-DD');

export const returnLine = z.object({
  batchId: idText,
  bucket: z.enum(['AVAILABLE', 'QUARANTINE'], 'Choose available or quarantine'),
  qty: z.number(WHOLE).int(WHOLE).min(1, 'Use 1 or more').max(MAX_QTY, 'Enter a smaller number'),
});

/** What a person enters for a return; the branch comes from the place. */
export const returnFields = z.object({
  clientKey: z.string().trim().min(8, 'Use at least 8 characters').max(100, 'Use at most 100 characters'),
  supplierId: idText,
  reason: z.string().transform(cleanText).pipe(z.string().min(3, 'Use at least 3 characters').max(300, 'Use at most 300 characters')),
  note: z.string().transform(cleanMultiline).pipe(z.string().max(500, 'Use at most 500 characters')).default(''),
  lines: z.array(returnLine).min(1, 'Add at least one line').max(100, 'Use at most 100 lines'),
});
export type ReturnFields = z.infer<typeof returnFields>;

export const returnListInput = z.object({
  supplierId: idText.optional(),
  /** Days (UTC), both ends included. */
  from: dateText.optional(),
  to: dateText.optional(),
  cursor: z.string().min(1).max(64).nullish(),
});
export type ReturnListInput = z.infer<typeof returnListInput>;

const supplierNotFound = () => new StudioError('NOT_FOUND', 'Supplier not found');
const batchNotFound = () => new StudioError('NOT_FOUND', 'Batch not found');
const returnNotFound = () => new StudioError('NOT_FOUND', 'Supplier return not found');
const archived = () => new StudioError('CONFLICT', 'This supplier is archived', { phCode: 'SUPPLIER_ARCHIVED' });
const keyMismatch = () => new StudioError('CONFLICT', 'This key was already used for a different return', { phCode: 'CLIENT_KEY_MISMATCH' });
const duplicateLine = () => new StudioError('INVALID', 'Each batch and bucket can be on a return once', { lines: 'Each batch and bucket can be on a return once', phCode: 'DUPLICATE_LINE' });

const iso = (d: Date) => d.toISOString().slice(0, 10);
const midnight = (date: string) => new Date(`${date}T00:00:00.000Z`);
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The hash a replayed key is compared by: the supplier, the reason, the note and every line, in order. */
export function returnPayloadHash(branchId: string, input: ReturnFields): string {
  return createHash('sha256')
    .update(JSON.stringify(['sret', branchId, input.supplierId, input.reason, input.note, input.lines.map((l) => [l.batchId, l.bucket, l.qty])]))
    .digest('hex');
}

/**
 * The cost of `qty` base units of a batch whose cost is `unitCostMinor` per cost unit of `per` base units: the sales
 * snapshot rule (sales.ts, "Cost snapshot"): `unitCostMinor x qty / per`, the division floored. Integer maths only.
 */
export function costOfQty(unitCostMinor: bigint, qty: number, per: number): bigint {
  return (unitCostMinor * BigInt(qty)) / BigInt(per);
}

/** For each batch: the base size of its cost unit, when it has a cost. */
async function costUnitsOf(scoped: ScopedTx | ScopedClient, batchIds: readonly string[]): Promise<Map<string, number>> {
  if (batchIds.length === 0) return new Map();
  const batches = await scoped.phBatch.findMany({ where: { id: { in: [...batchIds] } }, select: { id: true, costUnitId: true } });
  const unitIds = [...new Set(batches.flatMap((b) => (b.costUnitId ? [b.costUnitId] : [])))];
  const units = unitIds.length === 0 ? [] : await scoped.phProductUnit.findMany({ where: { id: { in: unitIds } }, select: { id: true, baseQty: true } });
  const base = new Map(units.map((u) => [u.id, u.baseQty]));
  return new Map(batches.flatMap((b) => (b.costUnitId && base.has(b.costUnitId) ? [[b.id, base.get(b.costUnitId)!] as const] : [])));
}

// Create ---------------------------------------------------------------------------------------------------------------

/** The database enum of buckets; the CHECK on a line allows only AVAILABLE and QUARANTINE. */
type StoredBucket = 'AVAILABLE' | 'RESERVED' | 'QUARANTINE' | 'DAMAGED';

export interface ReturnCreated {
  id: string;
  number: string;
  supplierId: string;
  branchId: string;
  lines: { lineNo: number; batchId: string; bucket: StoredBucket; qty: number }[];
  replayed: boolean;
}

/**
 * A new confirmed return from `branchId`, or the one the same `clientKey` already made. A repeat must come from the same
 * person, for the same branch, with the same payload: anything else is `CLIENT_KEY_MISMATCH`. The supplier must exist
 * and be live; every batch must be the business's own; a bucket never goes below zero, and a short line fails the whole
 * return with `INSUFFICIENT_STOCK`, leaving no movement behind.
 */
export async function createSupplierReturn(
  tx: ScopedTx,
  args: { restaurantId: string; branchId: string; userId: string; clientKey: string; input: ReturnFields; now?: Date },
): Promise<ReturnCreated> {
  const { input } = args;
  const hash = returnPayloadHash(args.branchId, input);
  // eslint-disable-next-line no-restricted-properties -- an advisory lock touches no tenant rows: it only serialises one client key
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NS_CLIENT_KEY}::int, hashtext(${`${args.restaurantId}:${args.clientKey}`}))`;
  const earlier = await tx.phSupplierReturn.findFirst({
    where: { clientKey: args.clientKey },
    include: { lines: { orderBy: { lineNo: 'asc' }, select: { lineNo: true, batchId: true, bucket: true, qty: true } } },
  });
  if (earlier) {
    if (earlier.branchId !== args.branchId || earlier.createdById !== args.userId || earlier.payloadHash !== hash) throw keyMismatch();
    return { id: earlier.id, number: earlier.number ?? '', supplierId: earlier.supplierId, branchId: earlier.branchId, lines: earlier.lines, replayed: true };
  }

  const seen = new Set<string>();
  for (const l of input.lines) {
    const key = `${l.batchId}|${l.bucket}`;
    if (seen.has(key)) throw duplicateLine();
    seen.add(key);
  }
  const supplier = await tx.phSupplier.findFirst({ where: { id: input.supplierId }, select: { id: true, active: true } });
  if (!supplier) throw supplierNotFound();
  if (!supplier.active) throw archived();

  const batchIds = [...new Set(input.lines.map((l) => l.batchId))];
  const batches = await tx.phBatch.findMany({ where: { id: { in: batchIds } }, select: { id: true, unitCostMinor: true, costCurrency: true } });
  if (batches.length !== batchIds.length) throw batchNotFound();
  const by = new Map(batches.map((b) => [b.id, b]));
  const per = await costUnitsOf(tx, batchIds);

  const made = await tx.phSupplierReturn.create({
    data: {
      restaurantId: args.restaurantId,
      branchId: args.branchId,
      supplierId: input.supplierId,
      reason: input.reason,
      note: input.note,
      clientKey: args.clientKey,
      payloadHash: hash,
      createdById: args.userId,
    },
    select: { id: true },
  });
  const lines = input.lines.map((l, index) => {
    const batch = by.get(l.batchId)!;
    // The batch's cost is copied only whole: the cost, its currency and the unit it is per, or none of them.
    const costed = batch.unitCostMinor !== null && batch.costCurrency !== null && per.has(l.batchId);
    return {
      lineNo: index + 1,
      batchId: l.batchId,
      bucket: l.bucket,
      qty: l.qty,
      unitCostMinor: costed ? batch.unitCostMinor : null,
      costCurrency: costed ? batch.costCurrency : null,
    };
  });
  await tx.phSupplierReturnLine.createMany({ data: lines.map((l) => ({ restaurantId: args.restaurantId, returnId: made.id, ...l })) });

  // Stock rows in batch id order (the lock order of the stock layer), then the number.
  const ordered = [...lines].sort((a, b) => compare(a.batchId, b.batchId) || compare(a.bucket, b.bucket));
  for (const l of ordered) {
    await applyMovement(tx, {
      restaurantId: args.restaurantId,
      branchId: args.branchId,
      batchId: l.batchId,
      type: 'SUPPLIER_RETURN',
      deltas: l.bucket === 'AVAILABLE' ? { available: -l.qty } : { quarantine: -l.qty },
      reason: input.reason,
      userId: args.userId,
      refType: 'PhSupplierReturn',
      refId: made.id,
    });
  }

  const now = args.now ?? new Date();
  const day = iso(now).replaceAll('-', '');
  // eslint-disable-next-line no-restricted-properties -- an advisory lock touches no tenant rows: it only serialises one branch's return numbers
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NS_NUMBER}::int, hashtext(${`sr:${args.branchId}`}))`;
  const issued = await tx.phSupplierReturn.count({ where: { branchId: args.branchId, number: { startsWith: `SR-${day}-` } } });
  const number = `SR-${saleNumber(now.toISOString(), issued + 1)}`;
  await tx.phSupplierReturn.update({ where: { id: made.id }, data: { number } });

  return {
    id: made.id,
    number,
    supplierId: input.supplierId,
    branchId: args.branchId,
    lines: lines.map((l) => ({ lineNo: l.lineNo, batchId: l.batchId, bucket: l.bucket, qty: l.qty })),
    replayed: false,
  };
}

// Read -----------------------------------------------------------------------------------------------------------------

export type ReturnValue = Partial<Record<'IQD' | 'USD', string>>;

interface CostedLine {
  batchId: string;
  qty: number;
  unitCostMinor: bigint | null;
  costCurrency: 'IQD' | 'USD' | null;
}

/** The cost of a return's lines per currency; lines with no cost add nothing. Integer maths, floored per line. */
function valueOf(lines: readonly CostedLine[], per: ReadonlyMap<string, number>): ReturnValue {
  const sums = new Map<'IQD' | 'USD', bigint>();
  for (const l of lines) {
    const size = per.get(l.batchId);
    if (l.unitCostMinor === null || l.costCurrency === null || size === undefined) continue;
    sums.set(l.costCurrency, (sums.get(l.costCurrency) ?? 0n) + costOfQty(l.unitCostMinor, l.qty, size));
  }
  return Object.fromEntries([...sums].map(([currency, total]) => [currency, total.toString()]));
}

export interface ReturnSummary {
  id: string;
  number: string | null;
  branchId: string;
  supplierId: string;
  supplierName: string;
  createdAt: string;
  lineCount: number;
  totalQty: number;
  returnValue?: ReturnValue;
}

/** Newest first, by cursor. The scoped client keeps a branch-limited actor to their branches. */
export async function listSupplierReturns(
  scoped: ScopedClient,
  ph: PhActor,
  input: ReturnListInput & { branchId?: string | undefined },
): Promise<{ items: ReturnSummary[]; nextCursor: string | null }> {
  const rows = await scoped.phSupplierReturn.findMany({
    where: {
      AND: [
        input.supplierId ? { supplierId: input.supplierId } : {},
        input.branchId ? { branchId: input.branchId } : {},
        input.from || input.to
          ? { createdAt: { ...(input.from ? { gte: midnight(input.from) } : {}), ...(input.to ? { lt: new Date(midnight(input.to).getTime() + 86_400_000) } : {}) } }
          : {},
      ],
    },
    include: { supplier: { select: { name: true } }, lines: { select: { batchId: true, qty: true, unitCostMinor: true, costCurrency: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: PAGE_SIZE + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });
  const more = rows.length > PAGE_SIZE;
  const page = more ? rows.slice(0, PAGE_SIZE) : rows;
  const withCost = mayViewCost(ph);
  const per = withCost ? await costUnitsOf(scoped, [...new Set(page.flatMap((r) => r.lines.map((l) => l.batchId)))]) : new Map<string, number>();
  return {
    items: page.map((r) => ({
      id: r.id,
      number: r.number,
      branchId: r.branchId,
      supplierId: r.supplierId,
      supplierName: r.supplier.name,
      createdAt: r.createdAt.toISOString(),
      lineCount: r.lines.length,
      totalQty: r.lines.reduce((sum, l) => sum + l.qty, 0),
      ...(withCost ? { returnValue: valueOf(r.lines, per) } : {}),
    })),
    nextCursor: more ? page[page.length - 1]!.id : null,
  };
}

export interface ReturnDetail extends ReturnSummary {
  reason: string;
  note: string;
  lines: {
    lineNo: number;
    batchId: string;
    productId: string;
    productName: string;
    baseUnit: string;
    lot: string;
    expiryDate: string;
    bucket: StoredBucket;
    qty: number;
    unitCostMinor?: string | null;
    costCurrency?: 'IQD' | 'USD' | null;
  }[];
  creditNotes: { id: string; number: string; currency: 'IQD' | 'USD'; noteDate: string; amountMinor?: string }[];
}

/** One return with its lines (product, lot, expiry, bucket, quantity, cost with `cost.view`) and the credit notes linked to it. */
export async function getSupplierReturn(scoped: ScopedClient, ph: PhActor, returnId: string): Promise<ReturnDetail> {
  const r = await scoped.phSupplierReturn.findFirst({
    where: { id: returnId },
    include: {
      supplier: { select: { name: true } },
      lines: {
        orderBy: { lineNo: 'asc' },
        include: { batch: { select: { lot: true, expiryDate: true, productId: true, product: { select: { tradeName: true } } } } },
      },
      creditNotes: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, number: true, currency: true, noteDate: true, amountMinor: true } },
    },
  });
  if (!r) throw returnNotFound();
  const withCost = mayViewCost(ph);
  const productIds = [...new Set(r.lines.map((l) => l.batch.productId))];
  const bases = productIds.length === 0 ? [] : await scoped.phProductUnit.findMany({ where: { productId: { in: productIds }, level: 0 }, select: { productId: true, label: true } });
  const baseUnit = new Map(bases.map((u) => [u.productId, u.label]));
  const per = withCost ? await costUnitsOf(scoped, [...new Set(r.lines.map((l) => l.batchId))]) : new Map<string, number>();
  return {
    id: r.id,
    number: r.number,
    branchId: r.branchId,
    supplierId: r.supplierId,
    supplierName: r.supplier.name,
    createdAt: r.createdAt.toISOString(),
    lineCount: r.lines.length,
    totalQty: r.lines.reduce((sum, l) => sum + l.qty, 0),
    reason: r.reason,
    note: r.note,
    ...(withCost ? { returnValue: valueOf(r.lines, per) } : {}),
    lines: r.lines.map((l) => ({
      lineNo: l.lineNo,
      batchId: l.batchId,
      productId: l.batch.productId,
      productName: l.batch.product.tradeName,
      baseUnit: baseUnit.get(l.batch.productId) ?? '',
      lot: l.batch.lot,
      expiryDate: iso(l.batch.expiryDate),
      bucket: l.bucket,
      qty: l.qty,
      ...(withCost ? { unitCostMinor: l.unitCostMinor === null ? null : l.unitCostMinor.toString(), costCurrency: l.costCurrency } : {}),
    })),
    creditNotes: r.creditNotes.map((n) => ({
      id: n.id,
      number: n.number,
      currency: n.currency,
      noteDate: iso(n.noteDate),
      ...(withCost ? { amountMinor: n.amountMinor.toString() } : {}),
    })),
  };
}
