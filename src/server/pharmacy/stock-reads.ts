import { z } from 'zod';
import { StudioError } from '@/server/studio/framework/result';
import type { ScopedClient } from '@/server/data/tenant-db';
import { fefoOrder, sellableStock, type BatchStatus } from '@/server/domain/pharmacy/stock';
import { isExpired, utcToday, type ExpiryPrecision } from '@/server/domain/pharmacy/expiry';
import { normalizeForSearch } from '@/server/domain/pharmacy/product-identity';
import type { PhActor } from './actor';
import { mayViewCost } from './products';
import { BUCKETS, type Bucket } from './stock';

/**
 * Reading stock (Phase 2): balances per product with their batches in FEFO order, and the movement ledger. Both read
 * through the scoped client they are given, so another business's rows are never seen and a branch-limited actor gets
 * their branches only. A page costs a fixed number of queries whatever its size: the products of the page, then their
 * balances, batches and branch minimums in one query each, joined here.
 */

const WHOLE = 'Enter a whole number';
const iso = (d: Date) => d.toISOString().slice(0, 10);
const DAY_MS = 86_400_000;
const cursor = z.string().min(1).max(64).nullish();
const pageSize = z.number(WHOLE).int(WHOLE).min(1, 'Use 1 or more').max(100, 'Enter a smaller number').default(50);

const dateText = z
  .string()
  .trim()
  .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && iso(new Date(`${v}T00:00:00.000Z`)) === v, 'Enter a date as YYYY-MM-DD');

export const balancesInput = z.object({
  productId: z.string().min(1).max(64).optional(),
  search: z.string().max(100, 'Use at most 100 characters').optional(),
  /** Products holding any stock (any bucket) in the branches shown. */
  onlyWithStock: z.boolean().optional(),
  /** Products with a minimum set whose available stock in a branch shown is below it. */
  lowStock: z.boolean().optional(),
  cursor,
  pageSize,
});

export const MOVEMENT_TYPES = [
  'RECEIPT',
  'SALE',
  'RETURN_IN',
  'RETURN_QUARANTINE',
  'ADJUST',
  'DAMAGE',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'SUPPLIER_RETURN',
  'COUNT',
  'QUARANTINE_RELEASE',
] as const;

export const movementsInput = z.object({
  productId: z.string().min(1).max(64).optional(),
  batchId: z.string().min(1).max(64).optional(),
  type: z.enum(MOVEMENT_TYPES).optional(),
  from: dateText.optional(),
  to: dateText.optional(),
  cursor,
  pageSize,
});

export interface BucketTotals {
  available: number;
  reserved: number;
  quarantine: number;
  damaged: number;
  /** What can be sold (R2-5): `available` of active, unexpired batches only. */
  sellable: number;
}

export interface BranchTotals extends BucketTotals {
  branchId: string;
  /** The branch's minimum for the product (0 when none is set). */
  minQty: number;
}

export interface BatchBuckets extends BucketTotals {
  branchId: string;
}

export interface BatchView {
  batchId: string;
  lot: string;
  expiryDate: string;
  expiryPrecision: ExpiryPrecision;
  status: BatchStatus;
  expired: boolean;
  buckets: BatchBuckets[];
  /** Only for a role with `cost.view`: the key is absent otherwise. */
  unitCostMinor?: string | null;
  currency?: 'IQD' | 'USD' | null;
  costUnitId?: string | null;
}

export interface ProductBalance {
  productId: string;
  tradeName: string;
  strength: string;
  form: string;
  active: boolean;
  branches: BranchTotals[];
  batches: BatchView[];
}

