/**
 * Money for the pharmacy: a BigInt amount in the currency's minor unit beside its currency (IQD has no minor digits,
 * USD has cents). No floating point and no implicit conversion between currencies anywhere in this file; the only
 * `number` is the quantity multiplier and the display step.
 */

import type { Currency } from '@/server/domain/billing/money';
import { minorUnitDigits } from '@/server/domain/billing/money';
import { formatMoney } from '@/server/domain/money';
import type { Locale } from '@/server/domain/types';
import { normalizeScan } from './barcode';

export type { Currency };
export type PhMoney = { amount: bigint; currency: Currency };

export class CurrencyMismatchError extends Error {
  constructor(a: Currency, b: Currency) {
    super(`Cannot combine ${a} with ${b}`);
    this.name = 'CurrencyMismatchError';
  }
}

export class CurrencyNotEnabledError extends Error {
  constructor(currency: Currency) {
    super(`Currency ${currency} is not enabled for this business`);
    this.name = 'CurrencyNotEnabledError';
  }
}

/**
 * An amount as a person types it. Digits in Latin or Arabic-Indic; a decimal `.` or `٫` only where the currency has
 * minor digits; thousands separators `,` `٬` or a space only as proper grouping in the integer part (one to three
 * digits, then groups of exactly three), so "12,50" is refused rather than read as 1250. Null for anything else:
 * empty, negative, signs, scientific notation, more decimals than the currency has.
 */
export function parseMoney(text: string, currency: Currency): PhMoney | null {
  const digits = minorUnitDigits(currency);
  const parts = normalizeScan(text).split(/[.٫]/);
  if (parts.length > 2) return null;
  const [integerPart = '', fraction] = parts;
  if (!/^(?:\d+|\d{1,3}(?:[,٬   ]\d{3})+)$/.test(integerPart)) return null;
  const whole = integerPart.replace(/\D/g, '');
  if (fraction === undefined) return { amount: BigInt(whole) * 10n ** BigInt(digits), currency };
  if (digits === 0 || !/^\d+$/.test(fraction) || fraction.length > digits) return null;
  return { amount: BigInt(whole + fraction.padEnd(digits, '0')), currency };
}

function assertSame(a: PhMoney, b: PhMoney): void {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
}

export function addMoney(a: PhMoney, b: PhMoney): PhMoney {
  assertSame(a, b);
  return { amount: a.amount + b.amount, currency: a.currency };
}

export function compareMoney(a: PhMoney, b: PhMoney): -1 | 0 | 1 {
  assertSame(a, b);
  return a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : 0;
}

/** Price times a whole quantity; the quantity must be a safe integer. */
export function mulQty(m: PhMoney, qty: number): PhMoney {
  if (!Number.isSafeInteger(qty)) throw new RangeError(`Quantity must be a safe whole number: ${qty}`);
  return { amount: m.amount * BigInt(qty), currency: m.currency };
}

/** The menu's price style, through the shared `formatMoney`. Display only: refused beyond Number's exact range. */
export function formatPhMoney(m: PhMoney, locale: Locale): string {
  const asNumber = Number(m.amount);
  if (!Number.isSafeInteger(asNumber)) throw new RangeError('Amount is too large to display');
  return formatMoney(asNumber, m.currency, locale);
}

export function assertEnabledCurrency(currency: Currency, enabled: readonly Currency[]): void {
  if (!enabled.includes(currency)) throw new CurrencyNotEnabledError(currency);
}
