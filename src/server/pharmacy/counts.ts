import { z } from 'zod';
import type { ScopedClient, ScopedTx } from '@/server/data/tenant-db';
import { isExpired, utcToday } from '@/server/domain/pharmacy/expiry';
import { canPh, PH_ROLES } from '@/server/domain/pharmacy/permissions';
import { assertSellableHome } from './adjustments';
import { mayViewCost } from '@/server/pharmacy/products';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from './actor';
import { applyMovement, lockOrder } from './stock';

/**
 * Stock counts (R2-6): open a count of a branch, a category or a shelf location, record what was counted, submit it, and
 * have a holder of `stock.adjust` approve it. Approving turns each difference into a COUNT movement. The difference is
 * `counted - expectedAtOpen`, and it is ADDED to the current `available`, so sales and receipts since the count opened
 * are kept. The services take the transaction (or scoped client) of the action or query that calls them; the actions
 * audit.
 */

export const MAX_COUNT_LINES = 5000;
const MAX_QTY = 1_000_000_000;
const WHOLE = 'Enter a whole number';

export const countOpenInput = z
  .object({
    scope: z.enum(['BRANCH', 'CATEGORY', 'LOCATION']),
    categoryId: z.string().min(1).max(64).optional(),
    location: z.string().trim().max(100, 'Use at most 100 characters').optional(),
    blind: z.boolean().default(false),
    note: z.string().trim().max(500, 'Use at most 500 characters').default(''),
  })
  .superRefine((v, ctx) => {
    if (v.scope === 'CATEGORY' && !v.categoryId) ctx.addIssue({ code: 'custom', path: ['categoryId'], message: 'Choose the category' });
    if (v.scope === 'LOCATION' && !v.location) ctx.addIssue({ code: 'custom', path: ['location'], message: 'Enter the shelf location' });
  });
export type CountOpenInput = z.infer<typeof countOpenInput>;

export const countRecordInput = z.object({
  lines: z
    .array(
      z.object({
        lineId: z.string().min(1).max(64),
        countedQty: z.number(WHOLE).int(WHOLE).min(0, 'Use 0 or more').max(MAX_QTY, 'Enter a smaller number'),
      }),
    )
    .min(1, 'Add at least one line')
    .max(MAX_COUNT_LINES, 'Use at most 5000 lines'),
});

export const countListInput = z.object({
  status: z.enum(['OPEN', 'SUBMITTED', 'APPROVED', 'CANCELLED']).optional(),
  cursor: z.string().min(1).max(64).nullish(),
  pageSize: z.number(WHOLE).int(WHOLE).min(1, 'Use 1 or more').max(100, 'Enter a smaller number').default(50),
});

const invalid = (field: string, message: string, extra: Record<string, string> = {}) =>
  new StudioError('INVALID', message, { [field]: message, ...extra });
const conflict = (message: string, phCode: string, extra: Record<string, string> = {}) =>
  new StudioError('CONFLICT', message, { phCode, ...extra });
const notFound = () => new StudioError('NOT_FOUND', 'Count not found');

// Open ----------------------------------------------------------------------------------------------------------------

export interface OpenResult {
  id: string;
  status: 'OPEN';
  version: number;
  scope: 'BRANCH' | 'CATEGORY' | 'LOCATION';
  blind: boolean;
  lineCount: number;
  /** Other OPEN counts of the same branch and scope: allowed, reported. */
  otherOpen: number;
}

/**
 * Opens a count in `branchId` and snapshots one line per batch holding any stock there (any bucket) within the scope.
 * `expectedQty` is the batch's `available` at this moment: reserved, quarantined and damaged stock is not on the shelf
 * to be counted. A scope above `MAX_COUNT_LINES` is refused.
 */