const zero = (): Record<Bucket, number> => ({ available: 0, reserved: 0, quarantine: 0, damaged: 0 });
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** `LIKE` treats `%`, `_` and `\` as pattern characters; a search means them literally. */
const literal = (text: string) => text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
const hasStock = (b: Record<Bucket, number>) => BUCKETS.some((k) => b[k] > 0);

type Place = { branchId?: string | undefined };

/**
 * The most products a stock filter may keep. The ids go back to the database as one `id IN (...)` list: fine for a few
 * thousand products, so a bigger answer is refused (narrow it with a search or a branch) instead of failing slowly.
 */
export const MAX_FILTERED_PRODUCTS = 5000;

/** The products a stock filter keeps, as ids; null when no filter is on. */
async function filteredIds(scoped: ScopedClient, input: z.infer<typeof balancesInput> & Place): Promise<string[] | null> {
  if (!input.onlyWithStock && !input.lowStock) return null;
  const branch = input.branchId ? { branchId: input.branchId } : {};
  const product = input.productId ? { productId: input.productId } : {};
  const today = new Date(`${utcToday()}T00:00:00.000Z`);
  const [sums, sellableSums, minimums] = await Promise.all([
    scoped.phStockBalance.groupBy({
      by: ['productId', 'branchId'],
      where: { ...branch, ...product },
      _sum: { available: true, reserved: true, quarantine: true, damaged: true },
    }),
    // R2-5: only `available` of an ACTIVE batch that has not expired counts as stock to sell.
    input.lowStock
      ? scoped.phStockBalance.groupBy({
          by: ['productId', 'branchId'],
          where: { ...branch, ...product, batch: { status: 'ACTIVE', expiryDate: { gte: today } } },
          _sum: { available: true },
        })
      : Promise.resolve([]),
    input.lowStock ? scoped.phProductBranch.findMany({ where: { ...branch, ...product, minQty: { gt: 0 } }, select: { productId: true, branchId: true, minQty: true } }) : Promise.resolve([]),
  ]);
  let ids: Set<string> | null = null;
  const narrow = (next: Set<string>) => {
    ids = ids === null ? next : new Set([...ids].filter((id) => next.has(id)));
  };
  if (input.onlyWithStock) {
    narrow(new Set(sums.filter((s) => (s._sum.available ?? 0) + (s._sum.reserved ?? 0) + (s._sum.quarantine ?? 0) + (s._sum.damaged ?? 0) > 0).map((s) => s.productId)));
  }
  if (input.lowStock) {
    const availableAt = new Map(sellableSums.map((s) => [`${s.productId}|${s.branchId}`, s._sum.available ?? 0]));
    narrow(new Set(minimums.filter((m) => (availableAt.get(`${m.productId}|${m.branchId}`) ?? 0) < m.minQty).map((m) => m.productId)));
  }
  const kept = [...(ids ?? [])];
  if (kept.length > MAX_FILTERED_PRODUCTS) {
    throw new StudioError('CONFLICT', 'Too many products match: narrow the search or choose a branch', { phCode: 'TOO_MANY' });
  }
  return kept;
}

/** Products by trade name, each with its branch totals and its batches earliest expiry first. */
export async function listBalances(
  scoped: ScopedClient,
  ph: PhActor,
  input: z.infer<typeof balancesInput> & Place,
): Promise<{ items: ProductBalance[]; nextCursor: string | null }> {
  const ids = await filteredIds(scoped, input);
  const words = [...new Set(normalizeForSearch(input.search ?? '').split(' ').filter(Boolean))].slice(0, 8);
  const rows = await scoped.phProduct.findMany({
    where: {
      ...(input.productId ? { id: input.productId } : {}),
      ...(ids !== null ? { id: { in: ids } } : {}),
      ...(words.length > 0 ? { AND: words.map((w) => ({ searchText: { contains: literal(w) } })) } : {}),
    },
    select: { id: true, tradeName: true, strength: true, form: true, active: true },
    orderBy: [{ tradeName: 'asc' }, { id: 'asc' }],
    take: input.pageSize + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });
  const more = rows.length > input.pageSize;
  const page = more ? rows.slice(0, input.pageSize) : rows;
  const productIds = page.map((p) => p.id);
  const branch = input.branchId ? { branchId: input.branchId } : {};

  const [balances, batches, minimums] =
    productIds.length === 0
      ? [[], [], []]
      : await Promise.all([
          scoped.phStockBalance.findMany({
            where: { productId: { in: productIds }, ...branch },
            select: { productId: true, batchId: true, branchId: true, available: true, reserved: true, quarantine: true, damaged: true },
          }),
          scoped.phBatch.findMany({
            where: { productId: { in: productIds } },
            select: { id: true, productId: true, lot: true, expiryDate: true, expiryPrecision: true, status: true, unitCostMinor: true, costCurrency: true, costUnitId: true },
          }),
          scoped.phProductBranch.findMany({ where: { productId: { in: productIds }, ...branch }, select: { productId: true, branchId: true, minQty: true } }),
        ]);

  const today = utcToday();
  const withCost = mayViewCost(ph);
  const batchById = new Map(batches.map((b) => [b.id, b]));
  const balancesOf = new Map<string, typeof balances>();
  for (const row of balances) {
    if (!hasStock(row)) continue;
    balancesOf.set(row.productId, [...(balancesOf.get(row.productId) ?? []), row]);
  }
  const minimumsOf = new Map<string, Map<string, number>>();
  for (const m of minimums) minimumsOf.set(m.productId, (minimumsOf.get(m.productId) ?? new Map()).set(m.branchId, m.minQty));

  const items = page.map((product): ProductBalance => {
    const own = balancesOf.get(product.id) ?? [];
    const totals = new Map<string, BranchTotals>();
    const totalsOf = (branchId: string) => {
      let t = totals.get(branchId);
      if (!t) totals.set(branchId, (t = { branchId, ...zero(), sellable: 0, minQty: minimumsOf.get(product.id)?.get(branchId) ?? 0 }));
      return t;
    };
    for (const branchId of minimumsOf.get(product.id)?.keys() ?? []) totalsOf(branchId);

    const perBatch = new Map<string, BatchBuckets[]>();
    for (const row of own) {
      const batch = batchById.get(row.batchId);
      if (!batch) continue;
      const sellable = sellableStock(row, { status: batch.status, expiryDate: iso(batch.expiryDate) }, today);
      const t = totalsOf(row.branchId);
      for (const k of BUCKETS) t[k] += row[k];
      t.sellable += sellable;
      perBatch.set(batch.id, [...(perBatch.get(batch.id) ?? []), { branchId: row.branchId, available: row.available, reserved: row.reserved, quarantine: row.quarantine, damaged: row.damaged, sellable }]);
    }

    const views = [...perBatch.keys()].map((id) => batchById.get(id)!).map((b) => {
      const expiryDate = iso(b.expiryDate);
      const view: BatchView = {
        batchId: b.id,
        lot: b.lot,
        expiryDate,
        expiryPrecision: b.expiryPrecision,
        status: b.status,
        expired: isExpired({ expiryDate }, today),
        buckets: perBatch.get(b.id)!.sort((x, y) => cmp(x.branchId, y.branchId)),
        ...(withCost ? { unitCostMinor: b.unitCostMinor === null ? null : String(b.unitCostMinor), currency: b.costCurrency, costUnitId: b.costUnitId } : {}),
      };
      return view;
    });
    views.sort((x, y) => fefoOrder({ id: x.batchId, lot: x.lot, expiryDate: x.expiryDate, expiryPrecision: x.expiryPrecision }, { id: y.batchId, lot: y.lot, expiryDate: y.expiryDate, expiryPrecision: y.expiryPrecision }));

    return {
      productId: product.id,
      tradeName: product.tradeName,
      strength: product.strength,
      form: product.form,
      active: product.active,
      branches: [...totals.values()].sort((x, y) => cmp(x.branchId, y.branchId)),
      batches: views,
    };
  });
  return { items, nextCursor: more ? page[page.length - 1]!.id : null };
}

export interface MovementView {
  id: string;
  type: (typeof MOVEMENT_TYPES)[number];
  branchId: string;
  productId: string;
  batchId: string;
  lot: string;
  availableDelta: number;
  reservedDelta: number;
  quarantineDelta: number;
  damagedDelta: number;
  reason: string;
  /** The person's id only; a name or email is not part of the ledger read. */
  userId: string;
  reversesId: string | null;
  receiptId: string | null;
  countId: string | null;
  createdAt: string;
}

/** The ledger, newest first. */
export async function listMovements(
  scoped: ScopedClient,
  input: z.infer<typeof movementsInput> & Place,
): Promise<{ items: MovementView[]; nextCursor: string | null }> {
  const at: { gte?: Date; lt?: Date } = {};
  if (input.from) at.gte = new Date(`${input.from}T00:00:00.000Z`);
  if (input.to) at.lt = new Date(new Date(`${input.to}T00:00:00.000Z`).getTime() + DAY_MS);
  const rows = await scoped.phStockMovement.findMany({
    where: {
      ...(input.branchId ? { branchId: input.branchId } : {}),
      ...(input.productId ? { productId: input.productId } : {}),
      ...(input.batchId ? { batchId: input.batchId } : {}),
      ...(input.type ? { type: input.type } : {}),
      ...(at.gte || at.lt ? { createdAt: at } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: input.pageSize + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });
  const more = rows.length > input.pageSize;
  const page = more ? rows.slice(0, input.pageSize) : rows;
  const lots = new Map(
    (page.length === 0 ? [] : await scoped.phBatch.findMany({ where: { id: { in: [...new Set(page.map((r) => r.batchId))] } }, select: { id: true, lot: true } })).map((b) => [b.id, b.lot]),
  );
  return {
    items: page.map((r) => ({
      id: r.id,
      type: r.type,
      branchId: r.branchId,
      productId: r.productId,
      batchId: r.batchId,
      lot: lots.get(r.batchId) ?? '',
      availableDelta: r.availableDelta,
      reservedDelta: r.reservedDelta,
      quarantineDelta: r.quarantineDelta,
      damagedDelta: r.damagedDelta,
      reason: r.reason,
      userId: r.userId,
      reversesId: r.reversesId,
      receiptId: r.receiptId,
      countId: r.countId,
      createdAt: r.createdAt.toISOString(),
    })),
    nextCursor: more ? page[page.length - 1]!.id : null,
  };
}
