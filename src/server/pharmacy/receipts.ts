import { z } from 'zod';
import type { ScopedClient, ScopedTx } from '@/server/data/tenant-db';
import { parseExpiry, utcToday } from '@/server/domain/pharmacy/expiry';
import { mayViewCost } from '@/server/pharmacy/products';
import { toBase } from '@/server/domain/pharmacy/stock';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from './actor';
import { applyMovement, lockOrder } from './stock';

/**
 * Manual receiving (R2-1): a draft receipt of lines, confirmed once into batches, balances and RECEIPT movements. The
 * services take the transaction (or scoped client) of the action or query that calls them; the actions audit. The
 * receipt's business and branch come from the validated place, never from a line.
 */

export const MAX_RECEIPT_LINES = 200;
/** The largest `bigint` a Postgres BIGINT column holds. */
export const MAX_MINOR = 9_223_372_036_854_775_807n;
/** The largest whole quantity an `Int` column holds. */
const MAX_INT = 2_147_483_647;

const WHOLE = 'Enter a whole number';
const iso = (d: Date) => d.toISOString().slice(0, 10);
const midnight = (date: string) => new Date(`${date}T00:00:00.000Z`);

const dateText = z
  .string()
  .trim()
  .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && iso(midnight(v)) === v, 'Enter a date as YYYY-MM-DD');

export const receiptLineInput = z
  .object({
    productId: z.string().min(1).max(64),
    unitId: z.string().min(1).max(64),
    qty: z.number(WHOLE).int(WHOLE).min(1, 'Use 1 or more').max(1_000_000_000, 'Enter a smaller number'),
    bonusQty: z.number(WHOLE).int(WHOLE).min(0, 'Use 0 or more').max(1_000_000_000, 'Enter a smaller number').default(0),
    lot: z
      .string()
      .trim()
      .min(1, 'Enter the lot')
      .max(40, 'Use at most 40 characters')
      .transform((v) => v.toUpperCase()),
    expiry: z
      .string()
      .trim()
      .min(1, 'Enter the expiry')
      .refine((v) => parseExpiry(v) !== null, 'Enter the expiry as MM/YYYY or YYYY-MM-DD'),
    unitCostMinor: z.coerce.bigint('Enter the cost').min(0n, 'Use 0 or more').max(MAX_MINOR, 'Enter a smaller amount'),
    currency: z.enum(['IQD', 'USD'], 'Choose IQD or USD'),
    freeOfCharge: z.boolean().default(false),
    acceptExpired: z.boolean().default(false),
  })
  .superRefine((line, ctx) => {
    if (line.unitCostMinor === 0n && !line.freeOfCharge) {
      ctx.addIssue({ code: 'custom', path: ['unitCostMinor'], message: 'A zero cost needs “free of charge” confirmed' });
    }
  });
export type ReceiptLineInput = z.infer<typeof receiptLineInput>;

/** What a person enters for a draft; the pharmacy and branch come from the place. */
export const receiptInput = z.object({
  supplierName: z.string().trim().max(200, 'Use at most 200 characters').default(''),
  reference: z.string().trim().max(100, 'Use at most 100 characters').default(''),
  receivedOn: dateText,
  note: z.string().trim().max(1000, 'Use at most 1000 characters').default(''),
  lines: z.array(receiptLineInput).min(1, 'Add at least one line').max(MAX_RECEIPT_LINES, 'Use at most 200 lines'),
});
export type ReceiptInput = z.infer<typeof receiptInput>;

export const receiptListInput = z.object({
  status: z.enum(['DRAFT', 'CONFIRMED', 'VOID']).optional(),
  cursor: z.string().min(1).max(64).nullish(),
  pageSize: z.number(WHOLE).int(WHOLE).min(1, 'Use 1 or more').max(100, 'Enter a smaller number').default(50),
});

const invalid = (field: string, message: string, extra: Record<string, string> = {}) =>
  new StudioError('INVALID', message, { [field]: message, ...extra });

const notDraft = () => new StudioError('CONFLICT', 'Only a draft receipt can change', { phCode: 'NOT_DRAFT' });

// Lines ---------------------------------------------------------------------------------------------------------------