export async function openCount(
  tx: ScopedTx,
  args: { restaurantId: string; branchId: string; userId: string; input: CountOpenInput },
): Promise<OpenResult> {
  const { input } = args;
  let scopeValue = '';
  let productWhere: Record<string, unknown> = {};
  if (input.scope === 'CATEGORY') {
    const category = await tx.phCategory.findFirst({ where: { id: input.categoryId! }, select: { id: true } });
    if (!category) throw invalid('categoryId', 'Choose one of this pharmacy’s categories');
    scopeValue = category.id;
    productWhere = { categoryId: category.id };
  } else if (input.scope === 'LOCATION') {
    scopeValue = input.location!;
    productWhere = { shelfLocation: { startsWith: scopeValue.replace(/[\\%_]/g, '\\$&'), mode: 'insensitive' } };
  }

  const balances = await tx.phStockBalance.findMany({
    where: {
      branchId: args.branchId,
      OR: [{ available: { gt: 0 } }, { reserved: { gt: 0 } }, { quarantine: { gt: 0 } }, { damaged: { gt: 0 } }],
      ...(input.scope === 'BRANCH' ? {} : { product: productWhere }),
    },
    select: { batchId: true, productId: true, available: true },
    take: MAX_COUNT_LINES + 1,
  });
  if (balances.length > MAX_COUNT_LINES) {
    throw invalid('scope', `This count would have more than ${MAX_COUNT_LINES} lines: choose a category or a shelf location`, {
      phCode: 'SCOPE_TOO_LARGE',
    });
  }
  if (balances.length === 0) {
    throw invalid('scope', 'Nothing in stock matches this scope', { phCode: 'EMPTY_SCOPE' });
  }

  const otherOpen = await tx.phStockCount.count({ where: { branchId: args.branchId, status: 'OPEN', scope: input.scope, scopeValue } });
  const count = await tx.phStockCount.create({
    data: {
      restaurantId: args.restaurantId,
      branchId: args.branchId,
      scope: input.scope,
      scopeValue,
      blind: input.blind,
      note: input.note,
      countedById: args.userId,
    },
    select: { id: true, version: true },
  });
  await tx.phStockCountLine.createMany({
    data: lockOrder(balances).map((b) => ({
      restaurantId: args.restaurantId,
      countId: count.id,
      productId: b.productId,
      batchId: b.batchId,
      expectedQty: b.available,
    })),
  });
  return { id: count.id, status: 'OPEN', version: count.version, scope: input.scope, blind: input.blind, lineCount: balances.length, otherOpen };
}

// Record / submit / cancel --------------------------------------------------------------------------------------------

/** Counted quantities for lines of an OPEN count; the person who records is the counter. */
export async function recordCounts(
  tx: ScopedTx,
  args: { countId: string; userId: string; input: z.infer<typeof countRecordInput> },
): Promise<{ id: string; recorded: number; version: number }> {
  const head = await tx.phStockCount.findFirst({ where: { id: args.countId }, select: { id: true, countedById: true } });
  if (!head) throw notFound();
  // One counter per count: once a line is counted, only that person records (the owner may cancel and reopen).
  if (head.countedById !== args.userId && (await tx.phStockCountLine.count({ where: { countId: args.countId, countedQty: { not: null } } })) > 0) {
    throw conflict('Another person is already counting this; cancel it to count again', 'COUNT_OWNED');
  }
  const ids = args.input.lines.map((l) => l.lineId);
  if (new Set(ids).size !== ids.length) throw invalid('lines', 'A line appears twice');
  const owned = await tx.phStockCountLine.findMany({ where: { countId: args.countId, id: { in: ids } }, select: { id: true } });
  if (owned.length !== ids.length) {
    const own = new Set(owned.map((l) => l.id));
    const at = ids.findIndex((id) => !own.has(id));
    throw invalid(`lines.${at}.lineId`, 'This line is not part of this count');
  }
  const won = await tx.phStockCount.updateMany({
    where: { id: args.countId, status: 'OPEN', countedById: head.countedById },
    data: { countedById: args.userId, version: { increment: 1 } },
  });
  if (won.count !== 1) {
    const now = await tx.phStockCount.findFirst({ where: { id: args.countId }, select: { status: true } });
    if (now?.status === 'OPEN') throw conflict('Another person is already counting this; cancel it to count again', 'COUNT_OWNED');
    throw conflict('Only an open count can be changed', 'NOT_OPEN');
  }
  // The application clock, the one the movements' createdAt uses: the window of a line's expected quantity ends here.
  const countedAt = new Date();
  const byQty = new Map<number, string[]>();
  for (const l of args.input.lines) byQty.set(l.countedQty, [...(byQty.get(l.countedQty) ?? []), l.lineId]);
  for (const [qty, lineIds] of byQty) {
    await tx.phStockCountLine.updateMany({ where: { countId: args.countId, id: { in: lineIds } }, data: { countedQty: qty, countedAt } });
  }
  const version = (await tx.phStockCount.findFirstOrThrow({ where: { id: args.countId }, select: { version: true } })).version;
  return { id: args.countId, recorded: ids.length, version };
}

