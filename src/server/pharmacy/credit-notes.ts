import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ScopedClient, ScopedTx } from '@/server/data/tenant-db';
import { utcToday } from '@/server/domain/pharmacy/expiry';
import { dueDate as addDays, normalizeInvoiceNumber, PurchasingError } from '@/server/domain/pharmacy/purchasing';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from './actor';
import { mayViewCost } from './products';
import { cleanText, NS_CLIENT_KEY, PAGE_SIZE } from './suppliers';

/**
 * Supplier credit notes (R4-7, R4-9a, R4-10). A note is the supplier's own document, recorded when they agree to credit a
 * return or a price: supplier, currency, the supplier's number (normalised, unique per supplier), amount and date, and
 * optionally the supplier return it answers. This file is the only writer of `PhCreditNote`: it creates a note, and moves its
 * `appliedMinor` counter for the payments service (`lockCreditNote`, `bumpApplied`). A note is business-wide (restaurantId
 * only); the supplier return it may point to is branch-scoped, so a branch-limited actor can link only to returns of their
 * own branches. An archived supplier's credit still arrives, so it can be recorded. No refund in cash is built: a note
 * offsets invoices only.
 *
 * Lock order of this phase (R4-11, header comment of every service that locks): client key (advisory, namespace 7201) -> PO
 * row -> receipt line counters -> credit note row -> invoice rows ordered by id -> stock rows -> number lock (7202). Recording
 * takes only its client key and inserts a new row; applying a credit note takes the note first and then the invoices it spends
 * on, so two applications of one note queue on the note.
 */

const MAX_MINOR = 9_223_372_036_854_775_807n;
const idText = z.string().min(1).max(64);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const midnight = (date: string) => new Date(`${date}T00:00:00.000Z`);

const dateText = z
  .string()
  .trim()
  .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && iso(midnight(v)) === v, 'Enter a date as YYYY-MM-DD');

/** What a person enters for a credit note. */
export const creditFields = z.object({
  clientKey: z.string().trim().min(8, 'Use at least 8 characters').max(100, 'Use at most 100 characters'),
  supplierId: idText,
  number: z.string().trim().min(1, 'Enter the credit note number').max(60, 'Use at most 60 characters'),
  currency: z.enum(['IQD', 'USD'], 'Choose IQD or USD'),
  amountMinor: z.coerce.bigint('Enter an amount').min(1n, 'Use 1 or more').max(MAX_MINOR, 'Enter a smaller amount'),
  noteDate: dateText,
  supplierReturnId: idText.optional(),
  note: z.string().transform(cleanText).pipe(z.string().max(300, 'Use at most 300 characters')).default(''),
});
export type CreditFields = z.infer<typeof creditFields>;

export const creditListInput = z.object({
  supplierId: idText.optional(),
  /** Only notes with something left to apply. */
  openOnly: z.boolean().optional(),
  cursor: z.string().min(1).max(64).nullish(),
});
export type CreditListInput = z.infer<typeof creditListInput>;

const notFound = () => new StudioError('NOT_FOUND', 'Credit note not found');
const supplierNotFound = () => new StudioError('NOT_FOUND', 'Supplier not found');
const returnNotFound = () => new StudioError('NOT_FOUND', 'Supplier return not found');
const keyMismatch = () => new StudioError('CONFLICT', 'This key was already used for a different credit note', { phCode: 'CLIENT_KEY_MISMATCH' });
const supplierMismatch = () => new StudioError('CONFLICT', 'This return belongs to another supplier', { phCode: 'SUPPLIER_MISMATCH' });
const duplicateNote = (existingCreditNoteId: string) =>
  new StudioError('CONFLICT', 'This credit note was already entered', { phCode: 'DUPLICATE_CREDIT_NOTE', existingCreditNoteId });
const invalid = (field: string, message: string) => new StudioError('INVALID', message, { [field]: message });

/** The note's number as it is kept: the invoice-number normalisation (invisible marks out, Arabic digits to ASCII, upper case, spaces collapsed). */
function normalized(raw: string): string {
  try {
    return normalizeInvoiceNumber(raw);
  } catch (error) {
    if (error instanceof PurchasingError) throw invalid('number', 'Enter the credit note number');
    throw error;
  }
}

/** The hash a replayed key is compared by: every field of the request, the number in its normalised form. */
export function creditPayloadHash(number: string, input: CreditFields): string {
  return createHash('sha256')
    .update(JSON.stringify(['credit', input.supplierId, number, input.currency, input.amountMinor.toString(), input.noteDate, input.supplierReturnId ?? null, input.note]))
    .digest('hex');
}