interface LineRow {
  restaurantId: string;
  receiptId: string;
  lineNo: number;
  productId: string;
  unitId: string;
  qty: number;
  bonusQty: number;
  baseQty: number;
  lot: string;
  expiryDate: Date;
  expiryPrecision: 'DAY' | 'MONTH';
  unitCostMinor: bigint;
  costCurrency: 'IQD' | 'USD';
  freeOfCharge: boolean;
  acceptExpired: boolean;
}

/**
 * The lines as rows, checked against the business's own catalog: each product is the business's, each unit is a unit of
 * that product (sellable or not), and the quantity in base units fits a whole number of the column's size.
 */
async function lineRows(tx: ScopedTx, restaurantId: string, receiptId: string, lines: ReceiptInput['lines']): Promise<LineRow[]> {
  const productIds = [...new Set(lines.map((l) => l.productId))];
  const [products, units] = await Promise.all([
    tx.phProduct.findMany({ where: { id: { in: productIds } }, select: { id: true, active: true } }),
    tx.phProductUnit.findMany({ where: { productId: { in: productIds } }, select: { id: true, productId: true, baseQty: true } }),
  ]);
  const known = new Set(products.filter((p) => p.active).map((p) => p.id));
  const unitById = new Map(units.map((u) => [u.id, u]));
  return lines.map((l, i) => {
    if (!known.has(l.productId)) throw invalid(`lines.${i}.productId`, 'Choose one of this pharmacy’s active products');
    const unit = unitById.get(l.unitId);
    if (!unit || unit.productId !== l.productId) throw invalid(`lines.${i}.unitId`, 'Choose one of this product’s units');
    let baseQty: number;
    try {
      baseQty = toBase(l.qty + l.bonusQty, unit.baseQty);
    } catch {
      throw invalid(`lines.${i}.qty`, 'Enter a smaller number');
    }
    if (baseQty > MAX_INT) throw invalid(`lines.${i}.qty`, 'Enter a smaller number');
    const expiry = parseExpiry(l.expiry);
    if (!expiry) throw invalid(`lines.${i}.expiry`, 'Enter the expiry as MM/YYYY or YYYY-MM-DD');
    return {
      restaurantId,
      receiptId,
      lineNo: i + 1,
      productId: l.productId,
      unitId: l.unitId,
      qty: l.qty,
      bonusQty: l.bonusQty,
      baseQty,
      lot: l.lot,
      expiryDate: midnight(expiry.date),
      expiryPrecision: expiry.precision,
      unitCostMinor: l.unitCostMinor,
      costCurrency: l.currency,
      freeOfCharge: l.freeOfCharge,
      acceptExpired: l.acceptExpired,
    };
  });
}

// Draft ---------------------------------------------------------------------------------------------------------------

export interface DraftResult {
  id: string;
  version: number;
  status: 'DRAFT';
  replayed: boolean;
  lineCount: number;
}

const REPLAY_SELECT = {
  id: true,
  version: true,
  status: true,
  branchId: true,
  supplierName: true,
  invoiceRef: true,
  receivedOn: true,
  note: true,
  lines: { orderBy: { lineNo: 'asc' } },
} as const;

const keyMismatch = () =>
  new StudioError('CONFLICT', 'This key was already used for a different receipt', { phCode: 'CLIENT_KEY_MISMATCH' });

type ReplayRow = {
  id: string;
  version: number;
  status: 'DRAFT' | 'CONFIRMED' | 'VOID';
  branchId: string;
  supplierName: string;
  invoiceRef: string;
  receivedOn: Date;
  note: string;
  lines: (LineRow & { id: string })[];
};

/**
 * A repeated `clientKey` returns its receipt only when it is the same request: same branch, header and lines. Nothing
 * is written. (The lines are validated again so a bad repeat is refused the same way as the first.)
 */
