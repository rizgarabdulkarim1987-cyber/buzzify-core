import type { Locale } from '@/lib/locale';

/**
 * The canonical address of a public page and its translations (`<link rel="canonical">` and `hreflang`). `path` is
 * the page's path below `/{slug}/{locale}`: `''` for the menu, `/p/espresso` for a product.
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
