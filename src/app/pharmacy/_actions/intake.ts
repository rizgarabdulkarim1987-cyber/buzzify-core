'use server';

import * as approve from '@/server/pharmacy/actions/intake-approve';
import * as intake from '@/server/pharmacy/actions/intake';
import * as review from '@/server/pharmacy/actions/intake-review';
import { invokePh, invokePhQuery } from '@/server/pharmacy/invoke';
import * as queries from '@/server/pharmacy/queries/intake';
import * as reviewQueries from '@/server/pharmacy/queries/intake-review';

// The invoice-by-photo screens' Server Actions. `invokePh` puts in the place the person chose; the browser never names the pharmacy.
// The files themselves go to `/api/pharmacy/intake/files` (a Server Action's body is capped at 1 MB); everything else comes here.

/** Starts a batch. The key is kept with the draft, so a refresh or a lost answer finds the same batch again. */
export async function createIntakeBatch(input: unknown) {
  return invokePh(intake.createBatch, input);
}

/** Reads one uploaded file with the model. A file that could not be read comes back as data (`failureCode`), not as an error. */
export async function readIntakeFile(input: unknown) {
  return invokePh(intake.extract, input);
}

/** Reads a failed file again. */
export async function retryIntakeFile(input: unknown) {
  return invokePh(intake.retry, input);
}

export async function cancelIntakeBatch(input: unknown) {
  return invokePh(approve.cancel, input);
}

/** The batch as the detail screen shows it; also what the screen refreshes every three seconds while a file is being read. */
export async function intakeBatch(input: unknown) {
  return invokePhQuery(reviewQueries.batchGet, input);
}

/** A five-minute signed link to the stored file, made when the person asks for it. */
export async function intakeFileUrl(input: unknown) {
  return invokePhQuery(queries.fileUrl, input);
}

// Review (task 9): every line and header write names the version the person saw; the server recomputes every flag.

export async function updateIntakeRow(input: unknown) {
  return invokePh(review.rowUpdate, input);
}

export async function matchIntakeRow(input: unknown) {
  return invokePh(review.rowMatch, input);
}

export async function clearIntakeMatch(input: unknown) {
  return invokePh(review.rowClearMatch, input);
}

export async function reviewIntakeRow(input: unknown) {
  return invokePh(review.rowReview, input);
}

export async function fillIntakeFromBarcode(input: unknown) {
  return invokePh(review.rowFillFromBarcode, input);
}

export async function scanIntakeBarcode(input: unknown) {
  return invokePh(review.intakeScan, input);
}

export async function addIntakeRow(input: unknown) {
  return invokePh(review.rowAdd, input);
}

export async function removeIntakeRow(input: unknown) {
  return invokePh(review.rowRemove, input);
}

export async function updateIntakeHeader(input: unknown) {
  return invokePh(review.headerUpdate, input);
}

export async function acknowledgeIntakeHeader(input: unknown) {
  return invokePh(review.headerAcknowledge, input);
}

export async function rematchIntake(input: unknown) {
  return invokePh(review.rematchBatch, input);
}

/** Approves the batch into a DRAFT receipt. Nothing enters stock. */
export async function approveIntakeBatch(input: unknown) {
  return invokePh(approve.approve, input);
}
