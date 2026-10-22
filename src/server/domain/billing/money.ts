export type Currency = 'IQD' | 'USD';
export type Locale = 'en' | 'ar' | 'ckb';

/** Minor-unit digits: IQD has none, USD has cents. Money is always an Int in minor units beside its currency. */
export function minorUnitDigits(currency: Currency): 0 | 2 {
  return currency === 'IQD' ? 0 : 2;
}

// Sorani uses Arabic-Iraq conventions. Node and Chromium ship different "ckb" data, which breaks hydration,
// whereas "ar-IQ" is formatted identically by both.
const LOCALE_TAG: Record<Locale, string> = { en: 'en-US', ar: 'ar-IQ', ckb: 'ar-IQ' };

/** An amount in minor units as people read it. Never converts between currencies. */
export function formatMoney(amountMinor: number, currency: Currency, locale: Locale = 'en'): string {
  const digits = minorUnitDigits(currency);
  return new Intl.NumberFormat(LOCALE_TAG[locale], {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amountMinor / 10 ** digits);
}

/** The largest amount a Postgres Int4 column holds. */
export const MAX_AMOUNT_MINOR = 2_147_483_647;
