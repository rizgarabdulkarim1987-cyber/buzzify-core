/**
 * Menu slugs: the permanent part of a public URL (`/{slug}/{locale}/...`). Lowercase Latin letters and digits in
 * groups joined by single hyphens, 3 to 48 characters, unique across the platform (history included).
 */
export const SLUG_MIN = 3;
export const SLUG_MAX = 48;

/**
 * Words that would collide with the platform's own paths and hosts. A platform setting adds more at runtime
 * (`validateSlug`'s second argument). `auth` is here because `/api/auth/*` is the sign-in handler's: a menu with that
 * slug would have its public API (`/api/auth/quote`) taken by it, and answered 404 by the proxy on the public host.
 */
export const RESERVED_SLUGS: readonly string[] = [
  'studio',
  'pos',
  'pharmacy',
  'api',
  'auth',
  'admin',
  'www',
  'menu',
  'media',
  'app',
  'help',
  'login',
  'assets',
  'static',
  '_next',
];

const SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Turns whatever was typed into slug syntax: trims, lowercases, makes spaces and underscores hyphens, strips Latin
 * accents (so "Café" becomes "cafe"), drops every other character and tidies the hyphens. Text with no Latin
 * letters or digits (Arabic, Sorani) comes out empty.
 */
export function normalizeSlugInput(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^a-z0-9-]+/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

export type SlugProblem = 'TOO_SHORT' | 'TOO_LONG' | 'BAD_CHARACTERS' | 'RESERVED';

/** Whether a slug may be used. `extraReserved` adds the platform setting's words to `RESERVED_SLUGS`. */
export function validateSlug(slug: string, extraReserved: readonly string[]): { ok: true } | { ok: false; reason: SlugProblem } {
  if (slug.length < SLUG_MIN) return { ok: false, reason: 'TOO_SHORT' };
  if (slug.length > SLUG_MAX) return { ok: false, reason: 'TOO_LONG' };
  if (!SHAPE.test(slug)) return { ok: false, reason: 'BAD_CHARACTERS' };
  if (RESERVED_SLUGS.includes(slug) || extraReserved.includes(slug)) return { ok: false, reason: 'RESERVED' };
  return { ok: true };
}

/**
 * A slug to offer for a restaurant or menu name: the name in slug syntax, cut to the length limit, or `fallback`
 * when the name has fewer than three Latin letters or digits (an Arabic name, say). The result is a candidate;
 * callers still check availability and reserved words with `validateSlug`.
 */
export function suggestSlug(name: string, fallback: string): string {
  const suggestion = normalizeSlugInput(name).slice(0, SLUG_MAX).replace(/-+$/, '');
  return suggestion.length < SLUG_MIN ? fallback : suggestion;
}
