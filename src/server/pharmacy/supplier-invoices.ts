import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ScopedClient, ScopedTx } from '@/server/data/tenant-db';
import { utcToday } from '@/server/domain/pharmacy/expiry';
import {
  costVariance,
  dueBand,
  dueDate as dueDateOf,
  invoiceableQty,
  invoiceFingerprint,
  invoiceInput,
  invoiceTotal,
  lineTotal,
  normalizeInvoiceNumber,
  PurchasingError,
  voidedKeys,
  type DueBand,
} from '@/server/domain/pharmacy/purchasing';
import { updateWithVersion } from '@/server/studio/framework/concurrency';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from './actor';
import { mayViewCost } from './products';
import { cleanText, NS_CLIENT_KEY, PAGE_SIZE } from './suppliers';

/**
 * Supplier invoices (R4-4, R4-4a, R4-4b, R4-5, R4-10, R4-11): a business-wide bill from one supplier in one currency, made of
 * lines that each cover part of a CONFIRMED receipt line of that supplier (any branch). This file is the only writer of
 * `PhSupplierInvoice`, `PhSupplierInvoiceLine` and `PhReceiptLine.invoicedQty`. The invoice cost never changes a batch's cost;
 * the variance is a query. The services take the transaction (or scoped client) of the action or query that calls them;
 * the actions audit.
 *
 * Lock order of this phase (header comment of every service that locks): client key (advisory, namespace 7201) -> PO row
 * FOR UPDATE -> receipt line counters FOR UPDATE -> invoice rows FOR UPDATE ordered by id -> stock rows (phase 2/3 order)
 * -> number lock (7202). `createInvoice` takes the client key, then the receipt lines it bills (ordered by id); the new
 * invoice row cannot be locked by anyone before it commits. `voidInvoice` takes the invoice row first and then its receipt
 * lines (ordered by id): the two never wait on each other in a circle, because a create holds no invoice row that exists.
 * The invoice and its lines are written in one transaction: the deferred database check that `total = sum(lines) +
 * adjustment` runs at COMMIT, and `asInvoiceError` turns its failure into `INVOICE_TOTAL_MISMATCH`.
 * Amendment to R4-11 (ruling of task 6 review): for an EXISTING invoice the invoice row is locked first, then its receipt
 * lines (void); create locks receipt lines and then inserts a NEW invoice (no existing invoice lock to cross). Later tasks
 * (payments, credits) lock the invoice row and refuse VOID under that lock; none may take receipt-line counters after it.
 *
 * Money: BigInt minor units in the invoice's currency. A receipt line that has a cost currency must be invoiced in it.
 * Branches (R4-12a): an invoice header, its totals and its list are business-wide for every `purchase.manage` holder. The
 * receipt-line DETAIL (receipt id and number, lot, expiry, receipt cost, order line) of a branch the actor lacks is redacted
 * (product, unit, quantity, invoiced cost and line total stay). Visibility is decided by the branch-scoped `phReceipt` read,
 * never by a nested include. A branch-limited actor bills only receipt lines of their own branches and cannot void an
 * invoice that has a line of a branch they lack (`INVOICE_OTHER_BRANCH`).
 */

const MAX_LINES = 200;
const MAX_MINOR = 9_223_372_036_854_775_807n;
const MAX_QTY = 1_000_000_000;
const WHOLE = 'Enter a whole number';
/** Statuses that still owe money: the only ones that can be overdue. */
const OWING = ['OPEN', 'PARTIAL'] as const;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const midnight = (date: string) => new Date(`${date}T00:00:00.000Z`);

const dateText = z
  .string()
  .trim()
  .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && iso(midnight(v)) === v, 'Enter a date as YYYY-MM-DD');

export const invoiceLineInput = z.object({
  receiptLineId: z.string().min(1).max(64),
  qtyInvoiced: z.number(WHOLE).int(WHOLE).min(1, 'Use 1 or more').max(MAX_QTY, 'Enter a smaller number'),
  unitCostMinor: z.coerce.bigint('Enter the cost').min(0n, 'Use 0 or more').max(MAX_MINOR, 'Enter a smaller amount'),
});
export type InvoiceLineInput = z.infer<typeof invoiceLineInput>;

