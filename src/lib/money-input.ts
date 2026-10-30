/**
 * Prices as people type them and as the Studio and the spreadsheets write them. Amounts are stored in the currency's
 * minor unit (cents for USD, dinars for IQD, which has none); people type the major unit, in Latin or Arabic-Indic
 * digits, with a point or a comma.
 */

/**
 * Currencies pinned to the digits the product stores them with. Older ICU data (some servers and phones) gives IQD three
 * decimals, which would show 250 dinars as 0.250; amounts here are whole dinars.
 */
const PINNED_DIGITS: Record<string, number> = { IQD: 0 };

/** How many digits the currency's minor unit has: 2 for USD, 0 for IQD. */
export function minorUnitDigits(currency: string): number {
  return PINNED_DIGITS[currency] ?? new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

/** The largest amount the Studio accepts, in minor units. */
export const MAX_MINOR = 1_000_000_000;

export type PriceInputProblem = 'EMPTY' | 'NOT_A_NUMBER' | 'NEGATIVE' | 'TOO_PRECISE' | 'TOO_LARGE';

const ARABIC_INDIC_ZERO = 0x0660;
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0;
const ARABIC_DECIMAL_MARK = '٫';
const ARABIC_THOUSANDS_MARK = '٬';

/** Latin digits for Arabic-Indic ones; the Arabic decimal and thousands marks for `.` and `,`. */
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
  // The Arabic decimal mark is never anything else, so whatever comes before it groups thousands.
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

  // The decimal mark, if there is one, and the character that separates groups of thousands.
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
    // "6,000" groups thousands; "4,50" is a decimal comma.
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

/** A typed price in the currency's major unit, as minor units, or why it cannot be one. */
export function parsePriceInput(
  text: string,
  currency: string,
): { ok: true; minor: number } | { ok: false; reason: PriceInputProblem } {
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
  // Longer than the limit's digits is too large; checked as text first, so a huge number never loses precision.
  if (whole.length > 12) return { ok: false, reason: 'TOO_LARGE' };
  const minor = Number(whole) * 10 ** digits + Number(significant.padEnd(digits, '0') || '0');
  if (minor > MAX_MINOR) return { ok: false, reason: 'TOO_LARGE' };
  return { ok: true, minor };
}

/** An amount in the major unit as the Studio and the spreadsheets write it: `4.50`, `6000`. */
export function formatPriceInput(minor: number, currency: string): string {
  const digits = minorUnitDigits(currency);
  const sign = minor < 0 ? '-' : '';
  const absolute = Math.abs(minor);
  if (digits === 0) return `${sign}${absolute}`;
  const scale = 10 ** digits;
  return `${sign}${Math.floor(absolute / scale)}.${String(absolute % scale).padStart(digits, '0')}`;
}

/**
 * An amount stored for a currency with `fromDigits` minor digits, for one with `toDigits`, keeping the number in the
 * major unit (6,000 stays 6,000; 4.50 becomes 5). Halves round away from zero.
 */
export function rescaleMinor(minor: number, fromDigits: number, toDigits: number): number {
  if (toDigits >= fromDigits) return minor * 10 ** (toDigits - fromDigits);
  const divisor = 10 ** (fromDigits - toDigits);
  const rounded = Math.floor((2 * Math.abs(minor) + divisor) / (2 * divisor));
  return minor < 0 ? -rounded : rounded;
}

/** The rounding step bulk price changes use when the menu sets none (spec 13.4): 0.05 USD, 250 IQD, one minor unit. */
export function defaultPriceStep(currency: string): number {
  if (currency === 'USD') return 5;
  if (currency === 'IQD') return 250;
  return 1;
}

/** The nearest multiple of `step` (halves up), and never less than one step: a price never rounds to nothing. */
export function roundToStep(minor: number, step: number): number {
  const rounded = Math.floor((2 * minor + step) / (2 * step)) * step;
  return Math.max(step, rounded);
}
