/**
 * Expiry dates as pure functions. Dates are UTC calendar dates in 'YYYY-MM-DD' text (R2-8: the pharmacy has no timezone
 * setting yet, so "today" is the UTC day). A MONTH-precision expiry is stored as the last day of the month (R2-4).
 */
import { normalizeScan } from './barcode';

export type ExpiryPrecision = 'DAY' | 'MONTH';
export type ExpiryBand = 'expired' | 'd30' | 'd60' | 'd90' | 'd180' | 'ok';
export type ExpiryBatch = { expiryDate: string; expiryPrecision: ExpiryPrecision };

const MS_PER_DAY = 86_400_000;

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

function iso(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

function parts(date: string): { year: number; month: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new RangeError(`Not a YYYY-MM-DD date: ${date}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function dayNumber(date: string): number {
  const { year, month, day } = parts(date);
  return Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

/** The UTC calendar day of an instant, as 'YYYY-MM-DD'. */
export function utcToday(now: Date = new Date()): string {
  return iso(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate());
}

function monthEnd(year: number, month: number): { date: string; precision: ExpiryPrecision } | null {
  if (year < 2000 || year > 2099) return null;
  return { date: iso(year, month, daysInMonth(year, month)), precision: 'MONTH' };
}

/**
 * An expiry as typed: 'MM/YYYY' or 'YYYY-MM' (precision MONTH, stored as the last day of the month) or 'YYYY-MM-DD'
 * (precision DAY). Digits in Latin or Arabic-Indic. Years 2000 to 2099 only; null for anything else (also impossible dates).
 */
export function parseExpiry(input: string): { date: string; precision: ExpiryPrecision } | null {
  const text = normalizeScan(input);
  let m = /^(0?[1-9]|1[0-2])\/(\d{4})$/.exec(text);
  if (m) return monthEnd(Number(m[2]), Number(m[1]));
  m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(text);
  if (m) return monthEnd(Number(m[1]), Number(m[2]));
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (m) {
    const year = Number(m[1]);
    const mo = Number(m[2]);
    const day = Number(m[3]);
    if (year < 2000 || year > 2099 || mo < 1 || mo > 12 || day < 1 || day > daysInMonth(year, mo)) return null;
    return { date: iso(year, mo, day), precision: 'DAY' };
  }
  return null;
}

/** 'MM/YYYY' for MONTH precision, 'DD/MM/YYYY' for DAY. */
export function formatExpiry(batch: ExpiryBatch): string {
  const { year, month, day } = parts(batch.expiryDate);
  return batch.expiryPrecision === 'MONTH' ? `${pad(month, 2)}/${pad(year, 4)}` : `${pad(day, 2)}/${pad(month, 2)}/${pad(year, 4)}`;
}

/** Selling stays allowed on the expiry day itself (for MONTH, to the month end); the day after, the batch is expired. */
export function isExpired(batch: Pick<ExpiryBatch, 'expiryDate'>, today: string): boolean {
  return batch.expiryDate < today;
}

/** Whole days from `today` to the stored expiry date (negative once expired; 0 on the expiry day). */
export function daysToExpiry(batch: Pick<ExpiryBatch, 'expiryDate'>, today: string): number {
  return dayNumber(batch.expiryDate) - dayNumber(today);
}

/**
 * Alert band. DAY precision counts from the expiry date. MONTH precision counts from the START of the last month
 * (spec 4.4: conservative alerts), so a batch of 03/2027 is in `d30` from 1 March at the latest, yet it is still
 * sellable until 31 March and only `expired` from 1 April. Bands are inclusive: 30 days left is `d30`.
 */
export function expiryBand(batch: ExpiryBatch, today: string): ExpiryBand {
  if (isExpired(batch, today)) return 'expired';
  let days = daysToExpiry(batch, today);
  if (batch.expiryPrecision === 'MONTH') {
    const { year, month } = parts(batch.expiryDate);
    days = Math.min(days, dayNumber(iso(year, month, 1)) - dayNumber(today));
  }
  if (days <= 30) return 'd30';
  if (days <= 60) return 'd60';
  if (days <= 90) return 'd90';
  if (days <= 180) return 'd180';
  return 'ok';
}