/** What a person enters for an invoice. */
export const invoiceFields = z.object({
  supplierId: z.string().min(1).max(64),
  /** The supplier's own number as written; its comparable form is made by the domain. */
  number: z.string().transform(cleanText).pipe(z.string().min(1, 'Enter the invoice number').max(60, 'Use at most 60 characters')),
  invoiceDate: dateText,
  /** Defaults to the invoice date plus the supplier's terms. */
  dueDate: dateText.nullish(),
  currency: z.enum(['IQD', 'USD'], 'Choose IQD or USD'),
  /** Signed: freight adds, a discount subtracts. */
  adjustmentMinor: z.coerce.bigint('Enter an amount').min(-MAX_MINOR, 'Enter a smaller amount').max(MAX_MINOR, 'Enter a smaller amount').default(0n),
  adjustmentReason: z.string().transform(cleanText).pipe(z.string().max(200, 'Use at most 200 characters')).default(''),
  lines: z.array(invoiceLineInput).min(1, 'Add at least one line').max(MAX_LINES, 'Use at most 200 lines'),
});
export type InvoiceFields = z.infer<typeof invoiceFields>;

export const voidReason = z.string().transform(cleanText).pipe(z.string().min(3, 'Use at least 3 characters').max(300, 'Use at most 300 characters'));

export const invoiceListInput = z.object({
  supplierId: z.string().min(1).max(64).optional(),
  status: z.enum(['OPEN', 'PARTIAL', 'PAID', 'VOID']).optional(),
  /** Invoice dates, both ends included. */
  from: dateText.optional(),
  to: dateText.optional(),
  /** Only invoices that still owe money and are past their due date. */
  overdue: z.boolean().optional(),
  /** Matches inside the supplier's number as written. */
  search: z.string().trim().max(100, 'Use at most 100 characters').optional(),
  cursor: z.string().min(1).max(64).nullish(),
});
export type InvoiceListInput = z.infer<typeof invoiceListInput>;

const notFound = () => new StudioError('NOT_FOUND', 'Invoice not found');
const lineNotFound = () => new StudioError('NOT_FOUND', 'Receipt line not found');
const supplierNotFound = () => new StudioError('NOT_FOUND', 'Supplier not found');
const keyMismatch = () => new StudioError('CONFLICT', 'This key was already used for a different invoice', { phCode: 'CLIENT_KEY_MISMATCH' });
const archived = () => new StudioError('CONFLICT', 'This supplier is archived', { phCode: 'SUPPLIER_ARCHIVED' });
const invalid = (field: string, message: string, extra: Record<string, string> = {}) => new StudioError('INVALID', message, { [field]: message, ...extra });
const duplicateInvoice = (existingInvoiceId: string) =>
  new StudioError('CONFLICT', 'This invoice was already entered', { phCode: 'DUPLICATE_INVOICE', existingInvoiceId });
const notInvoiceable = () => new StudioError('CONFLICT', 'This receipt line cannot be invoiced by this supplier', { phCode: 'NOT_INVOICEABLE' });
const currencyMismatch = () => new StudioError('CONFLICT', 'The invoice currency differs from the cost currency of the goods', { phCode: 'CURRENCY_MISMATCH' });
const exceeds = () => new StudioError('CONFLICT', 'More is invoiced than was received', { phCode: 'INVOICE_EXCEEDS_RECEIVED' });
const alreadyVoid = () => new StudioError('CONFLICT', 'This invoice is already void', { phCode: 'ALREADY_VOID' });
const settled = () => new StudioError('CONFLICT', 'An invoice with a payment or a credit cannot be voided', { phCode: 'INVOICE_SETTLED' });
const otherBranch = () => new StudioError('FORBIDDEN', 'This invoice has lines from a branch you cannot use', { phCode: 'INVOICE_OTHER_BRANCH' });
const totalMismatch = () => new StudioError('CONFLICT', 'The invoice total does not match its lines', { phCode: 'INVOICE_TOTAL_MISMATCH' });

/**
 * The failure of the database's total check (raised when the transaction commits, SQLSTATE 23514 from the
 * `PhSupplierInvoice_total_identity` trigger) as a clean error. Anything else is returned as it came.
 */
export function asInvoiceError(error: unknown): unknown {
  if (error instanceof StudioError) return error;
  const e = error as { message?: unknown; code?: unknown; meta?: unknown; cause?: unknown } | null;
  const seen = [e?.message, e?.code, e?.meta !== undefined ? JSON.stringify(e.meta) : '', (e?.cause as { message?: unknown } | undefined)?.message];
  const text = seen.map((s) => (typeof s === 'string' ? s : '')).join(' ');
  return text.includes('PhSupplierInvoice_total_identity') ? totalMismatch() : error;
}