export interface CreditRecorded {
  id: string;
  number: string;
  supplierId: string;
  currency: 'IQD' | 'USD';
  amountMinor: string;
  appliedMinor: string;
  availableMinor: string;
  noteDate: string;
  supplierReturnId: string | null;
  replayed: boolean;
}

interface NoteRow {
  id: string;
  number: string;
  supplierId: string;
  currency: 'IQD' | 'USD';
  amountMinor: bigint;
  appliedMinor: bigint;
  noteDate: Date;
  supplierReturnId: string | null;
}

const recorded = (r: NoteRow, replayed: boolean): CreditRecorded => ({
  id: r.id,
  number: r.number,
  supplierId: r.supplierId,
  currency: r.currency,
  amountMinor: r.amountMinor.toString(),
  appliedMinor: r.appliedMinor.toString(),
  availableMinor: (r.amountMinor - r.appliedMinor).toString(),
  noteDate: iso(r.noteDate),
  supplierReturnId: r.supplierReturnId,
  replayed,
});

const noteSelect = { id: true, number: true, supplierId: true, currency: true, amountMinor: true, appliedMinor: true, noteDate: true, supplierReturnId: true } as const;

/**
 * A new credit note, or the one the same `clientKey` already made (a repeat must come from the same person with the same
 * payload: anything else is `CLIENT_KEY_MISMATCH`). The supplier's number may be used once per supplier, however it is
 * spaced or written (`DUPLICATE_CREDIT_NOTE` names the note that has it). A linked return must be the business's, seen by the
 * actor, and the same supplier's.
 */