/** OPEN to SUBMITTED, when every line is counted (or the person chose to leave the uncounted ones out). */
export async function submitCount(
  tx: ScopedTx,
  args: { countId: string; skipUncounted: boolean },
): Promise<{ id: string; status: 'SUBMITTED'; uncounted: number; version: number }> {
  const head = await tx.phStockCount.findFirst({ where: { id: args.countId }, select: { id: true, status: true } });
  if (!head) throw notFound();
  const won = await tx.phStockCount.updateMany({
    where: { id: args.countId, status: 'OPEN' },
    data: { status: 'SUBMITTED', submittedAt: new Date(), version: { increment: 1 } },
  });
  if (won.count !== 1) throw conflict('Only an open count can be submitted', 'NOT_OPEN');
  // After the guard: the header row is held, so no record call can run meanwhile. A refusal rolls the update back.
  const uncounted = await tx.phStockCountLine.count({ where: { countId: args.countId, countedQty: null } });
  if (uncounted > 0 && !args.skipUncounted) {
    throw invalid('lines', `${uncounted} lines are not counted yet: count them, or choose to skip them`, { phCode: 'UNCOUNTED_LINES' });
  }
  const version = (await tx.phStockCount.findFirstOrThrow({ where: { id: args.countId }, select: { version: true } })).version;
  return { id: args.countId, status: 'SUBMITTED', uncounted, version };
}

/** Who opened a count: the actor of its `ph.count.open` audit row (the count itself stores only the counter). */
async function openerOf(tx: Pick<ScopedTx, 'auditLog'>, restaurantId: string, countId: string): Promise<string | null> {
  const row = await tx.auditLog.findFirst({
    where: { action: 'ph.count.open', entityType: 'PhStockCount', entityId: countId, restaurantId },
    select: { actorId: true },
  });
  return row?.actorId ?? null;
}

/**
 * OPEN or SUBMITTED to CANCELLED. Nothing was applied to stock. An OPEN count is cancelled by the person who opened it or
 * a holder of `stock.adjust`; a SUBMITTED one also by the person who counted it.
 */
export async function cancelCount(
  tx: ScopedTx,
  args: { countId: string; userId: string; canAdjust: boolean },
): Promise<{ id: string; status: 'CANCELLED'; from: 'OPEN' | 'SUBMITTED' }> {
  const head = await tx.phStockCount.findFirst({ where: { id: args.countId }, select: { status: true, restaurantId: true, countedById: true } });
  if (!head) throw notFound();
  if (!args.canAdjust && (head.status === 'OPEN' || head.status === 'SUBMITTED')) {
    const opener = (await openerOf(tx, head.restaurantId, args.countId)) ?? head.countedById;
    const mine = opener === args.userId || (head.status === 'SUBMITTED' && head.countedById === args.userId);
    if (!mine) throw new StudioError('FORBIDDEN', 'Only the person who started or counted this, or a stock approver, can cancel it', { phCode: 'NOT_YOUR_COUNT' });
  }
  const won = await tx.phStockCount.updateMany({
    where: { id: args.countId, status: { in: ['OPEN', 'SUBMITTED'] } },
    data: { status: 'CANCELLED', version: { increment: 1 } },
  });
  if (won.count !== 1) throw conflict('This count can no longer be cancelled', 'NOT_CANCELLABLE');
  return { id: args.countId, status: 'CANCELLED', from: head.status as 'OPEN' | 'SUBMITTED' };
}

