import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ScopedClient, ScopedTx } from '@/server/data/tenant-db';
import { utcToday } from '@/server/domain/pharmacy/expiry';
import { dueDate as addDays, PurchasingError, planAllocation, shownNumber, type Allocation } from '@/server/domain/pharmacy/purchasing';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from './actor';
import { bumpApplied, lockCreditNote } from './credit-notes';
import { mayViewCost } from './products';
import { invoiceVoid, lockInvoices, lockOpenInvoices, overAllocation, settleInvoice, type LockedInvoice } from './supplier-invoices';
import { cleanText, NS_CLIENT_KEY, PAGE_SIZE } from './suppliers';

/**
 * Supplier payments, their reversals and the application of credit notes (R4-5, R4-6, R4-7, R4-9a, R4-10, R4-11). This file
 * is the only writer of `PhSupplierPayment`, `PhSupplierPaymentAllocation` and `PhCreditAllocation`; the invoice counters
 * (`paidMinor`, `creditedMinor`, status) are moved only through `settleInvoice` of the invoices service, and a credit note's
 * `appliedMinor` only through `bumpApplied` of the credit notes service. The services take the transaction of the action
 * that calls them; the actions audit. Payments never touch the cashier drawer or a shift (R4-6).
 *
 * Lock order of this phase (header comment of every service that locks): client key (advisory, namespace 7201) -> PO row ->
 * receipt line counters -> credit note row -> invoice rows FOR UPDATE ordered by id -> stock rows -> number lock (7202).
 * A payment takes its client key and then the invoices it may settle (the named ones, or every open one of the supplier and
 * currency, always by id); a reversal takes the invoices of the payment it undoes; a credit application takes the note and
 * then its invoices. Voiding an invoice takes the invoice row first (task 6) and refuses under that lock when anything was
 * paid or credited, so a payment racing a void ends coherently: one of them wins, the other is refused. None of these take a
 * receipt line after an invoice row.
 *
 * A reversal (decision of task 7): the payment table's CHECK forbids a negative amount, so a reversal row carries the same
 * positive amount, supplier, currency and method as the payment it undoes, `reversesId` and `isReversal`, and stores NO
 * allocation rows of its own. Its effect on the invoices is the original's allocations taken away again; readers (the
 * payment list, the statement of task 9) treat the row as the opposite of the original. The reason is kept in `reference`.
 * A credit note can be on an invoice once (the table's unique key is note + invoice): a later application skips that invoice.
 */

const MAX_MINOR = 9_223_372_036_854_775_807n;
const MAX_ALLOCATIONS = 200;
const METHODS = ['CASH', 'TRANSFER_MANUAL', 'CHEQUE_MANUAL', 'CARD_MANUAL'] as const;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const midnight = (date: string) => new Date(`${date}T00:00:00.000Z`);
const byDue = (a: { dueDate: Date; id: string }, b: { dueDate: Date; id: string }) => a.dueDate.getTime() - b.dueDate.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const dateText = z
  .string()
  .trim()
  .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && iso(midnight(v)) === v, 'Enter a date as YYYY-MM-DD');

/** A payment date: a real day, not before 2000-01-01 (a typo such as 0026 is not a date money moved). */
const EARLIEST_PAID_ON = '2000-01-01';
const paidOnText = dateText.refine((v) => v >= EARLIEST_PAID_ON, 'The payment date cannot be before 2000-01-01');

const clientKey = z.string().trim().min(8, 'Use at least 8 characters').max(100, 'Use at most 100 characters');
const idText = z.string().min(1).max(64);
const amount = z.coerce.bigint('Enter an amount').min(1n, 'Use 1 or more').max(MAX_MINOR, 'Enter a smaller amount');
export const allocationInput = z.object({ invoiceId: idText, amountMinor: amount });
const allocations = z.array(allocationInput).min(1, 'Add at least one invoice').max(MAX_ALLOCATIONS, 'Use at most 200 invoices');

