/**
 * Billing amounts as people type them (ported from Business Core's src/admin/money-input.ts, then made strict per
 * currency). Money is stored in the currency's minor unit (cents for USD; IQD has none); people type the major unit, in
 * Latin, Arabic-Indic (٠-٩) or Extended Arabic-Indic (۰-۹) digits. The conversion is integer arithmetic on the digits,
 * never `parseFloat(text) * 100`.
 *
 * - IQD has no fraction, so every separator groups thousands: in Iraq "25.000" is twenty-five thousand dinars, as are
 *   "25,000", "25٬000" and "25 000". Groups after the first (1 to 3 digits) have exactly 3 digits, with one kind of
 *   separator; anything else ("25.5", "25.00", "2.50.000", "25.") is refused, never guessed.
 * - USD takes a decimal point (or the Arabic decimal mark ٫) with at most 2 digits after it, and commas grouping thousands
 *   in threes before it: "1,250.50". A decimal comma ("1.250,50", "4,50") is refused.
 *
 * Menu prices have their own reader (src/lib/money-input.ts), with a lower ceiling and any currency; this one knows only
 * the billing currencies and allows up to a Postgres Int4.
 */
import { MAX_AMOUNT_MINOR, minorUnitDigits, type Currency } from '@/server/domain/billing/money';

/** The largest amount billing stores, in minor units: a Postgres Int4. */
export const MAX_MINOR = MAX_AMOUNT_MINOR;

/**
 * Why a typed amount cannot be read. `NOT_WHOLE` is an IQD amount that is not whole dinars written plainly or in
 * thousands; `TOO_PRECISE` is a USD amount with more than 2 decimals.
 */
export type AmountInputProblem = 'EMPTY' | 'NOT_A_NUMBER' | 'NEGATIVE' | 'NOT_WHOLE' | 'TOO_PRECISE' | 'TOO_LARGE';

const ARABIC_INDIC_ZERO = 0x0660;
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0;
const ARABIC_DECIMAL_MARK = '٫';
const ARABIC_THOUSANDS_MARK = '٬';

/** Latin digits for Arabic-Indic ones, `,` for the Arabic thousands mark, `.` for the Arabic decimal mark, plain spaces. */
function latinize(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9) out += String(code - ARABIC_INDIC_ZERO);
    else if (code >= EXTENDED_ARABIC_INDIC_ZERO && code <= EXTENDED_ARABIC_INDIC_ZERO + 9) out += String(code - EXTENDED_ARABIC_INDIC_ZERO);
    else if (char === ARABIC_THOUSANDS_MARK) out += ',';
    else if (char === ARABIC_DECIMAL_MARK) out += '.';
    else if (char === ' ' || char === ' ') out += ' ';
    else out += char;
  }
  return out;
}

/** Whole IQD: plain digits, or a 1-3 digit group then groups of exactly 3, all split by the same `.`, `,` or space. */
const IQD_PLAIN = /^\d+$/;
const IQD_GROUPED = /^\d{1,3}([., ])\d{3}(?:\1\d{3})*$/;
/** USD: plain digits or comma groups of 3, then optionally a point and 1 or more digits (checked against 2 after). */
const USD_NUMBER = /^(\d+|\d{1,3}(?:,\d{3})+)(?:\.(\d+))?$/;

/** A typed amount in the currency's major unit, as minor units, or why it cannot be one. */
export function parseAmountInput(text: string, currency: Currency): { ok: true; minor: number } | { ok: false; reason: AmountInputProblem } {
  const value = latinize(text).trim();
  if (value === '') return { ok: false, reason: 'EMPTY' };
  if (/^-\s*[\d.,]/.test(value)) return { ok: false, reason: 'NEGATIVE' };
  if (/[^\d., ]/.test(value)) return { ok: false, reason: 'NOT_A_NUMBER' };

  let whole: string;
  let fraction = '';
  if (minorUnitDigits(currency) === 0) {
    // The Arabic decimal mark (٫) never groups thousands: dinars have no fraction.
    if (text.includes(ARABIC_DECIMAL_MARK)) return { ok: false, reason: 'NOT_WHOLE' };
    if (IQD_PLAIN.test(value)) whole = value;
    else if (IQD_GROUPED.test(value)) whole = value.replace(/[., ]/g, '');
    else return { ok: false, reason: 'NOT_WHOLE' };
  } else {
    const match = USD_NUMBER.exec(value);
    if (!match) return { ok: false, reason: 'NOT_A_NUMBER' };
    whole = match[1]!.replace(/,/g, '');
    fraction = match[2] ?? '';
    if (fraction.length > 2) return { ok: false, reason: 'TOO_PRECISE' };
  }

  const digits = minorUnitDigits(currency);
  const trimmed = whole.replace(/^0+(?=\d)/, '');
  // Checked as text first, so a huge number never loses precision.
  if (trimmed.length > 12) return { ok: false, reason: 'TOO_LARGE' };
  const minor = Number(trimmed) * 10 ** digits + Number(fraction.padEnd(digits, '0') || '0');
  if (minor > MAX_MINOR) return { ok: false, reason: 'TOO_LARGE' };
  return { ok: true, minor };
}

/** An amount in the major unit as an input shows it: `19.99`, `50000`. */
export function formatAmountInput(minor: number, currency: Currency): string {
  const digits = minorUnitDigits(currency);
  const sign = minor < 0 ? '-' : '';
  const absolute = Math.abs(minor);
  if (digits === 0) return `${sign}${absolute}`;
  const scale = 10 ** digits;
  return `${sign}${Math.floor(absolute / scale)}.${String(absolute % scale).padStart(digits, '0')}`;
}