/**
 * What each counted line should have held at the moment it was counted: the quantity at open plus the `available`
 * movements of its batch in this branch after the count opened and up to the line's `countedAt`. (COUNT movements of
 * this very count are left out: they are its own approval.) A receipt, damage, disposal or reversal made while the count
 * was open is therefore already in the number the shelf is compared with; movements after `countedAt` are not, so they
 * stay on top of the correction. Both clocks are the application's.
 */
async function movedUntilCounted(
  tx: Pick<ScopedTx, 'phStockMovement'>,
  head: { id: string; branchId: string; createdAt: Date },
  lines: readonly { id: string; batchId: string; countedAt: Date | null }[],
): Promise<Map<string, number>> {
  const moved = new Map<string, number>();
  const stamped = lines.filter((l) => l.countedAt !== null);
  if (stamped.length === 0) return moved;
  const latest = new Date(Math.max(...stamped.map((l) => l.countedAt!.getTime())));
  const rows = await tx.phStockMovement.findMany({
    where: { branchId: head.branchId, batchId: { in: [...new Set(stamped.map((l) => l.batchId))] }, createdAt: { gt: head.createdAt, lte: latest }, availableDelta: { not: 0 } },
    select: { batchId: true, availableDelta: true, createdAt: true, type: true, countId: true },
  });
  const byBatch = new Map<string, typeof rows>();
  for (const r of rows) {
    if (r.type === 'COUNT' && r.countId === head.id) continue;
    byBatch.set(r.batchId, [...(byBatch.get(r.batchId) ?? []), r]);
  }
  for (const l of stamped) {
    const at = l.countedAt!.getTime();
    moved.set(l.id, (byBatch.get(l.batchId) ?? []).filter((r) => r.createdAt.getTime() <= at).reduce((sum, r) => sum + r.availableDelta, 0));
  }
  return moved;
}

// Approve -------------------------------------------------------------------------------------------------------------

const APPROVER_ROLES = PH_ROLES.filter((r) => canPh(r, 'stock.adjust'));

/** The active users who may approve in `branchId`: the owners, and staff with `stock.adjust` who work in that branch. */
async function approversIn(tx: ScopedTx, branchId: string): Promise<Set<string>> {
  const [owners, staff] = await Promise.all([
    tx.membership.findMany({ where: { role: 'OWNER' }, select: { userId: true } }),
    tx.phStaff.findMany({
      where: { deactivatedAt: null, role: { in: APPROVER_ROLES }, branches: { some: { branchId } } },
      select: { userId: true },
    }),
  ]);
  const ids = [...new Set([...owners, ...staff].map((r) => r.userId))];
  if (ids.length === 0) return new Set();
  const active = await tx.user.findMany({ where: { id: { in: ids }, deactivatedAt: null }, select: { id: true } });
  return new Set(active.map((u) => u.id));
}

export interface ApproveResult {
  id: string;
  status: 'APPROVED';
  version: number;
  movements: number;
  selfApproved: boolean;
  countedLines: number;
  netDifference: number;
  differences: { lineId: string; batchId: string; expected: number; counted: number; difference: number }[];
}

/**
 * Approves a SUBMITTED count. The conditional SUBMITTED to APPROVED update is the guard that lets exactly one of two
 * concurrent approvals win. Each non-zero difference (`counted - expectedAtOpen`) becomes a COUNT movement added to the
 * current `available`, in batch order, in this transaction: a line that would take the batch below zero fails the whole
 * approval (INSUFFICIENT_STOCK naming the line) and nothing is written.
 */
