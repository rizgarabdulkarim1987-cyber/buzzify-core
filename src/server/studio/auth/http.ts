const PREFIX = '/api/auth';

/**
 * The Better Auth routes the Studio serves over HTTP, with the one method each answers to:
 *
 * - `/verify-email`: the link in an email-change message. A person follows it from a mail client.
 * - `/sign-out`: ends the session in the browser.
 * - `/ok` and `/error`: Better Auth's health check and its error page.
 *
 * Every other route is closed, including every route Better Auth has today (sign-in, password reset, password change,
 * two-factor, session lists) and any it adds later. Those flows run in Server Actions that call `auth.api.*` directly,
 * after the Studio's own per-account rate limits and password policy. Left open, the same routes would be reachable
 * with only Better Auth's per-IP limits and length check, so a guessed password could be tried from many addresses and
 * a reset could set a password from the common list.
 */
const PUBLIC_ROUTES: Readonly<Record<string, 'GET' | 'POST'>> = {
  '/verify-email': 'GET',
  '/sign-out': 'POST',
  '/ok': 'GET',
  '/error': 'GET',
};

/**
 * Whether the route may be served over HTTP. The path must match exactly: a trailing slash, a doubled slash or a
 * different case is not the route (and dot segments, even percent-encoded, are resolved by URL parsing first, so
 * `/ok/../sign-in/email` is read as `/sign-in/email`).
 */
export function isPublicAuthRequest(method: string, url: string): boolean {
  if (!URL.canParse(url)) return false;
  const { pathname } = new URL(url);
  if (!pathname.startsWith(`${PREFIX}/`)) return false;
  const route = pathname.slice(PREFIX.length);
  return Object.hasOwn(PUBLIC_ROUTES, route) && PUBLIC_ROUTES[route] === method.toUpperCase();
}
