/**
 * Billing amounts as people type them, ported from Business Core (src/admin/money-input.ts). Money is stored in the
 * currency's minor unit (cents for USD; IQD has none); people type the major unit, in Latin or Arabic-Indic digits, with
 * a point or a comma. The conversion is integer arithmetic on the digits, never `parseFloat(text) * 100`.
 *
 * Menu prices have their own reader (src/lib/money-input.ts), with a lower ceiling and any currency; this one knows only
 * the billing currencies and allows up to a Postgres Int4.
 */
import { MAX_AMOUNT_MINOR, minorUnitDigits, type Currency } from '@/server/domain/billing/money';

/** The largest amount billing stores, in minor units: a Postgres Int4. */
export const MAX_MINOR = MAX_AMOUNT_MINOR;

export type AmountInputProblem = 'EMPTY' | 'NOT_A_NUMBER' | 'NEGATIVE' | 'TOO_PRECISE' | 'TOO_LARGE';

const ARABIC_INDIC_ZERO = 0x0660;
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0;
const ARABIC_DECIMAL_MARK = '٫';
const ARABIC_THOUSANDS_MARK = '٬';

/** Latin digits for Arabic-Indic ones; the Arabic thousands mark for `,`. */
function latinize(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9) out += String(code - ARABIC_INDIC_ZERO);
    else if (code >= EXTENDED_ARABIC_INDIC_ZERO && code <= EXTENDED_ARABIC_INDIC_ZERO + 9) out += String(code - EXTENDED_ARABIC_INDIC_ZERO);
    else if (char === ARABIC_THOUSANDS_MARK) out += ',';
    else if (char === ' ' || char === ' ') out += ' ';
    else out += char;
  }
  return out;
}

/** Digits split by one separator: a first group of one to three digits, then groups of exactly three. */
function joinGroups(text: string, separator: string): string | null {
  const groups = text.split(separator);
  if (groups.length === 1) return /^\d*$/.test(text) ? text : null;
  if (!/^\d{1,3}$/.test(groups[0]!)) return null;
  if (!groups.slice(1).every((group) => /^\d{3}$/.test(group))) return null;
  return groups.join('');
}

/** The integer and fraction digits of a typed number, or null when it is not one. */
function splitNumber(text: string): { whole: string; fraction: string } | null {
  if (text.includes(ARABIC_DECIMAL_MARK)) {
    const [whole = '', fraction = '', ...rest] = text.split(ARABIC_DECIMAL_MARK);
    if (rest.length > 0 || !/^\d+$/.test(fraction)) return null;
    const joined = joinGroups(whole, whole.includes(',') ? ',' : whole.includes('.') ? '.' : ' ');
    return joined === null ? null : { whole: joined, fraction };
  }

  const lastPoint = text.lastIndexOf('.');
  const lastComma = text.lastIndexOf(',');
  const points = text.split('.').length - 1;
  const commas = text.split(',').length - 1;

  let decimal: '.' | ',' | null = null;
  let group: '.' | ',' | ' ' = ' ';
  if (points > 0 && commas > 0) {
    decimal = lastPoint > lastComma ? '.' : ',';
    group = decimal === '.' ? ',' : '.';
  } else if (points === 1) {
    decimal = '.';
  } else if (points > 1) {
    group = '.';
  } else if (commas === 1) {
    // "50,000" groups thousands; "4,50" is a decimal comma.
    const after = text.length - lastComma - 1;
    if (after === 3) group = ',';
    else decimal = ',';
  } else if (commas > 1) {
    group = ',';
  }

  let whole = text;
  let fraction = '';
  if (decimal !== null) {
    const at = text.lastIndexOf(decimal);
    whole = text.slice(0, at);
    fraction = text.slice(at + 1);
    if (!/^\d+$/.test(fraction)) return null;
  }
  if (whole.includes(' ') && group !== ' ') return null;
  const joined = joinGroups(whole, group);
  if (joined === null) return null;
  if (joined === '' && fraction === '') return null;
  return { whole: joined, fraction };
}

/** A typed amount in the currency's major unit, as minor units, or why it cannot be one. */
export function parseAmountInput(text: string, currency: Currency): { ok: true; minor: number } | { ok: false; reason: AmountInputProblem } {
  const value = latinize(text).trim();
  if (value === '') return { ok: false, reason: 'EMPTY' };
  if (/^-\s*[\d.,]/.test(value)) return { ok: false, reason: 'NEGATIVE' };
  if (/[^\d.,٫ ]/.test(value)) return { ok: false, reason: 'NOT_A_NUMBER' };

  const parts = splitNumber(value);
  if (!parts) return { ok: false, reason: 'NOT_A_NUMBER' };

  const digits = minorUnitDigits(currency);
  const significant = parts.fraction.replace(/0+$/, '');
  if (significant.length > digits) return { ok: false, reason: 'TOO_PRECISE' };

  const whole = parts.whole.replace(/^0+(?=\d)/, '') || '0';
  // Checked as text first, so a huge number never loses precision.
  if (whole.length > 12) return { ok: false, reason: 'TOO_LARGE' };
  const minor = Number(whole) * 10 ** digits + Number(significant.padEnd(digits, '0') || '0');
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