export async function approveCount(
  tx: ScopedTx,
  args: { countId: string; userId: string; reason: string; expectedVersion?: number },
): Promise<ApproveResult> {
  const head = await tx.phStockCount.findFirst({
    where: { id: args.countId },
    select: { id: true, status: true, branchId: true, restaurantId: true, countedById: true, createdAt: true },
  });
  if (!head) throw notFound();
  // Approvals of one branch queue, so the stale check below sees every earlier approval's movements.
  // eslint-disable-next-line no-restricted-properties -- an advisory lock touches no tenant rows: it only serialises one branch's count approvals
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ph-count:${head.branchId}`}))`;
  if (head.status !== 'SUBMITTED') throw conflict('Only a submitted count can be approved', 'NOT_SUBMITTED');

  const lines = await tx.phStockCountLine.findMany({
    where: { countId: args.countId, countedQty: { not: null } },
    select: {
      id: true,
      batchId: true,
      expectedQty: true,
      countedQty: true,
      countedAt: true,
      product: { select: { tradeName: true } },
      batch: { select: { lot: true, status: true, expiryDate: true } },
    },
  });
  const moved = await movedUntilCounted(tx, head, lines.map((l) => ({ id: l.id, batchId: l.batchId, countedAt: l.countedAt })));
  const diffs = lockOrder(
    lines.map((l) => ({ ...l, expectedAtCount: l.expectedQty + (moved.get(l.id) ?? 0), difference: l.countedQty! - l.expectedQty - (moved.get(l.id) ?? 0) })),
  ).filter((l) => l.difference !== 0);
  const reason = args.reason.trim();
  // The counter is the one who recorded; the opener is in the open audit row (the count stores only the counter).
  const opened = await tx.auditLog.findFirst({
    where: { action: 'ph.count.open', entityType: 'PhStockCount', entityId: args.countId, restaurantId: head.restaurantId },
    select: { actorId: true },
  });
  const selfApproved = head.countedById === args.userId || opened?.actorId === args.userId;

  // Another count already corrected one of these batches here since this count opened: its numbers are out of date.
  const stale = await tx.phStockMovement.findFirst({
    where: {
      branchId: head.branchId,
      type: 'COUNT',
      batchId: { in: lines.map((l) => l.batchId) },
      createdAt: { gt: head.createdAt },
      OR: [{ countId: null }, { countId: { not: args.countId } }],
    },
    select: { batchId: true },
  });
  if (stale) {
    const line = lines.find((l) => l.batchId === stale.batchId)!;
    throw conflict(
      `${line.product.tradeName} (lot ${line.batch.lot}) was already corrected by another count: cancel this count and count again`,
      'STALE_COUNT',
      { lineId: line.id, batchId: line.batchId },
    );
  }

  if (diffs.length > 0) {
    if (reason.length < 3 || reason.length > 300) throw invalid('reason', 'Enter the reason (3 to 300 characters)');
    if (selfApproved) {
      const approvers = await approversIn(tx, head.branchId);
      if (approvers.size > 1) {
        throw new StudioError('FORBIDDEN', 'Someone else must approve a count you made', { phCode: 'SELF_APPROVAL' });
      }
    }
  }

  // Counting more than there should be puts stock on the shelf: not for a batch that may not be sold (expired, recalled, blocked).
  for (const line of diffs) {
    if (line.difference <= 0) continue;
    try {
      assertSellableHome({ status: line.batch.status, expiryDate: line.batch.expiryDate.toISOString().slice(0, 10) });
    } catch {
      throw conflict(
        `${line.product.tradeName} (lot ${line.batch.lot}) cannot go back on sale, so counting more than expected is refused. Count it as it is, or move the stock to quarantine with an adjustment.`,
        'NOT_SELLABLE_HOME',
        { lineId: line.id, batchId: line.batchId, difference: String(line.difference) },
      );
    }
  }

  const won = await tx.phStockCount.updateMany({
    where: { id: args.countId, status: 'SUBMITTED', ...(args.expectedVersion !== undefined ? { version: args.expectedVersion } : {}) },
    data: { status: 'APPROVED', approvedById: args.userId, approvedAt: new Date(), reason, version: { increment: 1 } },
  });
  if (won.count !== 1) {
    const now = await tx.phStockCount.findFirst({ where: { id: args.countId }, select: { status: true } });
    if (now && now.status !== 'SUBMITTED') throw conflict('This count was already processed', 'NOT_SUBMITTED');
    throw conflict('Someone else changed this count: reload it', 'STALE');
  }

  for (const line of diffs) {
    try {
      await applyMovement(tx, {
        restaurantId: head.restaurantId,
        branchId: head.branchId,
        batchId: line.batchId,
        type: 'COUNT',
        deltas: { available: line.difference },
        reason,
        userId: args.userId,
        countId: args.countId,
        refType: 'PhStockCountLine',
        refId: line.id,
      });
    } catch (error) {
      if (error instanceof StudioError && error.fields?.phCode === 'INSUFFICIENT_STOCK') {
        throw conflict(
          `${line.product.tradeName} (lot ${line.batch.lot}) has only ${error.fields.have ?? '0'} left, so a difference of ${line.difference} cannot be applied`,
          'INSUFFICIENT_STOCK',
          { lineId: line.id, batchId: line.batchId, have: error.fields.have ?? '0', difference: String(line.difference) },
        );
      }
      throw error;
    }
  }

  const version = (await tx.phStockCount.findFirstOrThrow({ where: { id: args.countId }, select: { version: true } })).version;
  return {
    id: args.countId,
    status: 'APPROVED',
    version,
    movements: diffs.length,
    selfApproved,
    countedLines: lines.length,
    netDifference: diffs.reduce((sum, l) => sum + l.difference, 0),
    differences: diffs.map((l) => ({ lineId: l.id, batchId: l.batchId, expected: l.expectedAtCount, counted: l.countedQty!, difference: l.difference })),
  };
}