async function replayOf(
  tx: ScopedTx,
  existing: ReplayRow,
  args: { restaurantId: string; branchId: string; input: ReceiptInput },
): Promise<DraftResult> {
  const { input } = args;
  const rows = await lineRows(tx, args.restaurantId, existing.id, input.lines);
  const same =
    existing.branchId === args.branchId &&
    existing.supplierName === input.supplierName &&
    existing.invoiceRef === input.reference &&
    iso(existing.receivedOn) === input.receivedOn &&
    existing.note === input.note &&
    existing.lines.length === rows.length &&
    rows.every((r, i) => {
      const e = existing.lines[i]!;
      return (
        e.productId === r.productId &&
        e.unitId === r.unitId &&
        e.qty === r.qty &&
        e.bonusQty === r.bonusQty &&
        e.lot === r.lot &&
        e.expiryDate.getTime() === r.expiryDate.getTime() &&
        e.unitCostMinor === r.unitCostMinor &&
        e.costCurrency === r.costCurrency &&
        e.freeOfCharge === r.freeOfCharge &&
        e.acceptExpired === r.acceptExpired
      );
    });
  if (!same) throw keyMismatch();
  if (existing.status !== 'DRAFT') throw new StudioError('CONFLICT', 'This receipt was already processed', { phCode: 'NOT_DRAFT' });
  return { id: existing.id, version: existing.version, status: 'DRAFT', replayed: true, lineCount: existing.lines.length };
}

/**
 * A new draft in `branchId`, or the receipt the same `clientKey` already made (idempotent: a repeat changes nothing).
 * The caller has checked that `branchId` is one of the actor's branches.
 */
export async function createDraft(
  tx: ScopedTx,
  args: { restaurantId: string; branchId: string; clientKey: string; userId: string; input: ReceiptInput },
): Promise<DraftResult> {
  const existing = await tx.phReceipt.findFirst({ where: { clientKey: args.clientKey }, select: REPLAY_SELECT });
  if (existing) return replayOf(tx, existing as unknown as ReplayRow, args);
  const receipt = await tx.phReceipt.create({
    data: {
      restaurantId: args.restaurantId,
      branchId: args.branchId,
      clientKey: args.clientKey,
      supplierName: args.input.supplierName,
      invoiceRef: args.input.reference,
      receivedOn: midnight(args.input.receivedOn),
      note: args.input.note,
      createdById: args.userId,
    },
    select: { id: true, version: true },
  });
  const rows = await lineRows(tx, args.restaurantId, receipt.id, args.input.lines);
  await tx.phReceiptLine.createMany({ data: rows });
  return { id: receipt.id, version: receipt.version, status: 'DRAFT', replayed: false, lineCount: rows.length };
}

/** Replaces a draft's header and lines, if it is still a draft at `expectedVersion`. */
export async function updateDraft(
  tx: ScopedTx,
  args: { restaurantId: string; receiptId: string; expectedVersion: number; input: ReceiptInput },
): Promise<{ id: string; version: number; lineCount: number }> {
  const rows = await lineRows(tx, args.restaurantId, args.receiptId, args.input.lines);
  const won = await tx.phReceipt.updateMany({
    where: { id: args.receiptId, status: 'DRAFT', version: args.expectedVersion },
    data: {
      supplierName: args.input.supplierName,
      invoiceRef: args.input.reference,
      receivedOn: midnight(args.input.receivedOn),
      note: args.input.note,
      version: { increment: 1 },
    },
  });
  if (won.count !== 1) {
    const head = await tx.phReceipt.findFirst({ where: { id: args.receiptId }, select: { status: true } });
    if (!head) throw new StudioError('NOT_FOUND', 'Receipt not found');
    if (head.status !== 'DRAFT') throw notDraft();
    throw new StudioError('CONFLICT', 'Someone else changed this receipt: reload it');
  }
  await tx.phReceiptLine.deleteMany({ where: { receiptId: args.receiptId } });
  await tx.phReceiptLine.createMany({ data: rows });
  return { id: args.receiptId, version: args.expectedVersion + 1, lineCount: rows.length };
}

/** DRAFT to VOID only; a confirmed receipt is corrected by an adjustment. */
export async function voidDraft(tx: ScopedTx, receiptId: string): Promise<{ id: string; lineCount: number }> {
  const won = await tx.phReceipt.updateMany({
    where: { id: receiptId, status: 'DRAFT' },
    data: { status: 'VOID', voidedAt: new Date(), version: { increment: 1 } },
  });
  if (won.count !== 1) {
    const head = await tx.phReceipt.findFirst({ where: { id: receiptId }, select: { status: true } });
    if (!head) throw new StudioError('NOT_FOUND', 'Receipt not found');
    throw notDraft();
  }
  return { id: receiptId, lineCount: await tx.phReceiptLine.count({ where: { receiptId } }) };
}