export async function recordCreditNote(tx: ScopedTx, args: { restaurantId: string; userId: string; clientKey: string; input: CreditFields }): Promise<CreditRecorded> {
  const { input } = args;
  const number = normalized(input.number);
  const hash = creditPayloadHash(number, input);
  // eslint-disable-next-line no-restricted-properties -- an advisory lock touches no tenant rows: it only serialises one client key
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NS_CLIENT_KEY}::int, hashtext(${`${args.restaurantId}:${args.clientKey}`}))`;
  const earlier = await tx.phCreditNote.findFirst({ where: { clientKey: args.clientKey }, select: { ...noteSelect, createdById: true, payloadHash: true } });
  if (earlier) {
    if (earlier.createdById !== args.userId || earlier.payloadHash !== hash) throw keyMismatch();
    return recorded(earlier, true);
  }

  if (input.noteDate > addDays(utcToday(), 1)) throw invalid('noteDate', 'The credit note date cannot be later than tomorrow');
  const supplier = await tx.phSupplier.findFirst({ where: { id: input.supplierId }, select: { id: true } });
  if (!supplier) throw supplierNotFound();
  if (input.supplierReturnId) {
    const ret = await tx.phSupplierReturn.findFirst({ where: { id: input.supplierReturnId }, select: { supplierId: true } });
    if (!ret) throw returnNotFound();
    if (ret.supplierId !== input.supplierId) throw supplierMismatch();
  }
  const same = await tx.phCreditNote.findFirst({ where: { supplierId: input.supplierId, number }, select: { id: true } });
  if (same) throw duplicateNote(same.id);

  const made = await tx.phCreditNote.create({
    data: {
      restaurantId: args.restaurantId,
      supplierId: input.supplierId,
      number,
      currency: input.currency,
      amountMinor: input.amountMinor,
      noteDate: midnight(input.noteDate),
      supplierReturnId: input.supplierReturnId ?? null,
      note: input.note,
      clientKey: args.clientKey,
      payloadHash: hash,
      createdById: args.userId,
    },
    select: noteSelect,
  });
  return recorded(made, false);
}

// Read -----------------------------------------------------------------------------------------------------------------

export interface CreditSummary {
  id: string;
  number: string;
  supplierId: string;
  supplierName: string;
  currency: 'IQD' | 'USD';
  noteDate: string;
  supplierReturnId: string | null;
  createdAt: string;
  amountMinor?: string;
  appliedMinor?: string;
  availableMinor?: string;
}

interface SummaryRow {
  id: string;
  number: string;
  supplierId: string;
  supplier: { name: string };
  currency: 'IQD' | 'USD';
  noteDate: Date;
  supplierReturnId: string | null;
  createdAt: Date;
  amountMinor: bigint;
  appliedMinor: bigint;
}

const summaryOf = (r: SummaryRow, withCost: boolean): CreditSummary => ({
  id: r.id,
  number: r.number,
  supplierId: r.supplierId,
  supplierName: r.supplier.name,
  currency: r.currency,
  noteDate: iso(r.noteDate),
  supplierReturnId: r.supplierReturnId,
  createdAt: r.createdAt.toISOString(),
  ...(withCost ? { amountMinor: r.amountMinor.toString(), appliedMinor: r.appliedMinor.toString(), availableMinor: (r.amountMinor - r.appliedMinor).toString() } : {}),
});

/** One page of notes, newest first; `openOnly` keeps those with something left. Money only with `cost.view`. */
export async function listCreditNotes(scoped: ScopedClient, ph: PhActor, input: CreditListInput): Promise<{ items: CreditSummary[]; nextCursor: string | null }> {
  const withCost = mayViewCost(ph);
  // `openOnly` compares two columns, which the query language cannot express: read pages and keep the open notes until a
  // full page and one more are found, so a page is full whenever more exist.
  const matches: SummaryRow[] = [];
  let cursor = input.cursor ?? null;
  let exhausted = false;
  while (matches.length <= PAGE_SIZE && !exhausted) {
    const rows: SummaryRow[] = await scoped.phCreditNote.findMany({
      where: input.supplierId ? { supplierId: input.supplierId } : {},
      include: { supplier: { select: { name: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PAGE_SIZE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    exhausted = rows.length <= PAGE_SIZE;
    const page = exhausted ? rows : rows.slice(0, PAGE_SIZE);
    for (const r of page) if (!input.openOnly || r.appliedMinor < r.amountMinor) matches.push(r);
    cursor = page[page.length - 1]?.id ?? null;
    if (cursor === null) break;
  }
  const shown = matches.slice(0, PAGE_SIZE);
  return { items: shown.map((r) => summaryOf(r, withCost)), nextCursor: matches.length > PAGE_SIZE ? shown[shown.length - 1]!.id : null };
}

export interface CreditDetail extends CreditSummary {
  note: string;
  allocations: { invoiceId: string; invoiceNumber: string; amountMinor?: string }[];
}

/** One note with what invoices have taken of it (invoice numbers; amounts with `cost.view`). */
export async function getCreditNote(scoped: ScopedClient, ph: PhActor, creditNoteId: string): Promise<CreditDetail> {
  const r = await scoped.phCreditNote.findFirst({
    where: { id: creditNoteId },
    include: {
      supplier: { select: { name: true } },
      allocations: { select: { invoiceId: true, amountMinor: true, createdAt: true, invoice: { select: { number: true } } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
    },
  });
  if (!r) throw notFound();
  const withCost = mayViewCost(ph);
  return {
    ...summaryOf(r, withCost),
    note: r.note,
    allocations: r.allocations.map((a) => ({ invoiceId: a.invoiceId, invoiceNumber: a.invoice.number.split('#void-')[0]!, ...(withCost ? { amountMinor: a.amountMinor.toString() } : {}) })),
  };
}

// Applying (used by the payments service) ------------------------------------------------------------------------------

export interface LockedCreditNote {
  id: string;
  supplierId: string;
  currency: 'IQD' | 'USD';
  amountMinor: bigint;
  appliedMinor: bigint;
}

/** Locks one credit note FOR UPDATE and returns it as it is under the lock; null when it is not the business's. */
export async function lockCreditNote(tx: ScopedTx, args: { restaurantId: string; creditNoteId: string }): Promise<LockedCreditNote | null> {
  // eslint-disable-next-line no-restricted-properties -- a row lock on one credit note; the id from the client is only locked when it is this business's
  await tx.$queryRaw`SELECT "id" FROM "PhCreditNote" WHERE "id" = ${args.creditNoteId} AND "restaurantId" = ${args.restaurantId} FOR UPDATE`;
  return tx.phCreditNote.findFirst({ where: { id: args.creditNoteId }, select: { id: true, supplierId: true, currency: true, amountMinor: true, appliedMinor: true } });
}

/**
 * Moves a credit note's `appliedMinor` by a signed amount, kept within 0..amount (the database CHECK stands behind it). The
 * caller holds the note's row lock (`lockCreditNote`); the counter is moved only from the value read here.
 */
export async function bumpApplied(tx: ScopedTx, creditNoteId: string, delta: bigint): Promise<bigint> {
  const note = await tx.phCreditNote.findFirst({ where: { id: creditNoteId }, select: { id: true, amountMinor: true, appliedMinor: true } });
  if (!note) throw new StudioError('NOT_FOUND', 'Credit note not found');
  const next = note.appliedMinor + delta;
  if (next < 0n || next > note.amountMinor) throw new StudioError('CONFLICT', 'The amount is more than the credit that is left', { phCode: 'OVER_ALLOCATION' });
  const { count } = await tx.phCreditNote.updateMany({ where: { id: note.id, appliedMinor: note.appliedMinor }, data: { appliedMinor: next } });
  if (count !== 1) throw new StudioError('CONFLICT', 'The credit note changed while it was being applied', { phCode: 'CONFLICT' });
  return next;
}
