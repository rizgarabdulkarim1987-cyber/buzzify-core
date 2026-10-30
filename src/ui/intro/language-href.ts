import type { Locale } from '@/lib/locale';

/** The table a table-code scan came from, as the intro's `?table=` carries it: one to three digits, not zero; otherwise null. */
export function introTable(value: string | string[] | undefined): string | null {
  return typeof value === 'string' && /^\d{1,3}$/.test(value) && Number(value) >= 1 ? value : null;
}

/** Where a language button leads: the menu in that language, on to the scanned table when there is one, with the visitor's query. */
export function languageHref(slug: string, locale: Locale, table: string | null, search: string): string {
  return `/${slug}/${locale}${table ? `/t/${table}` : ''}${search}`;
}
