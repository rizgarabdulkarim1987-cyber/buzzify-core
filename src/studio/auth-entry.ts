import { CONTINUE_PATH } from '@/server/retail/paths';

/**
 * Who the pages around signing in are speaking to. `retail`: Buzzify Retail sent the browser to sign in (its handoff
 * returns through `CONTINUE_PATH`), so the pages wear a neutral Buzzify frame and name no Studio, restaurant, cashier or
 * pharmacy: a person who only uses Retail never sees the Studio. `studio`: everyone else, as before.
 *
 * The marker is the `next` parameter itself, after `safeNextPath` has checked it: no new parameter a link could forge to
 * send someone elsewhere, and the sign-in still returns only to that one Studio path. A forged marker changes nothing but
 * the frame.
 */
export type AuthEntry = 'studio' | 'retail';

export function authEntryOf(next: string | null): AuthEntry {
  return next === CONTINUE_PATH ? 'retail' : 'studio';
}

/** The auth texts that name the Studio (or its product, Buzzify Core); each has a neutral twin under `auth.neutral.`. */
export const NEUTRAL_AUTH_KEYS = ['auth.signIn.intro', 'auth.signIn.alreadyAction', 'auth.twoFactor.intro', 'auth.forgot.sentBody'] as const;

const NEUTRAL: ReadonlySet<string> = new Set(NEUTRAL_AUTH_KEYS);

/** The message to show for `key` on a page of this entry: its neutral twin from Retail, else the key itself. */
export function authKey(key: string, entry: AuthEntry): string {
  return entry === 'retail' && NEUTRAL.has(key) ? `auth.neutral.${key.slice('auth.'.length)}` : key;
}

/** A sign-in page's address that keeps `next` (already checked) along, so the next page knows the entry too. */
export function withNext(path: string, next: string | null): string {
  return next ? `${path}?next=${encodeURIComponent(next)}` : path;
}

/** The product name in a page title: the neutral one from Retail (the Studio's layout would add "Buzzify Core"). */
export function authTitle(title: string, entry: AuthEntry): string | { absolute: string } {
  return entry === 'retail' ? { absolute: `${title} · Buzzify` } : title;
}
