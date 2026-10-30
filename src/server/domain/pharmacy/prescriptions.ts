/**
 * Prescription rules (phase 7, R7-1 and R7-2), pure: no database, no clock (the caller passes `today` as `YYYY-MM-DD`).
 *
 * - A prescription for a controlled drug (RESTRICTED) is valid 30 days from the day it was issued, one for a prescription drug
 *   (RX) 180 days; it may not be issued in the future. The day of issue is day 0: a prescription issued 30 days ago is still valid.
 * - `controlledMaxQty` is the most base units of ONE controlled product in one sale (all its lines together); 0 means no limit.
 * - The patient identity note keeps the type of the document and at most the last 4 characters of its number, never the number.
 * - A prescription number may not be dispensed twice for the same product while the earlier prescription is still within the
 *   30-day window (comparing the numbers without case and with spaces collapsed).
 */

export const RESTRICTED_VALID_DAYS = 30;
export const RX_VALID_DAYS = 180;
export const PATIENT_ID_LAST_CHARS = 4;

export type RxLevel = 'OTC' | 'RX' | 'RESTRICTED';

/** How many days a prescription for a drug of this level stays valid, or null when the level needs none. */
export function validityDays(level: RxLevel): number | null {
  if (level === 'RESTRICTED') return RESTRICTED_VALID_DAYS;
  if (level === 'RX') return RX_VALID_DAYS;
  return null;
}

const DAY_MS = 86_400_000;

/** A real calendar day written `YYYY-MM-DD`, as the number of UTC days since 1970-01-01, or null. */
function dayNumber(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const at = new Date(Date.UTC(year, month - 1, day));
  if (at.getUTCFullYear() !== year || at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day) return null;
  return Math.round(at.getTime() / DAY_MS);
}

const dayText = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);

export type IssuedOnVerdict = { ok: true } | { ok: false; reason: 'MALFORMED' | 'FUTURE' | 'EXPIRED' };

/** Whether a prescription issued on `issuedOn` may be used on `today` for a drug of `level`. */
export function checkIssuedOn(issuedOn: string, today: string, level: RxLevel): IssuedOnVerdict {
  const issued = dayNumber(issuedOn);
  const now = dayNumber(today);
  if (issued === null || now === null) return { ok: false, reason: 'MALFORMED' };
  if (issued > now) return { ok: false, reason: 'FUTURE' };
  const days = validityDays(level);
  if (days !== null && now - issued > days) return { ok: false, reason: 'EXPIRED' };
  return { ok: true };
}

/** The oldest issue day that is still valid on `today` for a drug valid `days` days. */
export function windowStart(today: string, days: number): string {
  const now = dayNumber(today);
  if (now === null) throw new Error('Not a calendar day');
  return dayText(now - days);
}

/** The oldest issue day whose controlled use still blocks a repeat of its number. */
export const duplicateWindowStart = (today: string): string => windowStart(today, RESTRICTED_VALID_DAYS);

export type QtyVerdict = { ok: true } | { ok: false; productId: string; max: number; total: number };

/** The total of each controlled product over the sale's lines against `maxQty` (0 = no limit). */
export function controlledQtyCheck(maxQty: number, lines: readonly { productId: string; baseQty: number }[]): QtyVerdict {
  if (maxQty <= 0) return { ok: true };
  const totals = new Map<string, number>();
  for (const line of lines) totals.set(line.productId, (totals.get(line.productId) ?? 0) + line.baseQty);
  for (const [productId, total] of totals) if (total > maxQty) return { ok: false, productId, max: maxQty, total };
  return { ok: true };
}

export type PatientIdVerdict = { ok: true; value: string } | { ok: false; reason: 'TOO_LONG' | 'SHAPE' };

/** `Type` or `Type: last4` (`:` or `-`): the document type in letters, then at most 4 letters or digits of its number. */
const NOTE_SHAPE = /^(\p{L}[\p{L} ]{1,29}?)(?:\s*[:-]\s*([\p{L}\p{N}]+))?$/u;

export function checkPatientIdNote(note: string): PatientIdVerdict {
  const value = note.trim().replace(/\s+/g, ' ');
  const match = NOTE_SHAPE.exec(value);
  if (match) {
    const tail = match[2];
    if (tail !== undefined && tail.length > PATIENT_ID_LAST_CHARS) return { ok: false, reason: 'TOO_LONG' };
    return { ok: true, value };
  }
  // Not the shape: say "too long" when a whole number seems to be in it (a run of 5 or more characters with a digit).
  const tokens = value.split(/[^\p{L}\p{N}]+/u);
  if (tokens.some((t) => t.length > PATIENT_ID_LAST_CHARS && /\p{N}/u.test(t))) return { ok: false, reason: 'TOO_LONG' };
  return { ok: false, reason: 'SHAPE' };
}

/** What the paper says with the spaces tidied: the form in which a number is stored and compared. */
export const normalizeRxNumber = (number: string): string => number.trim().replace(/\s+/g, ' ');

const sameNumber = (a: string, b: string) => normalizeRxNumber(a).toLowerCase() === normalizeRxNumber(b).toLowerCase();

/**
 * Whether `use` repeats a controlled dispensing in `earlier` (the dispensed uses of prescriptions with numbers like it): the same
 * number and product, on a prescription issued inside the window that ends `today`.
 */
export function isDuplicateUse(
  use: { number: string; productId: string },
  earlier: readonly { number: string; productId: string; issuedOn: string }[],
  today: string,
): boolean {
  const start = duplicateWindowStart(today);
  return earlier.some((e) => e.productId === use.productId && sameNumber(e.number, use.number) && e.issuedOn >= start);
}
