import { minorUnitDigits } from '@/lib/money-input';
import type { Locale } from './types';

// One definition for the server and the Studio's browser code (`src/lib/money-input.ts`).
export { minorUnitDigits };

// Sorani uses Arabic-Iraq conventions for numbers and currency. Node and Chromium ship different
// "ckb" data (US$ 9.00 on the server, $9.00 in the browser), which breaks hydration, whereas "ar-IQ"
// is formatted identically by both.
const LOCALE_TAG: Record<Locale, string> = { en: 'en-US', ar: 'ar-IQ', ckb: 'ar-IQ' };

/** A whole number (calories, say) in the menu's numerals, grouped as the language groups them. */
export function formatCount(value: number, locale: Locale = 'en', numerals: 'latn' | 'arab' = 'latn'): string {
  const wanted = `${LOCALE_TAG[locale]}-u-nu-${numerals}`;
  const tag = Intl.NumberFormat.supportedLocalesOf([wanted]).length > 0 ? wanted : `en-US-u-nu-${numerals}`;
  return new Intl.NumberFormat(tag, { maximumFractionDigits: 0 }).format(value);
}

/**
 * An amount in minor units as the menu shows it. `symbol: false` leaves the currency out ("12.50", the menu's plain
 * price style), with the currency's digits all the same.
 */
export function formatMoney(
  amount: number,
  currency: string,
  locale: Locale = 'en',
  numerals: 'latn' | 'arab' = 'latn',
  { symbol = true }: { symbol?: boolean } = {},
): string {
  const digits = minorUnitDigits(currency);
  const wanted = `${LOCALE_TAG[locale]}-u-nu-${numerals}`;
  const tag = Intl.NumberFormat.supportedLocalesOf([wanted]).length > 0 ? wanted : `en-US-u-nu-${numerals}`;
  return new Intl.NumberFormat(tag, {
    ...(symbol ? { style: 'currency' as const, currency } : { style: 'decimal' as const }),
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount / 10 ** digits);
}