// Reads ---------------------------------------------------------------------------------------------------------------

/** A support actor reads no counts (they hold stock and cost): only staff do. */
export function assertStaff(ph: PhActor): void {
  if (ph.support !== null || ph.role === null) throw new StudioError('FORBIDDEN');
}

export interface CountSummary {
  id: string;
  status: 'OPEN' | 'SUBMITTED' | 'APPROVED' | 'CANCELLED';
  branchId: string;
  scope: 'BRANCH' | 'CATEGORY' | 'LOCATION';
  scopeValue: string;
  blind: boolean;
  note: string;
  countedById: string;
  approvedById: string | null;
  lineCount: number;
  version: number;
  createdAt: string;
  submittedAt: string | null;
  approvedAt: string | null;
}

const SUMMARY_SELECT = {
  id: true,
  status: true,
  branchId: true,
  scope: true,
  scopeValue: true,
  blind: true,
  note: true,
  countedById: true,
  approvedById: true,
  version: true,
  createdAt: true,
  submittedAt: true,
  approvedAt: true,
  _count: { select: { lines: true } },
} as const;

type SummaryRow = {
  id: string;
  status: CountSummary['status'];
  branchId: string;
  scope: CountSummary['scope'];
  scopeValue: string;
  blind: boolean;
  note: string;
  countedById: string;
  approvedById: string | null;
  version: number;
  createdAt: Date;
  submittedAt: Date | null;
  approvedAt: Date | null;
  _count: { lines: number };
};

const summaryOf = (r: SummaryRow): CountSummary => ({
  id: r.id,
  status: r.status,
  branchId: r.branchId,
  scope: r.scope,
  scopeValue: r.scopeValue,
  blind: r.blind,
  note: r.note,
  countedById: r.countedById,
  approvedById: r.approvedById,
  lineCount: r._count.lines,
  version: r.version,
  createdAt: r.createdAt.toISOString(),
  submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null,
  approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
});

/** Newest first, by cursor. The scoped client keeps a branch-limited actor to their branches. No quantities. */
export async function listCounts(
  scoped: ScopedClient,
  input: z.infer<typeof countListInput> & { branchId?: string },
): Promise<{ items: CountSummary[]; nextCursor: string | null }> {
  const rows = await scoped.phStockCount.findMany({
    where: { ...(input.status ? { status: input.status } : {}), ...(input.branchId ? { branchId: input.branchId } : {}) },
    select: SUMMARY_SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: input.pageSize + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });
  const more = rows.length > input.pageSize;
  const page = more ? rows.slice(0, input.pageSize) : rows;
  return { items: page.map((r) => summaryOf(r as SummaryRow)), nextCursor: more ? page[page.length - 1]!.id : null };
}

