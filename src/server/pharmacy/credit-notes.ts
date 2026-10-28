import type { ScopedTx } from '@/server/data/tenant-db';
import { StudioError } from '@/server/studio/framework/result';

/**
 * Supplier credit notes (R4-7). Task 7 needs only the part that applies a credit note to invoices: reading a note under its
 * row lock and moving its `appliedMinor` counter. This file is the only writer of `PhCreditNote`; task 8 adds the creation
 * of a note here.
 *
 * Lock order of this phase (R4-11, header comment of every service that locks): client key (advisory, namespace 7201) -> PO
 * row -> receipt line counters -> credit note row -> invoice rows ordered by id -> stock rows -> number lock (7202). Applying
 * a credit note takes the note first and then the invoices it spends on, so two applications of one note queue on the note.
 */

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