// Confirm -------------------------------------------------------------------------------------------------------------

export interface ConfirmWarning {
  code: 'COST_DIFFERS';
  lineNo: number;
  batchId: string;
}

export interface ConfirmResult {
  id: string;
  status: 'CONFIRMED';
  number: string;
  version: number;
  branchId: string;
  warnings: ConfirmWarning[];
  lines: number;
  baseQty: number;
}

const numberOf = (n: number) => `R-${String(n).padStart(6, '0')}`;

/**
 * The batch of `(product, lot, expiry)` for the business, created on first use. The supplier is not part of a batch's
 * identity (`supplierName` records the first one). The unique index on that identity folds racing creations (another
 * branch or supplier confirming the same new lot): createMany skips the duplicate and the lookup finds the winner.
 */
async function findOrCreateBatch(
  tx: ScopedTx,
  restaurantId: string,
  line: { id: string; productId: string; lot: string; expiryDate: Date; expiryPrecision: 'DAY' | 'MONTH'; unitId: string; unitCostMinor: bigint | null; costCurrency: 'IQD' | 'USD' | null },
  supplierName: string,
) {
  const where = { productId: line.productId, lot: line.lot, expiryDate: line.expiryDate };
  const select = { id: true, unitCostMinor: true, costCurrency: true, costUnitId: true, status: true } as const;
  const found = await tx.phBatch.findFirst({ where, select, orderBy: { id: 'asc' } });
  if (found) return { batch: found, created: false };
  await tx.phBatch.createMany({
    data: [
      {
        restaurantId,
        productId: line.productId,
        lot: line.lot,
        expiryDate: line.expiryDate,
        expiryPrecision: line.expiryPrecision,
        supplierName,
        unitCostMinor: line.unitCostMinor,
        costCurrency: line.costCurrency,
        costUnitId: line.unitId,
        receiptLineId: line.id,
      },
    ],
    skipDuplicates: true,
  });
  const made = await tx.phBatch.findFirst({ where, select, orderBy: { id: 'asc' } });
  if (!made) throw new Error('A batch was created and cannot be found');
  return { batch: made, created: true };
}

/**
 * Confirms a draft in the caller's transaction. The branch's advisory lock serialises numbering and confirmation per
 * branch; the conditional DRAFT to CONFIRMED update is the guard that lets exactly one of two concurrent confirms win
 * (the other finds no DRAFT and gets CONFLICT). Per line: the batch is found or created by (product, lot, expiry) and
 * a RECEIPT movement adds the quantity (free units included) to `available`, then, for a line the person accepted
 * although expired, a second movement moves it to `quarantine`. Balances are taken in batch order.
 */
