import type { Locale } from '@/lib/locale';

/**
 * The canonical address of a public page and its translations (`<link rel="canonical">` and `hreflang`). `path` is
 * the page's path below `/{slug}/{locale}`: `''` for the menu, `/p/espresso` for a product. Only the menu's home and
 * its product pages name their translations; every other page names just its canonical (`menuCanonical`).
 */
export function menuAlternates(
  origin: string,
  tenant: { slug: string; locales: Locale[] },
  locale: Locale,
  path = '',
): { canonical: string; languages: Record<string, string> } {
  const address = (language: Locale) => `${origin}/${tenant.slug}/${language}${path}`;
  return {
    canonical: address(locale),
    languages: Object.fromEntries(tenant.locales.map((language) => [language, address(language)])),
  };
}

/**
 * The canonical address alone: the menu's home in this language. What the pages that are not indexed in their own
 * right (a table's entry, the cart, explore) name, so search engines fold them into the menu. They list no
 * translations: each `hreflang` link costs bytes in the head and again in the page's payload, and the table's entry
 * page, which a diner opens from a QR code on a phone, has to arrive in the first round trip.
 */
export function menuCanonical(origin: string, tenant: { slug: string }, locale: Locale): { canonical: string } {
  return { canonical: `${origin}/${tenant.slug}/${locale}` };
}