/** The hash a replayed `clientKey` is compared by: every field of the request, canonically ordered (a defaulted due date stays null). */
export function invoicePayloadHash(input: InvoiceFields): string {
  const canonical = JSON.stringify([
    input.supplierId,
    input.number,
    input.invoiceDate,
    input.dueDate ?? null,
    input.currency,
    input.adjustmentMinor.toString(),
    input.adjustmentReason,
    input.lines.map((l) => [l.receiptLineId, l.qtyInvoiced, l.unitCostMinor.toString()]),
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

// Create ---------------------------------------------------------------------------------------------------------------

export interface InvoiceCreated {
  id: string;
  version: number;
  status: 'OPEN' | 'PARTIAL' | 'PAID' | 'VOID';
  supplierId: string;
  currency: 'IQD' | 'USD';
  totalMinor: string;
  adjustmentMinor: string;
  dueDate: string;
  lineCount: number;
  replayed: boolean;
}

/** Runs a pure domain calculation and turns its refusal into a field error. */
function domain<T>(field: string, run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof PurchasingError) throw invalid(field, error.message);
    throw error;
  }
}

/** Which of these receipts the actor may use: the branch-scoped read keeps the others out. */
async function visibleReceiptIds(scoped: Pick<ScopedClient, 'phReceipt'>, receiptIds: readonly string[]): Promise<Set<string>> {
  if (receiptIds.length === 0) return new Set();
  const rows = await scoped.phReceipt.findMany({ where: { id: { in: [...new Set(receiptIds)] } }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}

/**
 * A new invoice, or the one the same `clientKey` already made (a repeat changes nothing, even after a void or a change of
 * the supplier's terms). A repeat must come from the same person with the same request: anything else is
 * `CLIENT_KEY_MISMATCH`. The caller's transaction must also commit the lines: the total check runs at its COMMIT.
 */
export async function createInvoice(
  tx: ScopedTx,
  args: { restaurantId: string; userId: string; clientKey: string; input: InvoiceFields },
): Promise<InvoiceCreated> {
  const { input } = args;
  const hash = invoicePayloadHash(input);
  // eslint-disable-next-line no-restricted-properties -- an advisory lock touches no tenant rows: it only serialises one client key
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NS_CLIENT_KEY}::int, hashtext(${`${args.restaurantId}:${args.clientKey}`}))`;
  const earlier = await tx.phSupplierInvoice.findFirst({ where: { clientKey: args.clientKey }, include: { _count: { select: { lines: true } } } });
  if (earlier) {
    if (earlier.createdById !== args.userId || earlier.payloadHash !== hash) throw keyMismatch();
    return {
      id: earlier.id,
      version: earlier.version,
      status: earlier.status,
      supplierId: earlier.supplierId,
      currency: earlier.currency,
      totalMinor: earlier.totalMinor.toString(),
      adjustmentMinor: earlier.adjustmentMinor.toString(),
      dueDate: iso(earlier.dueDate),
      lineCount: earlier._count.lines,
      replayed: true,
    };
  }

  if (input.dueDate && input.dueDate < input.invoiceDate) throw invalid('dueDate', 'The due date cannot be before the invoice date');
  const supplier = await tx.phSupplier.findFirst({ where: { id: input.supplierId }, select: { active: true, termsDays: true } });
  if (!supplier) throw supplierNotFound();
  if (!supplier.active) throw archived();

  const seen = new Set<string>();
  input.lines.forEach((l, i) => {
    if (seen.has(l.receiptLineId)) throw invalid(`lines.${i}.receiptLineId`, 'Each receipt line can be on an invoice once', { phCode: 'DUPLICATE_LINE' });
    seen.add(l.receiptLineId);
  });

  // The figures, from the domain alone.
  const numberKey = domain('number', () => normalizeInvoiceNumber(input.number));
  const adjustment = domain('adjustmentReason', () => invoiceInput({ adjustmentMinor: input.adjustmentMinor, adjustmentReason: input.adjustmentReason }));
  const lineTotals = input.lines.map((l, i) => domain(`lines.${i}.unitCostMinor`, () => lineTotal(l.qtyInvoiced, l.unitCostMinor)));
  const total = domain('adjustmentMinor', () => invoiceTotal(lineTotals, adjustment.adjustmentMinor));
  const due = input.dueDate ?? dueDateOf(input.invoiceDate, supplier.termsDays);
  const fingerprint = invoiceFingerprint({ supplierId: input.supplierId, number: input.number, date: input.invoiceDate, currency: input.currency, totalMinor: total });

  // The same supplier number (however it is spelled), or the same invoice by its fingerprint, is entered once.
  const findTwin = () =>
    tx.phSupplierInvoice.findFirst({ where: { OR: [{ supplierId: input.supplierId, number: numberKey }, { fingerprint }] }, select: { id: true } });
  const early = await findTwin();
  if (early) throw duplicateInvoice(early.id);

  // The receipt lines: all visible to this actor, then locked in id order, then read again under the lock.
  const lineIds = input.lines.map((l) => l.receiptLineId);
  const visible = await tx.phReceiptLine.findMany({ where: { id: { in: lineIds } }, select: { id: true, receiptId: true } });
  if (visible.length !== lineIds.length) throw lineNotFound();
  const receiptIds = [...new Set(visible.map((v) => v.receiptId))];
  const receipts = await tx.phReceipt.findMany({ where: { id: { in: receiptIds } }, select: { id: true, status: true, supplierId: true } });
  if (receipts.length !== receiptIds.length) throw lineNotFound();
  // eslint-disable-next-line no-restricted-properties -- row locks on the receipt lines to bill, in id order (R4-11), found above through the scoped client
  await tx.$queryRaw`SELECT "id" FROM "PhReceiptLine" WHERE "restaurantId" = ${args.restaurantId} AND "id" = ANY(${lineIds}) ORDER BY "id" COLLATE "C" FOR UPDATE`;
  const locked = await tx.phReceiptLine.findMany({ where: { id: { in: lineIds } }, select: { id: true, receiptId: true, qty: true, bonusQty: true, invoicedQty: true, costCurrency: true } });
  // Again, now that the lines are locked: a parallel entry of the same invoice (another key) may have committed while this waited,
  // and its use of the quantity must read as a duplicate, not as 'more than received'.
  const late = await findTwin();
  if (late) throw duplicateInvoice(late.id);
  const lockedBy = new Map(locked.map((l) => [l.id, l]));
  const receiptBy = new Map(receipts.map((r) => [r.id, r]));

  for (const l of input.lines) {
    const line = lockedBy.get(l.receiptLineId);
    const receipt = line ? receiptBy.get(line.receiptId) : undefined;
    if (!line || !receipt) throw lineNotFound();
    // R4-4b: only a confirmed receipt of this supplier (a legacy free-text supplier has no id) can be invoiced.
    if (receipt.status !== 'CONFIRMED' || receipt.supplierId !== input.supplierId) throw notInvoiceable();
    if (line.costCurrency !== null && line.costCurrency !== input.currency) throw currencyMismatch();
    if (l.qtyInvoiced > invoiceableQty(line)) throw exceeds();
  }

  const made = await tx.phSupplierInvoice.create({
    data: {
      restaurantId: args.restaurantId,
      supplierId: input.supplierId,
      number: numberKey,
      numberRaw: input.number,
      invoiceDate: midnight(input.invoiceDate),
      dueDate: midnight(due),
      currency: input.currency,
      adjustmentMinor: adjustment.adjustmentMinor,
      adjustmentReason: adjustment.adjustmentReason ?? '',
      totalMinor: total,
      fingerprint,
      clientKey: args.clientKey,
      payloadHash: hash,
      createdById: args.userId,
    },
    select: { id: true, version: true, status: true },
  });
  await tx.phSupplierInvoiceLine.createMany({
    data: input.lines.map((l, i) => ({
      restaurantId: args.restaurantId,
      invoiceId: made.id,
      lineNo: i + 1,
      receiptLineId: l.receiptLineId,
      qtyInvoiced: l.qtyInvoiced,
      unitCostMinor: l.unitCostMinor,
      lineTotalMinor: lineTotals[i]!,
    })),
  });
  // The counters, in id order, each moved only from the value read under the lock.
  for (const l of [...input.lines].sort((a, b) => (a.receiptLineId < b.receiptLineId ? -1 : a.receiptLineId > b.receiptLineId ? 1 : 0))) {
    const line = lockedBy.get(l.receiptLineId)!;
    const { count } = await tx.phReceiptLine.updateMany({
      where: { id: line.id, invoicedQty: line.invoicedQty },
      data: { invoicedQty: { increment: l.qtyInvoiced } },
    });
    if (count !== 1) throw exceeds();
  }
  return {
    id: made.id,
    version: made.version,
    status: made.status,
    supplierId: input.supplierId,
    currency: input.currency,
    totalMinor: total.toString(),
    adjustmentMinor: adjustment.adjustmentMinor.toString(),
    dueDate: due,
    lineCount: input.lines.length,
    replayed: false,
  };
}

// Void -----------------------------------------------------------------------------------------------------------------

export interface InvoiceVoided {
  id: string;
  version: number;
  status: 'VOID';
  before: { status: 'OPEN' | 'PARTIAL' | 'PAID' | 'VOID'; version: number };
  currency: 'IQD' | 'USD';
  totalMinor: string;
  lineCount: number;
}

/**
 * Voids an invoice that nothing has been paid or credited against: its invoiced quantities are released, its status is VOID
 * (with who, when and why), and its number and fingerprint are renamed (R4-4a) so the supplier's real number can be entered
 * again. The stored `numberRaw` stays. The invoice row is locked first, then its receipt lines in id order.
 */
export async function voidInvoice(tx: ScopedTx, args: { restaurantId: string; userId: string; invoiceId: string; expectedVersion: number; reason: string }): Promise<InvoiceVoided> {
  const visible = await tx.phSupplierInvoice.findFirst({ where: { id: args.invoiceId }, select: { id: true } });
  if (!visible) throw notFound();
  // The invoice's lines never change, so the branch rule can be read before the lock: every line's receipt must be one this actor may use.
  const billed = await tx.phSupplierInvoiceLine.findMany({ where: { invoiceId: args.invoiceId }, select: { receiptLine: { select: { receiptId: true } } } });
  const billedReceipts = billed.map((b) => b.receiptLine.receiptId);
  if ((await visibleReceiptIds(tx, billedReceipts)).size !== new Set(billedReceipts).size) throw otherBranch();
  // eslint-disable-next-line no-restricted-properties -- a row lock on one invoice, found above through the scoped client
  await tx.$queryRaw`SELECT "id" FROM "PhSupplierInvoice" WHERE "id" = ${args.invoiceId} AND "restaurantId" = ${args.restaurantId} FOR UPDATE`;
  const head = await tx.phSupplierInvoice.findFirst({
    where: { id: args.invoiceId },
    select: { id: true, version: true, status: true, number: true, fingerprint: true, paidMinor: true, creditedMinor: true, currency: true, totalMinor: true },
  });
  if (!head) throw notFound();
  // A stale version is CONFLICT with who changed it last; the lock is held, so it cannot win by luck.
  if (head.version !== args.expectedVersion) await updateWithVersion(tx.phSupplierInvoice, { id: head.id, version: args.expectedVersion, data: {}, entityType: 'PhSupplierInvoice' }, tx);
  if (head.status === 'VOID') throw alreadyVoid();
  if (head.paidMinor > 0n || head.creditedMinor > 0n) throw settled();

  const lines = await tx.phSupplierInvoiceLine.findMany({ where: { invoiceId: head.id }, select: { receiptLineId: true, qtyInvoiced: true } });
  const ids = lines.map((l) => l.receiptLineId);
  // eslint-disable-next-line no-restricted-properties -- row locks on the invoice's receipt lines, in id order (R4-11), after the invoice row
  await tx.$queryRaw`SELECT "id" FROM "PhReceiptLine" WHERE "restaurantId" = ${args.restaurantId} AND "id" = ANY(${ids}) ORDER BY "id" COLLATE "C" FOR UPDATE`;
  for (const l of lines) {
    const { count } = await tx.phReceiptLine.updateMany({ where: { id: l.receiptLineId, invoicedQty: { gte: l.qtyInvoiced } }, data: { invoicedQty: { decrement: l.qtyInvoiced } } });
    if (count !== 1) throw new StudioError('CONFLICT', 'The invoiced quantity of a receipt line is lower than this invoice', { phCode: 'COUNTER_DRIFT' });
  }
  const keys = voidedKeys(head.number, head.fingerprint, head.id);
  await updateWithVersion(
    tx.phSupplierInvoice,
    { id: head.id, version: head.version, data: { status: 'VOID', voidedAt: new Date(), voidedById: args.userId, voidReason: args.reason, number: keys.number, fingerprint: keys.fingerprint }, entityType: 'PhSupplierInvoice' },
    tx,
  );
  return { id: head.id, version: head.version + 1, status: 'VOID', before: { status: head.status, version: head.version }, currency: head.currency, totalMinor: head.totalMinor.toString(), lineCount: lines.length };
}

// Reading --------------------------------------------------------------------------------------------------------------

/** The supplier's number as entered: a voided invoice's stored number carries a suffix that is not for people. */
const shownNumber = (stored: string) => stored.split('#void-')[0]!;

export interface InvoiceSummary {
  id: string;
  number: string;
  numberRaw: string;
  supplierId: string;
  supplierName: string;
  status: 'OPEN' | 'PARTIAL' | 'PAID' | 'VOID';
  currency: 'IQD' | 'USD';
  invoiceDate: string;
  dueDate: string;
  /** Null for a settled or void invoice. */
  dueBand: DueBand | null;
  version: number;
  createdAt: string;
  /** Present only for a role with `cost.view`. */
  totalMinor?: string;
  paidMinor?: string;
  creditedMinor?: string;
  balanceMinor?: string;
}

interface SummaryRow {
  id: string;
  number: string;
  numberRaw: string;
  supplierId: string;
  supplier: { name: string };
  status: 'OPEN' | 'PARTIAL' | 'PAID' | 'VOID';
  currency: 'IQD' | 'USD';
  invoiceDate: Date;
  dueDate: Date;
  totalMinor: bigint;
  paidMinor: bigint;
  creditedMinor: bigint;
  version: number;
  createdAt: Date;
}

function summaryOf(r: SummaryRow, withCost: boolean, today: string): InvoiceSummary {
  const balance = r.totalMinor - r.paidMinor - r.creditedMinor;
  return {
    id: r.id,
    number: shownNumber(r.number),
    numberRaw: r.numberRaw,
    supplierId: r.supplierId,
    supplierName: r.supplier.name,
    status: r.status,
    currency: r.currency,
    invoiceDate: iso(r.invoiceDate),
    dueDate: iso(r.dueDate),
    dueBand: r.status === 'OPEN' || r.status === 'PARTIAL' ? dueBand(iso(r.dueDate), today) : null,
    version: r.version,
    createdAt: r.createdAt.toISOString(),
    ...(withCost ? { totalMinor: String(r.totalMinor), paidMinor: String(r.paidMinor), creditedMinor: String(r.creditedMinor), balanceMinor: String(r.status === 'VOID' ? 0n : balance) } : {}),
  };
}

/** The search as the comparable invoice number form (digits, case, spacing), when it has one. */
function normalisedSearch(search: string): { number: { contains: string } }[] {
  try {
    return [{ number: { contains: normalizeInvoiceNumber(search) } }];
  } catch {
    return [];
  }
}

/** One page of invoices, newest invoice date first, with balance (cost viewers only) and due band. */
export async function listInvoices(scoped: ScopedClient, ph: PhActor, input: InvoiceListInput): Promise<{ items: InvoiceSummary[]; nextCursor: string | null }> {
  const today = utcToday();
  const search = input.search ? cleanText(input.search) : '';
  const rows = await scoped.phSupplierInvoice.findMany({
    where: {
      AND: [
        input.supplierId ? { supplierId: input.supplierId } : {},
        input.status ? { status: input.status } : {},
        input.overdue ? { status: { in: [...OWING] }, dueDate: { lt: midnight(today) } } : {},
        input.from || input.to ? { invoiceDate: { ...(input.from ? { gte: midnight(input.from) } : {}), ...(input.to ? { lte: midnight(input.to) } : {}) } } : {},
        search ? { OR: [{ numberRaw: { contains: search, mode: 'insensitive' as const } }, ...normalisedSearch(search)] } : {},
      ],
    },
    include: { supplier: { select: { name: true } } },
    orderBy: [{ invoiceDate: 'desc' }, { id: 'desc' }],
    take: PAGE_SIZE + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });
  const more = rows.length > PAGE_SIZE;
  const page = more ? rows.slice(0, PAGE_SIZE) : rows;
  const withCost = mayViewCost(ph);
  return { items: page.map((r) => summaryOf(r, withCost, today)), nextCursor: more ? page[page.length - 1]!.id : null };
}

export interface InvoiceLineView {
  lineNo: number;
  /** Null when the receipt is of a branch the actor lacks (`redacted`). */
  receiptLineId: string | null;
  receiptId: string | null;
  receiptNumber: string | null;
  productId: string;
  productName: string;
  unitLabel: string;
  lot: string | null;
  expiry: string | null;
  qtyInvoiced: number;
  /** True when the receipt detail (receipt, lot, expiry) is withheld: the receipt is of a branch the actor lacks (R4-12a). */
  redacted: boolean;
  /** Present only for a role with `cost.view`. */
  unitCostMinor?: string;
  lineTotalMinor?: string;
}

export interface InvoiceDetail extends InvoiceSummary {
  adjustmentReason: string;
  voidedAt: string | null;
  voidReason: string;
  lines: InvoiceLineView[];
  /** Present only for a role with `cost.view`. */
  adjustmentMinor?: string;
}

/**
 * One invoice with its lines, their labels (product, unit, lot, expiry, receipt) and, for a cost viewer, the money. The
 * receipt detail of a branch the actor lacks is withheld; which receipts they may use is decided by the branch-scoped
 * receipt read, and the detail is then read for those lines only.
 */
export async function getInvoice(scoped: ScopedClient, ph: PhActor, invoiceId: string): Promise<InvoiceDetail> {
  const r = await scoped.phSupplierInvoice.findFirst({
    where: { id: invoiceId },
    include: {
      supplier: { select: { name: true } },
      lines: {
        orderBy: { lineNo: 'asc' },
        include: { receiptLine: { select: { receiptId: true, productId: true, product: { select: { tradeName: true } }, unit: { select: { label: true } } } } },
      },
    },
  });
  if (!r) throw notFound();
  const usable = await visibleReceiptIds(scoped, r.lines.map((l) => l.receiptLine.receiptId));
  const openIds = r.lines.filter((l) => usable.has(l.receiptLine.receiptId)).map((l) => l.receiptLineId);
  const detail = new Map(
    (openIds.length === 0
      ? []
      : await scoped.phReceiptLine.findMany({ where: { id: { in: openIds } }, select: { id: true, lot: true, expiryDate: true, receipt: { select: { number: true } } } })
    ).map((d) => [d.id, d]),
  );
  const withCost = mayViewCost(ph);
  return {
    ...summaryOf(r, withCost, utcToday()),
    adjustmentReason: r.adjustmentReason,
    voidedAt: r.voidedAt ? r.voidedAt.toISOString() : null,
    voidReason: r.voidReason,
    ...(withCost ? { adjustmentMinor: String(r.adjustmentMinor) } : {}),
    lines: r.lines.map((l) => {
      const d = detail.get(l.receiptLineId);
      return {
        lineNo: l.lineNo,
        receiptLineId: d ? l.receiptLineId : null,
        receiptId: d ? l.receiptLine.receiptId : null,
        receiptNumber: d ? d.receipt.number : null,
        productId: l.receiptLine.productId,
        productName: l.receiptLine.product.tradeName,
        unitLabel: l.receiptLine.unit.label,
        lot: d ? d.lot : null,
        expiry: d ? iso(d.expiryDate) : null,
        qtyInvoiced: l.qtyInvoiced,
        redacted: !d,
        ...(withCost ? { unitCostMinor: String(l.unitCostMinor), lineTotalMinor: String(l.lineTotalMinor) } : {}),
      };
    }),
  };
}

export interface VarianceLine {
  lineNo: number;
  productName: string;
  unitLabel: string;
  qtyInvoiced: number;
  /** True when the receipt (and so its cost and order line) is of a branch the actor lacks: only the invoiced cost is shown. */
  redacted: boolean;
  orderedUnitCostMinor: string | null;
  /** The currency of the order the line answers; the two order figures are null when it differs from the receipt's or the invoice's. */
  orderCurrency: 'IQD' | 'USD' | null;
  receivedUnitCostMinor: string | null;
  invoicedUnitCostMinor: string;
  /** Signed unit-cost differences (later minus earlier); null when a side is missing, withheld or in another currency. */
  orderVsReceived: string | null;
  receivedVsInvoiced: string | null;
  orderVsInvoiced: string | null;
}

export interface InvoiceVariance {
  invoiceId: string;
  currency: 'IQD' | 'USD';
  lines: VarianceLine[];
  /** What the invoice charges above (positive) and below (negative) the cost booked on receipt, per line quantity (lines the actor may see). */
  positiveMinor: string;
  negativeMinor: string;
  netMinor: string;
}

const text = (v: bigint | null | undefined) => (v === null || v === undefined ? null : v.toString());

/**
 * Per line: the order's unit cost (when the receipt line answers an order line), the cost booked on receipt, the invoiced
 * cost, and the three differences. A difference is null across currencies (no implicit conversion): the order figures need
 * the order currency to equal the receipt's / the invoice's. The totals add the received-versus-invoiced difference times
 * the invoiced quantity, split by sign, over the lines the actor may see. Money only: a role without `cost.view` is refused.
 */
export async function invoiceVariance(scoped: ScopedClient, ph: PhActor, invoiceId: string): Promise<InvoiceVariance> {
  const r = await scoped.phSupplierInvoice.findFirst({
    where: { id: invoiceId },
    include: {
      lines: {
        orderBy: { lineNo: 'asc' },
        include: { receiptLine: { select: { receiptId: true, product: { select: { tradeName: true } }, unit: { select: { label: true } } } } },
      },
    },
  });
  if (!r) throw notFound();
  if (!mayViewCost(ph)) throw new StudioError('FORBIDDEN');
  const usable = await visibleReceiptIds(scoped, r.lines.map((l) => l.receiptLine.receiptId));
  const openIds = r.lines.filter((l) => usable.has(l.receiptLine.receiptId)).map((l) => l.receiptLineId);
  const costs = new Map(
    (openIds.length === 0
      ? []
      : await scoped.phReceiptLine.findMany({
          where: { id: { in: openIds } },
          select: { id: true, unitCostMinor: true, costCurrency: true, purchaseOrderLine: { select: { unitCostMinor: true, purchaseOrder: { select: { currency: true } } } } },
        })
    ).map((c) => [c.id, c]),
  );
  let positive = 0n;
  let negative = 0n;
  const lines = r.lines.map((l): VarianceLine => {
    const base = { lineNo: l.lineNo, productName: l.receiptLine.product.tradeName, unitLabel: l.receiptLine.unit.label, qtyInvoiced: l.qtyInvoiced, invoicedUnitCostMinor: l.unitCostMinor.toString() };
    const c = costs.get(l.receiptLineId);
    if (!c) {
      return { ...base, redacted: true, orderedUnitCostMinor: null, orderCurrency: null, receivedUnitCostMinor: null, orderVsReceived: null, receivedVsInvoiced: null, orderVsInvoiced: null };
    }
    const ordered = c.purchaseOrderLine?.unitCostMinor;
    const orderCurrency = c.purchaseOrderLine?.purchaseOrder.currency ?? null;
    const received = c.unitCostMinor ?? undefined;
    const sameAsReceipt = orderCurrency !== null && c.costCurrency === orderCurrency;
    const sameAsInvoice = orderCurrency === r.currency;
    const toReceived = costVariance({ orderedUnitCost: sameAsReceipt ? ordered : undefined, receivedUnitCost: received, invoicedUnitCost: l.unitCostMinor });
    const toInvoiced = costVariance({ orderedUnitCost: sameAsInvoice ? ordered : undefined, invoicedUnitCost: l.unitCostMinor });
    if (toReceived.receivedVsInvoiced !== null) {
      const money = toReceived.receivedVsInvoiced * BigInt(l.qtyInvoiced);
      if (money > 0n) positive += money;
      else negative += money;
    }
    return {
      ...base,
      redacted: false,
      orderedUnitCostMinor: text(ordered),
      orderCurrency,
      receivedUnitCostMinor: text(received),
      orderVsReceived: text(toReceived.orderVsReceived),
      receivedVsInvoiced: text(toReceived.receivedVsInvoiced),
      orderVsInvoiced: text(toInvoiced.orderVsInvoiced),
    };
  });
  return { invoiceId: r.id, currency: r.currency, lines, positiveMinor: positive.toString(), negativeMinor: negative.toString(), netMinor: (positive + negative).toString() };
}

export interface InvoiceableLine {
  receiptLineId: string;
  receiptId: string;
  receiptNumber: string | null;
  receiptDate: string;
  productId: string;
  productName: string;
  unitLabel: string;
  lot: string;
  expiry: string;
  qty: number;
  bonusQty: number;
  invoicedQty: number;
  invoiceableQty: number;
  currency: 'IQD' | 'USD' | null;
  /** Present only for a role with `cost.view`. */
  unitCostMinor?: string;
}

/** At most this many receipt lines are offered at once; the oldest receipts first. */
export const INVOICEABLE_LIMIT = 200;

/** The confirmed receipt lines of one supplier with something left to invoice, for the entry screen. Only branches the actor may use, filtered before the limit. */
export async function listInvoiceable(scoped: ScopedClient, ph: PhActor, restaurantId: string, supplierId: string): Promise<{ items: InvoiceableLine[] }> {
  const supplier = await scoped.phSupplier.findFirst({ where: { id: supplierId }, select: { id: true } });
  if (!supplier) throw supplierNotFound();
  // The comparison of two columns is not expressible in a Prisma filter: find the ids in SQL (the actor's branches applied here, before the limit), read the rows through the scoped client.
  // eslint-disable-next-line no-restricted-properties -- a read of two columns of this business's own receipt lines (restaurantId bound); the rows are then read through the scoped client
  const ids = await scoped.$queryRaw<{ id: string }[]>`
    SELECT l."id" FROM "PhReceiptLine" l JOIN "PhReceipt" r ON r."id" = l."receiptId"
    WHERE l."restaurantId" = ${restaurantId} AND r."supplierId" = ${supplierId} AND r."status" = 'CONFIRMED' AND l."qty" + l."bonusQty" > l."invoicedQty"
      AND (${ph.allBranches}::boolean OR r."branchId" = ANY(${ph.branchIds}))
    ORDER BY r."receivedOn", r."id", l."lineNo" LIMIT ${INVOICEABLE_LIMIT}`;
  if (ids.length === 0) return { items: [] };
  const rows = await scoped.phReceiptLine.findMany({
    where: { id: { in: ids.map((i) => i.id) }, receipt: { status: 'CONFIRMED', supplierId } },
    include: {
      product: { select: { tradeName: true } },
      unit: { select: { label: true } },
      receipt: { select: { id: true, number: true, receivedOn: true } },
    },
  });
  const visible = await visibleReceiptIds(scoped, rows.map((r) => r.receiptId));
  const order = new Map(ids.map((i, n) => [i.id, n]));
  const withCost = mayViewCost(ph);
  return {
    items: rows
      .filter((l) => visible.has(l.receiptId))
      .sort((a, b) => order.get(a.id)! - order.get(b.id)!)
      .map((l) => ({
        receiptLineId: l.id,
        receiptId: l.receiptId,
        receiptNumber: l.receipt.number,
        receiptDate: iso(l.receipt.receivedOn),
        productId: l.productId,
        productName: l.product.tradeName,
        unitLabel: l.unit.label,
        lot: l.lot,
        expiry: iso(l.expiryDate),
        qty: l.qty,
        bonusQty: l.bonusQty,
        invoicedQty: l.invoicedQty,
        invoiceableQty: invoiceableQty(l),
        currency: l.costCurrency,
        ...(withCost && l.unitCostMinor !== null ? { unitCostMinor: l.unitCostMinor.toString() } : {}),
      })),
  };
}
