import { z } from 'zod';
import type { ScopedClient, ScopedTx } from '@/server/data/tenant-db';
import { canPh, PH_ROLES } from '@/server/domain/pharmacy/permissions';
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
    productWhere = { shelfLocation: { startsWith: scopeValue, mode: 'insensitive' } };
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
  const head = await tx.phStockCount.findFirst({ where: { id: args.countId }, select: { id: true } });
  if (!head) throw notFound();
  const ids = args.input.lines.map((l) => l.lineId);
  if (new Set(ids).size !== ids.length) throw invalid('lines', 'A line appears twice');
  const owned = await tx.phStockCountLine.findMany({ where: { countId: args.countId, id: { in: ids } }, select: { id: true } });
  if (owned.length !== ids.length) {
    const own = new Set(owned.map((l) => l.id));
    const at = ids.findIndex((id) => !own.has(id));
    throw invalid(`lines.${at}.lineId`, 'This line is not part of this count');
  }
  const won = await tx.phStockCount.updateMany({
    where: { id: args.countId, status: 'OPEN' },
    data: { countedById: args.userId, version: { increment: 1 } },
  });
  if (won.count !== 1) throw conflict('Only an open count can be changed', 'NOT_OPEN');
  const byQty = new Map<number, string[]>();
  for (const l of args.input.lines) byQty.set(l.countedQty, [...(byQty.get(l.countedQty) ?? []), l.lineId]);
  for (const [qty, lineIds] of byQty) {
    await tx.phStockCountLine.updateMany({ where: { countId: args.countId, id: { in: lineIds } }, data: { countedQty: qty } });
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

/** OPEN or SUBMITTED to CANCELLED. Nothing was applied to stock. */
export async function cancelCount(tx: ScopedTx, countId: string): Promise<{ id: string; status: 'CANCELLED'; from: 'OPEN' | 'SUBMITTED' }> {
  const head = await tx.phStockCount.findFirst({ where: { id: countId }, select: { status: true } });
  if (!head) throw notFound();
  const won = await tx.phStockCount.updateMany({
    where: { id: countId, status: { in: ['OPEN', 'SUBMITTED'] } },
    data: { status: 'CANCELLED', version: { increment: 1 } },
  });
  if (won.count !== 1) throw conflict('This count can no longer be cancelled', 'NOT_CANCELLABLE');
  return { id: countId, status: 'CANCELLED', from: head.status as 'OPEN' | 'SUBMITTED' };
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
  lineCount: number;
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
    select: { id: true, status: true, branchId: true, restaurantId: true, countedById: true },
  });
  if (!head) throw notFound();
  if (head.status !== 'SUBMITTED') throw conflict('Only a submitted count can be approved', 'NOT_SUBMITTED');

  const lines = await tx.phStockCountLine.findMany({
    where: { countId: args.countId, countedQty: { not: null } },
    select: {
      id: true,
      batchId: true,
      expectedQty: true,
      countedQty: true,
      product: { select: { tradeName: true } },
      batch: { select: { lot: true } },
    },
  });
  const diffs = lockOrder(lines.map((l) => ({ ...l, difference: l.countedQty! - l.expectedQty }))).filter((l) => l.difference !== 0);
  const reason = args.reason.trim();
  const selfApproved = head.countedById === args.userId;

  if (diffs.length > 0) {
    if (reason.length < 3 || reason.length > 300) throw invalid('reason', 'Enter the reason (3 to 300 characters)');
    if (selfApproved) {
      const approvers = await approversIn(tx, head.branchId);
      if (approvers.size > 1) {
        throw new StudioError('FORBIDDEN', 'Someone else must approve a count you made', { phCode: 'SELF_APPROVAL' });
      }
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
    lineCount: lines.length,
    netDifference: diffs.reduce((sum, l) => sum + l.difference, 0),
    differences: diffs.map((l) => ({ lineId: l.id, batchId: l.batchId, expected: l.expectedQty, counted: l.countedQty!, difference: l.difference })),
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
  countedQty: number | null;
  /** Absent (not null) while a blind count is OPEN. */
  expectedQty?: number;
  /** `countedQty - expectedQty`; absent while hidden or not counted. */
  difference?: number;
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
      lines: {
        orderBy: [{ product: { tradeName: 'asc' } }, { batchId: 'asc' }],
        select: {
          id: true,
          productId: true,
          batchId: true,
          expectedQty: true,
          countedQty: true,
          product: { select: { tradeName: true } },
          batch: {
            select: { lot: true, expiryDate: true, unitCostMinor: true, costCurrency: true, costUnit: { select: { label: true, baseQty: true } } },
          },
        },
      },
    },
  });
  if (!c) throw notFound();
  const hidden = c.blind && c.status === 'OPEN';
  const withCost = mayViewCost(ph);
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
      countedQty: l.countedQty,
      ...(hidden ? {} : { expectedQty: l.expectedQty }),
      ...(!hidden && l.countedQty !== null ? { difference: l.countedQty - l.expectedQty } : {}),
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