/** What a person enters for a payment; no `allocations` means: oldest due first. */
export const paymentFields = z.object({
  clientKey,
  supplierId: idText,
  currency: z.enum(['IQD', 'USD'], 'Choose IQD or USD'),
  method: z.enum(METHODS, 'Choose a payment method'),
  amountMinor: amount,
  paidOn: paidOnText,
  reference: z.string().transform(cleanText).pipe(z.string().max(100, 'Use at most 100 characters')).default(''),
  allocations: allocations.optional(),
});
export type PaymentFields = z.infer<typeof paymentFields>;

export const reverseFields = z.object({
  clientKey,
  paymentId: idText,
  reason: z.string().transform(cleanText).pipe(z.string().min(3, 'Use at least 3 characters').max(300, 'Use at most 300 characters')),
});
export type ReverseFields = z.infer<typeof reverseFields>;

export const applyCreditFields = z.object({ clientKey, creditNoteId: idText, allocations: allocations.optional() });
export type ApplyCreditFields = z.infer<typeof applyCreditFields>;

export const paymentListInput = z.object({
  supplierId: idText.optional(),
  /** Payment dates, both ends included. */
  from: dateText.optional(),
  to: dateText.optional(),
  /** Reversal rows are listed only when asked for. */
  includeReversals: z.boolean().optional(),
  cursor: z.string().min(1).max(64).nullish(),
});
export type PaymentListInput = z.infer<typeof paymentListInput>;

const invoiceNotFound = () => new StudioError('NOT_FOUND', 'Invoice not found');
const paymentNotFound = () => new StudioError('NOT_FOUND', 'Payment not found');
const creditNotFound = () => new StudioError('NOT_FOUND', 'Credit note not found');
const supplierNotFound = () => new StudioError('NOT_FOUND', 'Supplier not found');
const invalid = (field: string, message: string) => new StudioError('INVALID', message, { [field]: message });
const paymentKeyMismatch = () => new StudioError('CONFLICT', 'This key was already used for a different payment', { phCode: 'CLIENT_KEY_MISMATCH' });
const creditKeyMismatch = () => new StudioError('CONFLICT', 'This key was already used for a different credit application', { phCode: 'CLIENT_KEY_MISMATCH' });
const currencyMismatch = () => new StudioError('CONFLICT', 'The currency differs from the invoice currency', { phCode: 'CURRENCY_MISMATCH' });
const unallocated = () => new StudioError('CONFLICT', 'Part of the amount does not go to an invoice', { phCode: 'UNALLOCATED' });
const creditExceeded = () => new StudioError('CONFLICT', 'The amount is more than the credit that is left', { phCode: 'OVER_ALLOCATION' });
const alreadyReversed = () => new StudioError('CONFLICT', 'This payment was already reversed', { phCode: 'ALREADY_REVERSED' });
const alreadyReversal = () => new StudioError('CONFLICT', 'A reversal cannot be reversed', { phCode: 'ALREADY_REVERSAL' });
const nothingToApply = () => new StudioError('CONFLICT', 'There is nothing to apply the credit to', { phCode: 'NOTHING_TO_APPLY' });
const alreadyOnInvoice = () => new StudioError('CONFLICT', 'This credit note was already applied to this invoice', { phCode: 'CREDIT_ALREADY_ON_INVOICE' });

