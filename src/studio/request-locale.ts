import { cookies, headers } from 'next/headers';
import type { Locale } from '@/lib/locale';
import { getActor } from '@/server/studio/auth/actor';
import { chooseStudioLocale, STUDIO_LOCALE_COOKIE } from './locale';

/**
 * The interface language of the current request (server components only): the signed-in person's setting, else the
 * signed-out language switch's cookie, else `Accept-Language`. `getActor()` is cached per request, so the layouts and
 * the page share one lookup.
 */
export async function requestStudioLocale(): Promise<Locale> {
  const [actor, jar, requestHeaders] = await Promise.all([getActor(), cookies(), headers()]);
  return chooseStudioLocale({
    actorLocale: actor?.locale ?? null,
    cookie: jar.get(STUDIO_LOCALE_COOKIE)?.value ?? null,
    acceptLanguage: requestHeaders.get('accept-language'),
  });
}
