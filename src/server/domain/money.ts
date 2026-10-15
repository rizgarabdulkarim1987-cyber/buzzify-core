import type { Locale } from './types';

const LOCALE_TAG: Record<Locale, string> = { en: 'en-US', ar: 'ar-IQ', ckb: 'ckb-IQ' };

export function minorUnitDigits(currency: string): number {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

export function formatMoney(
  amount: number,
  currency: string,
  locale: Locale = 'en',
  numerals: 'latn' | 'arab' = 'latn',
): string {
  const digits = minorUnitDigits(currency);
  const wanted = `${LOCALE_TAG[locale]}-u-nu-${numerals}`;
  const tag = Intl.NumberFormat.supportedLocalesOf([wanted]).length > 0 ? wanted : `en-US-u-nu-${numerals}`;
  return new Intl.NumberFormat(tag, {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount / 10 ** digits);
}