export async function confirmReceipt(
  tx: ScopedTx,
  args: { restaurantId: string; receiptId: string; userId: string; now?: Date },
): Promise<ConfirmResult> {
  const now = args.now ?? new Date();
  const head = await tx.phReceipt.findFirst({ where: { id: args.receiptId }, select: { branchId: true, supplierName: true } });
  if (!head) throw new StudioError('NOT_FOUND', 'Receipt not found');

  // eslint-disable-next-line no-restricted-properties -- an advisory lock touches no tenant rows: it only serialises one branch's receipts
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ph-receipt:${head.branchId}`}))`;
  const numbered = await tx.phReceipt.count({ where: { branchId: head.branchId, number: { not: null } } });
  const number = numberOf(numbered + 1);
  const won = await tx.phReceipt.updateMany({
    where: { id: args.receiptId, status: 'DRAFT' },
    data: { status: 'CONFIRMED', number, confirmedById: args.userId, confirmedAt: now, version: { increment: 1 } },
  });
  if (won.count !== 1) throw notDraft();

  const lines = await tx.phReceiptLine.findMany({ where: { receiptId: args.receiptId }, orderBy: { lineNo: 'asc' } });
  const today = utcToday(now);
  lines.forEach((l, i) => {
    if (iso(l.expiryDate) < today && !l.acceptExpired) {
      throw invalid(`lines.${i}.expiry`, 'This lot is already expired: remove it, or accept it into quarantine', { phCode: 'EXPIRED' });
    }
  });

  // The catalog may have changed since the draft: re-check each product and recompute the quantity from today's ladder.
  const productIds = [...new Set(lines.map((l) => l.productId))];
  const [products, units] = await Promise.all([
    tx.phProduct.findMany({ where: { id: { in: productIds } }, select: { id: true, active: true, tradeName: true } }),
    tx.phProductUnit.findMany({ where: { productId: { in: productIds } }, select: { id: true, productId: true, baseQty: true } }),
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));
  const unitById = new Map(units.map((u) => [u.id, u]));
  lines.forEach((l, i) => {
    const product = productById.get(l.productId);
    if (!product || !product.active) {
      throw invalid(`lines.${i}.productId`, 'This product was archived since the draft: remove the line', { phCode: 'PRODUCT_ARCHIVED' });
    }
    const unit = unitById.get(l.unitId);
    let current: number | null = null;
    try {
      current = unit && unit.productId === l.productId ? toBase(l.qty + l.bonusQty, unit.baseQty) : null;
    } catch {
      current = null;
    }
    if (current === null || current !== l.baseQty) {
      throw new StudioError('CONFLICT', `${product.tradeName}: its units changed since the draft; save the receipt again`, {
        phCode: 'LINE_STALE',
        [`lines.${i}.unitId`]: 'The unit changed since the draft',
      });
    }
  });

  const warnings: ConfirmWarning[] = [];
  const planned: { batchId: string; line: (typeof lines)[number]; quarantine: boolean }[] = [];
  for (const line of lines) {
    const { batch, created } = await findOrCreateBatch(tx, args.restaurantId, line, head.supplierName);
    // New stock never joins a recalled batch, nor a blocked one unless the line goes to quarantine (expired, accepted).
    if (!created && (batch.status === 'RECALLED' || (batch.status === 'BLOCKED' && iso(line.expiryDate) >= today))) {
      throw new StudioError(
        'CONFLICT',
        `${productById.get(line.productId)!.tradeName}, lot ${line.lot}: this batch is ${batch.status.toLowerCase()}, stock cannot be added to it`,
        { phCode: 'BATCH_NOT_ACTIVE' },
      );
    }
    const differs =
      !created &&
      batch.unitCostMinor !== null &&
      (batch.unitCostMinor !== line.unitCostMinor || batch.costCurrency !== line.costCurrency || batch.costUnitId !== line.unitId);
    if (differs) warnings.push({ code: 'COST_DIFFERS', lineNo: line.lineNo, batchId: batch.id });
    await tx.phReceiptLine.update({ where: { id: line.id }, data: { batchId: batch.id } });
    planned.push({ batchId: batch.id, line, quarantine: iso(line.expiryDate) < today });
  }

  for (const step of lockOrder(planned)) {
    const base = { restaurantId: args.restaurantId, branchId: head.branchId, batchId: step.batchId, userId: args.userId, receiptId: args.receiptId };
    // The ledger's rule: a RECEIPT adds to `available` only. An expired lot the person accepted is then moved to
    // quarantine by a second movement of the same receipt, so it is never sellable, not even for an instant.
    await applyMovement(tx, { ...base, type: 'RECEIPT', deltas: { available: step.line.baseQty }, reason: '' });
    if (step.quarantine) {
      await applyMovement(tx, {
        ...base,
        type: 'ADJUST',
        deltas: { available: -step.line.baseQty, quarantine: step.line.baseQty },
        reason: 'Expired lot accepted into quarantine on receipt',
      });
    }
  }

  const version = (await tx.phReceipt.findFirstOrThrow({ where: { id: args.receiptId }, select: { version: true } })).version;
  return {
    id: args.receiptId,
    status: 'CONFIRMED',
    number,
    version,
    branchId: head.branchId,
    warnings: warnings.sort((a, b) => a.lineNo - b.lineNo),
    lines: lines.length,
    baseQty: lines.reduce((sum, l) => sum + l.baseQty, 0),
  };
}

// Reads ---------------------------------------------------------------------------------------------------------------

