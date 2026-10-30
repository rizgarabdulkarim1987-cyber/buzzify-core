import { z } from 'zod';
import type { ScopedClient, ScopedTx } from '@/server/data/tenant-db';
import { daysToExpiry, expiryBand, utcToday, type ExpiryBand, type ExpiryPrecision } from '@/server/domain/pharmacy/expiry';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from './actor';
import { damageStock, type Who } from './adjustments';
import { mayViewCost } from './products';

/**
 * Expiry follow-up (R2-7, R2-8): the batches that are expired or expire soon and still hold stock in a branch, and the
 * status of what is being done about each (`PhExpiryAction`, one row per batch and branch, NEW when there is none).
 * Days are UTC calendar days. Bands come from `expiryBand`, so a MONTH-precision batch is alerted from the start of its
 * last month (spec 4.4). Stock in `damaged` is not on the list: it is already written off.
 */

const WHOLE = 'Enter a whole number';
export const EXPIRY_HORIZONS = [30, 60, 90, 180] as const;
export const EXPIRY_STATUSES = ['NEW', 'IN_PROGRESS', 'MOVED', 'DISPOSED', 'RETURNED'] as const;
export type ExpiryStatus = (typeof EXPIRY_STATUSES)[number];

/** The most rows one answer works over. Past it the person narrows by branch or horizon. */
export const MAX_EXPIRY_ROWS = 20_000;
const DAY_MS = 86_400_000;
const BAND_DAYS: Record<Exclude<ExpiryBand, 'expired' | 'ok'>, number> = { d30: 30, d60: 60, d90: 90, d180: 180 };

export const expiryInput = z.object({
  days: z
    .number(WHOLE)
    .int(WHOLE)
    .refine((d) => (EXPIRY_HORIZONS as readonly number[]).includes(d), 'Choose 30, 60, 90 or 180 days')
    .default(90),
  includeExpired: z.boolean().default(true),
  cursor: z.string().min(1).max(800).nullish(),
  pageSize: z.number(WHOLE).int(WHOLE).min(1, 'Use 1 or more').max(100, 'Enter a smaller number').default(50),
});

export interface ExpiryRow {
  product: { productId: string; tradeName: string; strength: string; form: string };
  batch: { batchId: string; lot: string; expiryDate: string; expiryPrecision: ExpiryPrecision; status: 'ACTIVE' | 'RECALLED' | 'BLOCKED' };
  branchId: string;
  buckets: { available: number; reserved: number; quarantine: number };
  band: Exclude<ExpiryBand, 'ok'>;
  daysToExpiry: number;
  action: { status: ExpiryStatus; assigneeId: string | null; note: string };
  /** Only for a role with `cost.view`: the keys are absent otherwise. No value at risk is computed (no fractional money). */
  unitCostMinor?: string | null;
  currency?: 'IQD' | 'USD' | null;
  costUnitId?: string | null;
}

