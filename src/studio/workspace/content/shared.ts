import type { Locale } from '@/lib/locale';
import { formatPriceInput, minorUnitDigits, parsePriceInput, type PriceInputProblem } from '@/lib/money-input';
import { numberFormat } from '@/studio/format';

/** A text in each of the menu's languages. */
export type Names = Partial<Record<Locale, string>>;

/** The name to show the person: in the first of `prefer` that has one, else any, else nothing. */
export function displayName(names: Names, ...prefer: Locale[]): string {
  for (const locale of prefer) {
    const name = names[locale];
    if (name) return name;
  }
  return Object.values(names).find((name) => Boolean(name)) ?? '';
}

/** Arabic and Sorani are written right to left, in the Arabic-script face. */
export const isRtl = (locale: Locale) => locale !== 'en';

/** An amount in minor units as the Studio shows it in a list: `3.50 USD`, with the interface language's digits. */
export function formatMoney(minor: number, currency: string, locale: Locale): string {
  const digits = minorUnitDigits(currency);
  const number = numberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${number.format(minor / 10 ** digits)} ${currency}`;
}

/** The message key for each reason a typed price is refused. */
export const PRICE_PROBLEM_KEYS: Record<PriceInputProblem, string> = {
  EMPTY: 'content.price.empty',
  NOT_A_NUMBER: 'content.price.notANumber',
  NEGATIVE: 'content.price.negative',
  TOO_PRECISE: 'content.price.tooPrecise',
  TOO_LARGE: 'content.price.tooLarge',
};

/**
 * A typed difference from the product's price (`+1.00`, `-0.50`, `0`) in minor units. A leading plus or minus sign is
 * the direction; the rest is read as a price. Empty means no difference.
 */
export function parseDeltaInput(text: string, currency: string): { ok: true; minor: number } | { ok: false; reason: PriceInputProblem } {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: true, minor: 0 };
  const negative = /^[-−]/.test(trimmed);
  const parsed = parsePriceInput(trimmed.replace(/^[-+−]\s*/, ''), currency);
  if (!parsed.ok) return parsed;
  return { ok: true, minor: negative ? -parsed.minor : parsed.minor };
}

/** A key for a new row in a list the person is editing, stable while they edit. */
let counter = 0;
export const newKey = () => `new-${++counter}`;

/** A difference as the person types it back: `+1.00`, `-0.50`, `0.00`. */
export function formatDeltaInput(minor: number, currency: string): string {
  const text = formatPriceInput(minor, currency);
  return minor > 0 ? `+${text}` : text;
}

/** A typed percentage (`10`, `-5`, `7.5`, `+12.5%`) in basis points: 1000 for 10%. At most two decimals. */
export function parsePercentInput(text: string): { ok: true; basisPoints: number } | { ok: false; reason: PriceInputProblem } {
  const trimmed = text.trim().replace(/%$/, '').trim();
  const negative = /^[-−]/.test(trimmed);
  // Two decimals and Arabic-Indic digits, as a price in a two-decimal currency reads them: 7.5 is 750.
  const parsed = parsePriceInput(trimmed.replace(/^[-+−]\s*/, ''), 'USD');
  if (!parsed.ok) return parsed;
  return { ok: true, basisPoints: negative ? -parsed.minor : parsed.minor };
}