export interface CountLineView {
  lineId: string;
  productId: string;
  productName: string;
  batchId: string;
  lot: string;
  expiryDate: string;
  expiryPrecision: 'DAY' | 'MONTH';
  countedQty: number | null;
  /** Absent (not null) while a blind count is OPEN. The shelf quantity when the count opened. */
  expectedQty?: number;
  /** The quantity it should have held when this line was counted: `expectedQty` plus the movements between open and then. Absent while hidden or not counted. */
  expectedAtCount?: number;
  /** `countedQty - expectedAtCount`, the number approval applies; absent while hidden or not counted. */
  difference?: number;
  /** Stock of this batch in this branch that is not on the shelf (read now): it is not counted here. */
  quarantine: number;
  reserved: number;
  /** False for a batch that is expired or not ACTIVE: counting more than expected there is refused at approval. */
  sellableHome: boolean;
  /** Only for a role with `cost.view`: the cost per costing unit, and that unit's size in base units. No computed value. */
  cost?: { unitCostMinor: string; currency: 'IQD' | 'USD'; perUnitLabel: string; perUnitBaseQty: number } | null;
}

export interface CountDetail extends CountSummary {
  reason: string;
  lines: CountLineView[];
}

/** One count with its lines. While it is blind and OPEN, expected quantities are not in the answer for anyone. */
export async function getCount(scoped: ScopedClient, ph: PhActor, countId: string): Promise<CountDetail> {
  const c = await scoped.phStockCount.findFirst({
    where: { id: countId },
    select: {
      ...SUMMARY_SELECT,
      reason: true,
      createdAt: true,
      lines: {
        orderBy: [{ product: { tradeName: 'asc' } }, { batchId: 'asc' }],
        select: {
          id: true,
          productId: true,
          batchId: true,
          expectedQty: true,
          countedQty: true,
          countedAt: true,
          product: { select: { tradeName: true } },
          batch: {
            select: { lot: true, status: true, expiryDate: true, expiryPrecision: true, unitCostMinor: true, costCurrency: true, costUnit: { select: { label: true, baseQty: true } } },
          },
        },
      },
    },
  });
  if (!c) throw notFound();
  const hidden = c.blind && c.status === 'OPEN';
  const withCost = mayViewCost(ph);
  const [moved, balances] = await Promise.all([
    hidden ? new Map<string, number>() : movedUntilCounted(scoped, c, c.lines.map((l) => ({ id: l.id, batchId: l.batchId, countedAt: l.countedAt }))),
    scoped.phStockBalance.findMany({
      where: { branchId: c.branchId, batchId: { in: c.lines.map((l) => l.batchId) } },
      select: { batchId: true, quarantine: true, reserved: true },
    }),
  ]);
  const offShelf = new Map(balances.map((b) => [b.batchId, b]));
  const today = utcToday();
  return {
    ...summaryOf({ ...c, _count: { lines: c.lines.length } } as SummaryRow),
    reason: c.reason,
    lines: c.lines.map((l) => ({
      lineId: l.id,
      productId: l.productId,
      productName: l.product.tradeName,
      batchId: l.batchId,
      lot: l.batch.lot,
      expiryDate: l.batch.expiryDate.toISOString().slice(0, 10),
      expiryPrecision: l.batch.expiryPrecision,
      countedQty: l.countedQty,
      quarantine: offShelf.get(l.batchId)?.quarantine ?? 0,
      reserved: offShelf.get(l.batchId)?.reserved ?? 0,
      sellableHome: l.batch.status === 'ACTIVE' && !isExpired({ expiryDate: l.batch.expiryDate.toISOString().slice(0, 10) }, today),
      ...(hidden ? {} : { expectedQty: l.expectedQty }),
      ...(!hidden && l.countedQty !== null
        ? {
            expectedAtCount: l.expectedQty + (moved.get(l.id) ?? 0),
            difference: l.countedQty - l.expectedQty - (moved.get(l.id) ?? 0),
          }
        : {}),
      ...(withCost
        ? {
            cost:
              l.batch.unitCostMinor !== null && l.batch.costCurrency !== null && l.batch.costUnit
                ? {
                    unitCostMinor: String(l.batch.unitCostMinor),
                    currency: l.batch.costCurrency,
                    perUnitLabel: l.batch.costUnit.label,
                    perUnitBaseQty: l.batch.costUnit.baseQty,
                  }
                : null,
          }
        : {}),
    })),
  };
}