export interface ExpiryTotals {
  expired: number;
  d30: number;
  d60: number;
  d90: number;
  d180: number;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

interface Position {
  expiryDate: string;
  tradeName: string;
  batchId: string;
  branchId: string;
}
const order = (a: Position, b: Position) =>
  cmp(a.expiryDate, b.expiryDate) || cmp(a.tradeName, b.tradeName) || cmp(a.batchId, b.batchId) || cmp(a.branchId, b.branchId);

const encodeCursor = (p: Position) => Buffer.from(JSON.stringify([p.expiryDate, p.tradeName, p.batchId, p.branchId])).toString('base64url');
function decodeCursor(text: string): Position {
  try {
    const v = JSON.parse(Buffer.from(text, 'base64url').toString('utf8')) as unknown;
    if (Array.isArray(v) && v.length === 4 && v.every((x) => typeof x === 'string')) {
      return { expiryDate: v[0] as string, tradeName: v[1] as string, batchId: v[2] as string, branchId: v[3] as string };
    }
  } catch {
    // fall through
  }
  throw new StudioError('INVALID', 'The page marker is not valid', { cursor: 'The page marker is not valid' });
}

type Place = { branchId?: string | undefined };

/**
 * Rows per (batch, branch) with stock in available, quarantine or reserved that are expired or within `days`: expired
 * first, then soonest expiry, then product name. The read is confined by the scoped client (business, and the actor's
 * branches); a place branch narrows it further.
 */
export async function listExpiry(
  scoped: ScopedClient,
  ph: PhActor,
  input: z.infer<typeof expiryInput> & Place & { maxRows?: number },
): Promise<{ items: ExpiryRow[]; nextCursor: string | null; totals: ExpiryTotals; days: number }> {
  const today = utcToday();
  // `maxRows` lowers the limit (a seam for the export's test of its refusal); the default is the phase 2 number.
  const cap = input.maxRows ?? MAX_EXPIRY_ROWS;
  // A MONTH batch alerts from the start of its month (up to 30 days before its stored end-of-month date): fetch a month
  // wider than the horizon, then let `expiryBand` decide.
  const reach = new Date(new Date(`${today}T00:00:00.000Z`).getTime() + (input.days + 31) * DAY_MS);
  const balances = await scoped.phStockBalance.findMany({
    where: {
      ...(input.branchId ? { branchId: input.branchId } : {}),
      OR: [{ available: { gt: 0 } }, { reserved: { gt: 0 } }, { quarantine: { gt: 0 } }],
      batch: { expiryDate: { lte: reach } },
    },
    select: { batchId: true, branchId: true, productId: true, available: true, reserved: true, quarantine: true },
    take: cap + 1,
  });
  if (balances.length > cap) {
    throw new StudioError('CONFLICT', 'Too many batches match: choose a branch or a shorter horizon', { phCode: 'TOO_MANY' });
  }

  const batchIds = [...new Set(balances.map((b) => b.batchId))];
  const productIds = [...new Set(balances.map((b) => b.productId))];
  const [batches, products, actions] =
    balances.length === 0
      ? [[], [], []]
      : await Promise.all([
          scoped.phBatch.findMany({
            where: { id: { in: batchIds } },
            select: { id: true, lot: true, expiryDate: true, expiryPrecision: true, status: true, unitCostMinor: true, costCurrency: true, costUnitId: true },
          }),
          scoped.phProduct.findMany({ where: { id: { in: productIds } }, select: { id: true, tradeName: true, strength: true, form: true } }),
          scoped.phExpiryAction.findMany({
            where: { batchId: { in: batchIds }, ...(input.branchId ? { branchId: input.branchId } : {}) },
            select: { batchId: true, branchId: true, status: true, assigneeId: true, note: true },
          }),
        ]);
  const batchById = new Map(batches.map((b) => [b.id, b]));
  const productById = new Map(products.map((p) => [p.id, p]));
  const actionOf = new Map(actions.map((a) => [`${a.batchId}|${a.branchId}`, a]));
  const withCost = mayViewCost(ph);

  const totals: ExpiryTotals = { expired: 0, d30: 0, d60: 0, d90: 0, d180: 0 };
  const rows: Array<{ at: Position; row: ExpiryRow }> = [];
  for (const bal of balances) {
    const batch = batchById.get(bal.batchId);
    const product = productById.get(bal.productId);
    if (!batch || !product) continue;
    const expiryDate = iso(batch.expiryDate);
    const band = expiryBand({ expiryDate, expiryPrecision: batch.expiryPrecision }, today);
    if (band === 'ok' || (band !== 'expired' && BAND_DAYS[band] > input.days)) continue;
    totals[band] += 1;
    if (band === 'expired' && !input.includeExpired) continue;
    const action = actionOf.get(`${bal.batchId}|${bal.branchId}`);
    rows.push({
      at: { expiryDate, tradeName: product.tradeName, batchId: bal.batchId, branchId: bal.branchId },
      row: {
        product: { productId: product.id, tradeName: product.tradeName, strength: product.strength, form: product.form },
        batch: { batchId: batch.id, lot: batch.lot, expiryDate, expiryPrecision: batch.expiryPrecision, status: batch.status },
        branchId: bal.branchId,
        buckets: { available: bal.available, reserved: bal.reserved, quarantine: bal.quarantine },
        band,
        daysToExpiry: daysToExpiry({ expiryDate }, today),
        action: { status: action?.status ?? 'NEW', assigneeId: action?.assigneeId ?? null, note: action?.note ?? '' },
        ...(withCost ? { unitCostMinor: batch.unitCostMinor === null ? null : String(batch.unitCostMinor), currency: batch.costCurrency, costUnitId: batch.costUnitId } : {}),
      },
    });
  }
  rows.sort((x, y) => order(x.at, y.at));
  const after = input.cursor ? decodeCursor(input.cursor) : null;
  const rest = after ? rows.filter((r) => order(r.at, after) > 0) : rows;
  const page = rest.slice(0, input.pageSize);
  const more = rest.length > input.pageSize;
  return { items: page.map((r) => r.row), nextCursor: more ? encodeCursor(page[page.length - 1]!.at) : null, totals, days: input.days };
}

// Follow-up status -----------------------------------------------------------------------------------------------------

export const setStatusInput = z.object({
  batchId: z.string().min(1).max(64),
  status: z.enum(EXPIRY_STATUSES, 'Choose a status'),
  /** Omitted: unchanged. null: no assignee. */
  assigneeId: z.string().min(1).max(64).nullable().optional(),
  /** Omitted: unchanged. */
  note: z.string().trim().max(500, 'Use at most 500 characters').optional(),
  /** DISPOSED with stock left: the units still in available and quarantine, which are written off as damaged. */
  disposeQty: z.number(WHOLE).int(WHOLE).min(1, 'Use 1 or more').max(2_147_483_647, 'Enter a smaller number').optional(),
});
export type SetStatusInput = z.infer<typeof setStatusInput>;

export interface SetStatusResult {
  id: string;
  status: ExpiryStatus;
  assigneeId: string | null;
  /** False when nothing changed (the same call again). */
  changed: boolean;
  /** Units written off as damaged by this call (DISPOSED with `disposeQty`). */
  disposedQty: number;
  /** MOVED and RETURNED are only labels in phase 2: the transfer and supplier-return flows arrive in later phases. */
  labelOnly: boolean;
}

const isUnique = (error: unknown) => (error as { code?: unknown } | null)?.code === 'P2002';

/** An assignee works here: the restaurant's owner, or active staff of this branch (and an active user). */
async function assertAssignee(tx: ScopedTx, branchId: string, userId: string): Promise<void> {
  const [owner, staff, user] = await Promise.all([
    tx.membership.findFirst({ where: { userId, role: 'OWNER' }, select: { userId: true } }),
    tx.phStaff.findFirst({ where: { userId, deactivatedAt: null, branches: { some: { branchId } } }, select: { userId: true } }),
    tx.user.findFirst({ where: { id: userId, deactivatedAt: null }, select: { id: true } }),
  ]);
  if (!user || (!owner && !staff)) {
    throw new StudioError('INVALID', 'Choose someone who works in this branch', { assigneeId: 'Choose someone who works in this branch' });
  }
}

/** Sets the follow-up of a batch in `who.branchId`. DISPOSED needs no stock left in available and quarantine, or `disposeQty` to write it off. */
export async function setExpiryStatus(tx: ScopedTx, who: Who, input: SetStatusInput): Promise<SetStatusResult> {
  const batch = await tx.phBatch.findFirst({ where: { id: input.batchId, restaurantId: who.restaurantId }, select: { id: true } });
  const balance = batch
    ? await tx.phStockBalance.findFirst({ where: { batchId: batch.id, branchId: who.branchId }, select: { available: true, quarantine: true } })
    : null;
  if (!batch || !balance) throw new StudioError('NOT_FOUND', 'Batch not found');
  if (input.assigneeId) await assertAssignee(tx, who.branchId, input.assigneeId);

  let disposedQty = 0;
  if (input.status === 'DISPOSED') {
    const left = balance.available + balance.quarantine;
    if (left > 0) {
      if (input.disposeQty !== left) {
        throw new StudioError('CONFLICT', `${left} units are still in stock: write them off by giving that quantity`, { phCode: 'STOCK_LEFT', left: String(left) });
      }
      const reason = `Expiry disposal${input.note ? `: ${input.note}` : ''}`.slice(0, 300);
      for (const fromBucket of ['available', 'quarantine'] as const) {
        if (balance[fromBucket] > 0) await damageStock(tx, who, { batchId: batch.id, fromBucket, baseQty: balance[fromBucket], reason });
      }
      disposedQty = left;
    }
  }

  const existing = () => tx.phExpiryAction.findFirst({ where: { batchId: batch.id, branchId: who.branchId } });
  let row = await existing();
  let changed = false;
  if (!row) {
    try {
      row = await tx.phExpiryAction.create({
        data: {
          restaurantId: who.restaurantId,
          branchId: who.branchId,
          batchId: batch.id,
          status: input.status,
          assigneeId: input.assigneeId ?? null,
          note: input.note ?? '',
          updatedById: who.userId,
        },
      });
      changed = true;
    } catch (error) {
      if (!isUnique(error)) throw error;
      row = await existing();
    }
  }
  if (!changed) {
    const current = row!;
    const next = {
      status: input.status,
      assigneeId: input.assigneeId === undefined ? current.assigneeId : input.assigneeId,
      note: input.note ?? current.note,
    };
    if (next.status !== current.status || next.assigneeId !== current.assigneeId || next.note !== current.note) {
      row = await tx.phExpiryAction.update({ where: { id: current.id }, data: { ...next, updatedById: who.userId } });
      changed = true;
    }
  }
  const done = row!;
  return {
    id: done.id,
    status: done.status,
    assigneeId: done.assigneeId,
    changed: changed || disposedQty > 0,
    disposedQty,
    labelOnly: input.status === 'MOVED' || input.status === 'RETURNED',
  };
}
