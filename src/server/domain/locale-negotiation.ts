import type { Locale } from '@/lib/locale';

/** More than this is not a browser's header. Reading it all would only give an attacker something to chew on. */
const MAX_HEADER_LENGTH = 1_000;
const MAX_ENTRIES = 24;

const QUALITY = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/;

/**
 * The menu language a language tag stands for, or null. Kurdish (`ku`, `ckb`, with or without a region) is Sorani,
 * the only Kurdish the platform has; Latin-script Kurdish (`ku-Latn`, Kurmanji) is a different written language and
 * is not mapped to it.
 */
function localeOfTag(tag: string): Locale | null {
  const [primary, ...rest] = tag.split('-');
  if (primary === 'en' || primary === 'ar') return primary;
  if (primary === 'ckb') return 'ckb';
  if (primary === 'ku') return rest.includes('latn') ? null : 'ckb';
  return null;
}

/**
 * The visitor's best language among those the menu offers, from an `Accept-Language` header: the highest quality
 * value wins, header order breaks ties, a quality of 0 rules a language out, and anything unreadable is skipped.
 * `fallback` when nothing matches.
 */
export function pickLocale(acceptLanguage: string | null, offered: Locale[], fallback: Locale): Locale {
  if (!acceptLanguage || acceptLanguage.length > MAX_HEADER_LENGTH) return fallback;

  const ranked: { locale: Locale; quality: number; order: number }[] = [];
  const entries = acceptLanguage.split(',').slice(0, MAX_ENTRIES);
  for (const [order, entry] of entries.entries()) {
    const [rawTag = '', ...params] = entry.split(';');
    const tag = rawTag.trim().toLowerCase();
    const locale = localeOfTag(tag);
    if (!locale || !offered.includes(locale)) continue;

    let quality = 1;
    let valid = true;
    for (const param of params) {
      const [name, value = ''] = param.split('=').map((part) => part.trim().toLowerCase());
      if (name !== 'q') continue;
      if (QUALITY.test(value)) quality = Number(value);
      else valid = false;
    }
    if (valid && quality > 0) ranked.push({ locale, quality, order });
  }

  ranked.sort((a, b) => b.quality - a.quality || a.order - b.order);
  return ranked[0]?.locale ?? fallback;
}