/** A support actor reads no receipts (they hold stock and cost): only staff do. */
export function assertStaff(ph: PhActor): void {
  if (ph.support !== null || ph.role === null) throw new StudioError('FORBIDDEN');
}

export interface ReceiptSummary {
  id: string;
  number: string | null;
  status: 'DRAFT' | 'CONFIRMED' | 'VOID';
  branchId: string;
  supplierName: string;
  reference: string;
  receivedOn: string;
  lineCount: number;
  version: number;
  createdAt: string;
}

/** Newest first, by cursor. The scoped client keeps a branch-limited actor to their branches. */
export async function listReceipts(
  scoped: ScopedClient,
  input: z.infer<typeof receiptListInput> & { branchId?: string },
): Promise<{ items: ReceiptSummary[]; nextCursor: string | null }> {
  const rows = await scoped.phReceipt.findMany({
    where: { ...(input.status ? { status: input.status } : {}), ...(input.branchId ? { branchId: input.branchId } : {}) },
    select: {
      id: true,
      number: true,
      status: true,
      branchId: true,
      supplierName: true,
      invoiceRef: true,
      receivedOn: true,
      version: true,
      createdAt: true,
      _count: { select: { lines: true } },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: input.pageSize + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });
  const more = rows.length > input.pageSize;
  const page = more ? rows.slice(0, input.pageSize) : rows;
  return {
    items: page.map((r) => ({
      id: r.id,
      number: r.number,
      status: r.status,
      branchId: r.branchId,
      supplierName: r.supplierName,
      reference: r.invoiceRef,
      receivedOn: iso(r.receivedOn),
      lineCount: r._count.lines,
      version: r.version,
      createdAt: r.createdAt.toISOString(),
    })),
    nextCursor: more ? page[page.length - 1]!.id : null,
  };
}

export interface ReceiptLineView {
  lineNo: number;
  productId: string;
  productName: string;
  unitId: string;
  unitLabel: string;
  qty: number;
  bonusQty: number;
  baseQty: number;
  lot: string;
  expiryDate: string;
  expiryPrecision: 'DAY' | 'MONTH';
  freeOfCharge: boolean;
  acceptExpired: boolean;
  batchId: string | null;
  /** Present only for a role with `cost.view`. */
  unitCostMinor?: string | null;
  currency?: 'IQD' | 'USD' | null;
}

export interface ReceiptDetail extends ReceiptSummary {
  note: string;
  confirmedAt: string | null;
  lines: ReceiptLineView[];
}

/** One receipt with its lines; cost keys exist only for a role with `cost.view`. */
export async function getReceipt(scoped: ScopedClient, ph: PhActor, receiptId: string): Promise<ReceiptDetail> {
  const r = await scoped.phReceipt.findFirst({
    where: { id: receiptId },
    include: {
      lines: {
        orderBy: { lineNo: 'asc' },
        include: { product: { select: { tradeName: true } }, unit: { select: { label: true } } },
      },
    },
  });
  if (!r) throw new StudioError('NOT_FOUND', 'Receipt not found');
  const withCost = mayViewCost(ph);
  return {
    id: r.id,
    number: r.number,
    status: r.status,
    branchId: r.branchId,
    supplierName: r.supplierName,
    reference: r.invoiceRef,
    receivedOn: iso(r.receivedOn),
    lineCount: r.lines.length,
    version: r.version,
    createdAt: r.createdAt.toISOString(),
    note: r.note,
    confirmedAt: r.confirmedAt ? r.confirmedAt.toISOString() : null,
    lines: r.lines.map((l) => ({
      lineNo: l.lineNo,
      productId: l.productId,
      productName: l.product.tradeName,
      unitId: l.unitId,
      unitLabel: l.unit.label,
      qty: l.qty,
      bonusQty: l.bonusQty,
      baseQty: l.baseQty,
      lot: l.lot,
      expiryDate: iso(l.expiryDate),
      expiryPrecision: l.expiryPrecision,
      freeOfCharge: l.freeOfCharge,
      acceptExpired: l.acceptExpired,
      batchId: l.batchId,
      ...(withCost ? { unitCostMinor: l.unitCostMinor === null ? null : String(l.unitCostMinor), currency: l.costCurrency } : {}),
    })),
  };
}
