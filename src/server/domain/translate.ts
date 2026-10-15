import type { Locale, TranslationMap } from './types';

function pick(map: TranslationMap, locale: Locale, field: string): string | null {
  const value = map[locale]?.[field];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

export function resolveText(
  map: TranslationMap | null | undefined,
  field: string,
  locale: Locale,
  defaultLocale: Locale,
): string {
  if (!map) return '';
  for (const candidate of [locale, defaultLocale, 'en' as Locale]) {
    const found = pick(map, candidate, field);
    if (found !== null) return found;
  }
  for (const candidate of Object.keys(map) as Locale[]) {
    const found = pick(map, candidate, field);
    if (found !== null) return found;
  }
  return '';
}
