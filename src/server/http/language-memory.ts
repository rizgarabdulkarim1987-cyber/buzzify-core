import { isLocale, type Locale } from '@/lib/locale';

/** The language a visitor chose on a menu's intro page, kept per menu: `bz_lang_<slug>`, a locale code, scoped to that menu's path. */
export const languageCookie = (slug: string) => `bz_lang_${slug}`;

/** The remembered language out of a request's Cookie header, only when it is one the menu offers. */
export function readLanguage(headers: Headers, slug: string, offered: readonly Locale[]): Locale | null {
  const raw = headers.get('cookie');
  if (!raw) return null;
  const wanted = languageCookie(slug);
  for (const part of raw.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name !== wanted) continue;
    const value = rest.join('=');
    return isLocale(value) && offered.includes(value) ? value : null;
  }
  return null;
}

/** The cookie the intro page's language links write before they navigate: one year, Lax, only on this menu's own addresses. */
export function languageCookieValue(slug: string, locale: Locale, secure: boolean): string {
  return `${languageCookie(slug)}=${locale}; Path=/${slug}; Max-Age=31536000; SameSite=Lax${secure ? '; Secure' : ''}`;
}