const hashOf = (parts: unknown[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
/** Explicit allocations hash by invoice id, so the same split sent in another order is the same request. */
const allocationParts = (list: readonly { invoiceId: string; amountMinor: bigint }[] | undefined) =>
  list ? [...list].sort((a, b) => (a.invoiceId < b.invoiceId ? -1 : a.invoiceId > b.invoiceId ? 1 : 0)).map((a) => [a.invoiceId, a.amountMinor.toString()]) : null;

/** The hash a replayed payment key is compared by: every field of the request (the automatic plan hashes as `null`). */
export function paymentPayloadHash(input: PaymentFields): string {
  return hashOf(['pay', input.supplierId, input.currency, input.method, input.amountMinor.toString(), input.paidOn, input.reference, allocationParts(input.allocations)]);
}
export function reversePayloadHash(input: ReverseFields): string {
  return hashOf(['reverse', input.paymentId, input.reason]);
}
export function creditPayloadHash(input: ApplyCreditFields): string {
  return hashOf(['credit', input.creditNoteId, allocationParts(input.allocations)]);
}

/** A refusal of the pure allocation maths as the clean error a person sees. */
function planned<T>(run: () => T, over: () => StudioError = overAllocation): T {
  try {
    return run();
  } catch (error) {
    if (!(error instanceof PurchasingError)) throw error;
    switch (error.code) {
      case 'UNALLOCATED':
        throw unallocated();
      case 'OVER_ALLOCATION':
        throw over();
      case 'UNKNOWN_INVOICE':
        throw invoiceNotFound();
      case 'DUPLICATE_INVOICE':
        throw invalid('allocations', 'Each invoice can be named once');
      default:
        throw invalid('amountMinor', error.message);
    }
  }
}

const balanceOf = (i: LockedInvoice) => (i.status === 'VOID' ? 0n : i.totalMinor - i.paidMinor - i.creditedMinor);
const planInputOf = (invoices: readonly LockedInvoice[]) => invoices.map((i) => ({ id: i.id, dueDate: i.dueDate, balanceMinor: balanceOf(i) }));
const sortedByDue = (plan: readonly Allocation[], invoices: readonly LockedInvoice[]): Allocation[] => {
  const by = new Map(invoices.map((i) => [i.id, i]));
  return [...plan].sort((a, b) => byDue(by.get(a.invoiceId)!, by.get(b.invoiceId)!));
};
const asView = (list: readonly Allocation[]) => list.map((a) => ({ invoiceId: a.invoiceId, amountMinor: a.amountMinor.toString() }));
const lockKey = (tx: ScopedTx, restaurantId: string, key: string) =>
  // eslint-disable-next-line no-restricted-properties -- an advisory lock touches no tenant rows: it only serialises one client key
  tx.$executeRaw`SELECT pg_advisory_xact_lock(${NS_CLIENT_KEY}::int, hashtext(${`${restaurantId}:${key}`}))`;

/** The named invoices, locked, and every one of them the supplier's, in the currency, and not void (checked under the lock). */
async function namedInvoices(
  tx: ScopedTx,
  args: { restaurantId: string; supplierId: string; currency: 'IQD' | 'USD'; allocations: readonly { invoiceId: string }[] },
): Promise<LockedInvoice[]> {
  const found = await lockInvoices(tx, { restaurantId: args.restaurantId, ids: args.allocations.map((a) => a.invoiceId) });
  const by = new Map(found.map((i) => [i.id, i]));
  for (const a of args.allocations) {
    // An invoice of another supplier reads as missing: it is not this supplier's to pay.
    const inv = by.get(a.invoiceId);
    if (!inv || inv.supplierId !== args.supplierId) throw invoiceNotFound();
    if (inv.currency !== args.currency) throw currencyMismatch();
    if (inv.status === 'VOID') throw invoiceVoid();
  }
  return found;
}

// Create ---------------------------------------------------------------------------------------------------------------

export interface PaymentCreated {
  id: string;
  supplierId: string;
  currency: 'IQD' | 'USD';
  method: (typeof METHODS)[number];
  amountMinor: string;
  paidOn: string;
  allocations: { invoiceId: string; amountMinor: string }[];
  replayed: boolean;
}

/** A stored payment's allocations as the create result lists them: by due date, then invoice id. */
async function storedAllocations(tx: ScopedTx, paymentId: string): Promise<{ invoiceId: string; amountMinor: string }[]> {
  const rows = await tx.phSupplierPaymentAllocation.findMany({ where: { paymentId }, select: { invoiceId: true, amountMinor: true, invoice: { select: { dueDate: true } } } });
  return rows
    .sort((a, b) => byDue({ dueDate: a.invoice.dueDate, id: a.invoiceId }, { dueDate: b.invoice.dueDate, id: b.invoiceId }))
    .map((r) => ({ invoiceId: r.invoiceId, amountMinor: r.amountMinor.toString() }));
}

/**
 * A new payment to a supplier, or the one the same `clientKey` already made. The amount must be placed in full on invoices
 * of this supplier in this currency, as told or oldest due first; nothing is placed on a void or settled invoice and no
 * invoice is paid beyond its balance, however many payments arrive at once (the invoices are locked in id order and the
 * counters move only through `settleInvoice`). An archived supplier can still be paid.
 */
export async function createPayment(tx: ScopedTx, args: { restaurantId: string; userId: string; clientKey: string; input: PaymentFields }): Promise<PaymentCreated> {
  const { input } = args;
  const hash = paymentPayloadHash(input);
  await lockKey(tx, args.restaurantId, args.clientKey);
  const earlier = await tx.phSupplierPayment.findFirst({ where: { clientKey: args.clientKey } });
  if (earlier) {
    if (earlier.createdById !== args.userId || earlier.payloadHash !== hash) throw paymentKeyMismatch();
    return {
      id: earlier.id,
      supplierId: earlier.supplierId,
      currency: earlier.currency,
      method: earlier.method,
      amountMinor: earlier.amountMinor.toString(),
      paidOn: iso(earlier.paidOn),
      allocations: await storedAllocations(tx, earlier.id),
      replayed: true,
    };
  }

  if (input.paidOn > addDays(utcToday(), 1)) throw invalid('paidOn', 'The payment date cannot be later than tomorrow');
  const supplier = await tx.phSupplier.findFirst({ where: { id: input.supplierId }, select: { id: true } });
  if (!supplier) throw supplierNotFound();

  const invoices = input.allocations
    ? await namedInvoices(tx, { restaurantId: args.restaurantId, supplierId: input.supplierId, currency: input.currency, allocations: input.allocations })
    : await lockOpenInvoices(tx, { restaurantId: args.restaurantId, supplierId: input.supplierId, currency: input.currency });
  const plan = sortedByDue(
    planned(() => planAllocation(input.amountMinor, planInputOf(invoices), input.allocations)),
    invoices,
  );

  const made = await tx.phSupplierPayment.create({
    data: {
      restaurantId: args.restaurantId,
      supplierId: input.supplierId,
      currency: input.currency,
      method: input.method,
      amountMinor: input.amountMinor,
      paidOn: midnight(input.paidOn),
      reference: input.reference,
      clientKey: args.clientKey,
      payloadHash: hash,
      createdById: args.userId,
    },
    select: { id: true },
  });
  await tx.phSupplierPaymentAllocation.createMany({
    data: plan.map((a) => ({ restaurantId: args.restaurantId, paymentId: made.id, invoiceId: a.invoiceId, supplierId: input.supplierId, currency: input.currency, amountMinor: a.amountMinor })),
  });
  for (const a of [...plan].sort((x, y) => (x.invoiceId < y.invoiceId ? -1 : x.invoiceId > y.invoiceId ? 1 : 0))) {
    await settleInvoice(tx, { invoiceId: a.invoiceId, paidDelta: a.amountMinor });
  }
  return { id: made.id, supplierId: input.supplierId, currency: input.currency, method: input.method, amountMinor: input.amountMinor.toString(), paidOn: input.paidOn, allocations: asView(plan), replayed: false };
}

// Reverse --------------------------------------------------------------------------------------------------------------

export interface PaymentReversed {
  id: string;
  reversesId: string;
  supplierId: string;
  currency: 'IQD' | 'USD';
  method: (typeof METHODS)[number];
  amountMinor: string;
  paidOn: string;
  /** What the reversal took off the invoices: the original's allocations. */
  allocations: { invoiceId: string; amountMinor: string }[];
  replayed: boolean;
}

/**
 * Undoes a payment once: a reversal row is added and each of the original's allocations is taken off its invoice again (the
 * statuses follow). A payment that is itself a reversal cannot be reversed. A mistake in a reversal is a new payment.
 */
export async function reversePayment(tx: ScopedTx, args: { restaurantId: string; userId: string; clientKey: string; input: ReverseFields }): Promise<PaymentReversed> {
  const { input } = args;
  const hash = reversePayloadHash(input);
  await lockKey(tx, args.restaurantId, args.clientKey);
  const view = async (row: { id: string; reversesId: string | null; supplierId: string; currency: 'IQD' | 'USD'; method: (typeof METHODS)[number]; amountMinor: bigint; paidOn: Date }, replayed: boolean): Promise<PaymentReversed> => ({
    id: row.id,
    reversesId: row.reversesId!,
    supplierId: row.supplierId,
    currency: row.currency,
    method: row.method,
    amountMinor: row.amountMinor.toString(),
    paidOn: iso(row.paidOn),
    allocations: await storedAllocations(tx, row.reversesId!),
    replayed,
  });
  const earlier = await tx.phSupplierPayment.findFirst({ where: { clientKey: args.clientKey } });
  if (earlier) {
    if (earlier.createdById !== args.userId || earlier.payloadHash !== hash || earlier.reversesId === null) throw paymentKeyMismatch();
    return view(earlier, true);
  }

  const original = await tx.phSupplierPayment.findFirst({ where: { id: input.paymentId }, include: { allocations: true } });
  if (!original) throw paymentNotFound();
  if (original.isReversal) throw alreadyReversal();
  // The invoices of the payment, locked in id order; a parallel reversal queues here and then finds the first one's row.
  await lockInvoices(tx, { restaurantId: args.restaurantId, ids: original.allocations.map((a) => a.invoiceId) });
  const twin = await tx.phSupplierPayment.findFirst({ where: { reversesId: original.id }, select: { id: true } });
  if (twin) throw alreadyReversed();

  const paidOn = utcToday();
  const made = await tx.phSupplierPayment.create({
    data: {
      restaurantId: args.restaurantId,
      supplierId: original.supplierId,
      currency: original.currency,
      method: original.method,
      amountMinor: original.amountMinor,
      paidOn: midnight(paidOn),
      reference: input.reason,
      clientKey: args.clientKey,
      payloadHash: hash,
      isReversal: true,
      reversesId: original.id,
      createdById: args.userId,
    },
    select: { id: true },
  });
  for (const a of [...original.allocations].sort((x, y) => (x.invoiceId < y.invoiceId ? -1 : x.invoiceId > y.invoiceId ? 1 : 0))) {
    await settleInvoice(tx, { invoiceId: a.invoiceId, paidDelta: -a.amountMinor });
  }
  return view({ id: made.id, reversesId: original.id, supplierId: original.supplierId, currency: original.currency, method: original.method, amountMinor: original.amountMinor, paidOn: midnight(paidOn) }, false);
}

// Credit ---------------------------------------------------------------------------------------------------------------

export interface CreditApplied {
  creditNoteId: string;
  supplierId: string;
  currency: 'IQD' | 'USD';
  /** What this application spent, what the note has spent in all, and what is left on it. */
  appliedNowMinor: string;
  appliedMinor: string;
  remainingMinor: string;
  allocations: { invoiceId: string; amountMinor: string }[];
  replayed: boolean;
}

/**
 * Spends a credit note on invoices of the same supplier and currency, as told or oldest due first. Unlike a payment, an
 * automatic application may leave part of the credit unspent (it stays on the note); named parts above what is left are
 * `OVER_ALLOCATION`. The note is locked first and then its invoices by id; the invoice's `creditedMinor` and the note's
 * `appliedMinor` move through the owning services.
 */
export async function applyCredit(tx: ScopedTx, args: { restaurantId: string; userId: string; clientKey: string; input: ApplyCreditFields }): Promise<CreditApplied> {
  const { input } = args;
  const hash = creditPayloadHash(input);
  await lockKey(tx, args.restaurantId, args.clientKey);
  const earlier = await tx.phCreditAllocation.findMany({ where: { clientKey: args.clientKey }, select: { creditNoteId: true, invoiceId: true, amountMinor: true, payloadHash: true, createdById: true, invoice: { select: { dueDate: true } } } });
  if (earlier.length > 0) {
    const first = earlier[0]!;
    if (first.createdById !== args.userId || first.payloadHash !== hash || first.creditNoteId !== input.creditNoteId) throw creditKeyMismatch();
    const note = await tx.phCreditNote.findFirst({ where: { id: first.creditNoteId }, select: { supplierId: true, currency: true, amountMinor: true, appliedMinor: true } });
    if (!note) throw creditNotFound();
    const list = earlier.sort((a, b) => byDue({ dueDate: a.invoice.dueDate, id: a.invoiceId }, { dueDate: b.invoice.dueDate, id: b.invoiceId }));
    const now = list.reduce((sum, r) => sum + r.amountMinor, 0n);
    return {
      creditNoteId: first.creditNoteId,
      supplierId: note.supplierId,
      currency: note.currency,
      appliedNowMinor: now.toString(),
      appliedMinor: note.appliedMinor.toString(),
      remainingMinor: (note.amountMinor - note.appliedMinor).toString(),
      allocations: list.map((r) => ({ invoiceId: r.invoiceId, amountMinor: r.amountMinor.toString() })),
      replayed: true,
    };
  }

  const note = await lockCreditNote(tx, { restaurantId: args.restaurantId, creditNoteId: input.creditNoteId });
  if (!note) throw creditNotFound();
  const available = note.amountMinor - note.appliedMinor;
  // One allocation row per note and invoice (the table's unique key): an invoice the note is already on is not offered again.
  const used = new Set((await tx.phCreditAllocation.findMany({ where: { creditNoteId: note.id }, select: { invoiceId: true } })).map((r) => r.invoiceId));

  let invoices: LockedInvoice[];
  let plan: Allocation[];
  if (input.allocations) {
    invoices = await namedInvoices(tx, { restaurantId: args.restaurantId, supplierId: note.supplierId, currency: note.currency, allocations: input.allocations });
    if (input.allocations.some((a) => used.has(a.invoiceId))) throw alreadyOnInvoice();
    const total = input.allocations.reduce((sum, a) => sum + a.amountMinor, 0n);
    if (total > available) throw creditExceeded();
    plan = planned(() => planAllocation(total, planInputOf(invoices), input.allocations));
  } else {
    invoices = (await lockOpenInvoices(tx, { restaurantId: args.restaurantId, supplierId: note.supplierId, currency: note.currency })).filter((i) => !used.has(i.id));
    const open = invoices.reduce((sum, i) => sum + balanceOf(i), 0n);
    const spend = available < open ? available : open;
    if (spend <= 0n) throw nothingToApply();
    plan = planned(() => planAllocation(spend, planInputOf(invoices)));
  }
  plan = sortedByDue(plan, invoices);

  const spent = plan.reduce((sum, a) => sum + a.amountMinor, 0n);
  await tx.phCreditAllocation.createMany({
    data: plan.map((a) => ({
      restaurantId: args.restaurantId,
      creditNoteId: note.id,
      invoiceId: a.invoiceId,
      supplierId: note.supplierId,
      currency: note.currency,
      amountMinor: a.amountMinor,
      clientKey: args.clientKey,
      payloadHash: hash,
      createdById: args.userId,
    })),
  });
  for (const a of [...plan].sort((x, y) => (x.invoiceId < y.invoiceId ? -1 : x.invoiceId > y.invoiceId ? 1 : 0))) {
    await settleInvoice(tx, { invoiceId: a.invoiceId, creditedDelta: a.amountMinor });
  }
  const applied = await bumpApplied(tx, note.id, spent);
  return {
    creditNoteId: note.id,
    supplierId: note.supplierId,
    currency: note.currency,
    appliedNowMinor: spent.toString(),
    appliedMinor: applied.toString(),
    remainingMinor: (note.amountMinor - applied).toString(),
    allocations: asView(plan),
    replayed: false,
  };
}

// Reading --------------------------------------------------------------------------------------------------------------

export interface PaymentSummary {
  id: string;
  supplierId: string;
  supplierName: string;
  currency: 'IQD' | 'USD';
  method: (typeof METHODS)[number];
  paidOn: string;
  /** For a reversal, the reason given. */
  reference: string;
  isReversal: boolean;
  reversesId: string | null;
  /** True when a reversal of this payment exists. */
  reversed: boolean;
  createdAt: string;
  /** Present only for a role with `cost.view`. */
  amountMinor?: string;
}

interface PaymentRow {
  id: string;
  supplierId: string;
  supplier: { name: string };
  currency: 'IQD' | 'USD';
  method: (typeof METHODS)[number];
  paidOn: Date;
  reference: string;
  isReversal: boolean;
  reversesId: string | null;
  amountMinor: bigint;
  createdAt: Date;
}

function summaryOf(r: PaymentRow, reversed: boolean, withCost: boolean): PaymentSummary {
  return {
    id: r.id,
    supplierId: r.supplierId,
    supplierName: r.supplier.name,
    currency: r.currency,
    method: r.method,
    paidOn: iso(r.paidOn),
    reference: r.reference,
    isReversal: r.isReversal,
    reversesId: r.reversesId,
    reversed,
    createdAt: r.createdAt.toISOString(),
    ...(withCost ? { amountMinor: r.amountMinor.toString() } : {}),
  };
}

/** One page of payments, newest payment date first; reversal rows only when asked for. */
export async function listPayments(scoped: ScopedClient, ph: PhActor, input: PaymentListInput): Promise<{ items: PaymentSummary[]; nextCursor: string | null }> {
  const rows = await scoped.phSupplierPayment.findMany({
    where: {
      AND: [
        input.supplierId ? { supplierId: input.supplierId } : {},
        input.includeReversals ? {} : { isReversal: false },
        input.from || input.to ? { paidOn: { ...(input.from ? { gte: midnight(input.from) } : {}), ...(input.to ? { lte: midnight(input.to) } : {}) } } : {},
      ],
    },
    include: { supplier: { select: { name: true } } },
    orderBy: [{ paidOn: 'desc' }, { id: 'desc' }],
    take: PAGE_SIZE + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });
  const more = rows.length > PAGE_SIZE;
  const page = more ? rows.slice(0, PAGE_SIZE) : rows;
  const reversals = page.length === 0 ? [] : await scoped.phSupplierPayment.findMany({ where: { reversesId: { in: page.map((p) => p.id) } }, select: { reversesId: true } });
  const reversed = new Set(reversals.map((r) => r.reversesId));
  const withCost = mayViewCost(ph);
  return { items: page.map((r) => summaryOf(r, reversed.has(r.id), withCost)), nextCursor: more ? page[page.length - 1]!.id : null };
}

export interface PaymentDetail extends PaymentSummary {
  /** The reversal that undid this payment, if any. */
  reversedById: string | null;
  /** For a reversal: the allocations of the payment it undid. */
  allocations: { invoiceId: string; invoiceNumber: string; amountMinor?: string }[];
}

/** One payment with its allocations and the invoice numbers; a reversal lists the allocations it took away. */
export async function getPayment(scoped: ScopedClient, ph: PhActor, paymentId: string): Promise<PaymentDetail> {
  const r = await scoped.phSupplierPayment.findFirst({ where: { id: paymentId }, include: { supplier: { select: { name: true } } } });
  if (!r) throw paymentNotFound();
  const twin = await scoped.phSupplierPayment.findFirst({ where: { reversesId: r.id }, select: { id: true } });
  const rows = await scoped.phSupplierPaymentAllocation.findMany({
    where: { paymentId: r.reversesId ?? r.id },
    select: { invoiceId: true, amountMinor: true, invoice: { select: { number: true, dueDate: true } } },
  });
  const withCost = mayViewCost(ph);
  return {
    ...summaryOf(r, twin !== null, withCost),
    reversedById: twin?.id ?? null,
    allocations: rows
      .sort((a, b) => byDue({ dueDate: a.invoice.dueDate, id: a.invoiceId }, { dueDate: b.invoice.dueDate, id: b.invoiceId }))
      .map((a) => ({ invoiceId: a.invoiceId, invoiceNumber: shownNumber(a.invoice.number), ...(withCost ? { amountMinor: a.amountMinor.toString() } : {}) })),
  };
}
