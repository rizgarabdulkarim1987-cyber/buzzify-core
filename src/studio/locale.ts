import { isLocale, LOCALES, type Locale } from '@/lib/locale';
import { pickLocale } from '@/server/domain/locale-negotiation';

/** The cookie the signed-out language switch writes. A signed-in person's language is stored on their account instead. */
export const STUDIO_LOCALE_COOKIE = 'studio-locale';

/** A year: the choice is a preference, not a session. */
export const STUDIO_LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * The Studio's interface language for one request: the signed-in person's own setting, else the language switch's
 * cookie, else the browser's `Accept-Language`, else English. Pure, so the layouts and the tests share it.
 */
export function chooseStudioLocale(input: {
  actorLocale?: Locale | null;
  cookie?: string | null;
  acceptLanguage?: string | null;
}): Locale {
  if (input.actorLocale) return input.actorLocale;
  if (input.cookie && isLocale(input.cookie)) return input.cookie;
  return pickLocale(input.acceptLanguage ?? null, [...LOCALES], 'en');
}
