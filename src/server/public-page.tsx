import { notFound, permanentRedirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { isLocale, type Locale } from '@/lib/locale';
import { resolvePublicMenu } from '@/server/data/public-menu';
import { MenuUnavailable } from '@/ui/MenuUnavailable';
import type { RouteContext } from './route-context';

/**
 * What a public page address (`/{tenant}/{locale}/...`) stands for. `live`: render the page. `redirect`: the
 * address uses a former slug; `slug` is the current one. `unavailable`: the menu is suspended or archived; show
 * its name in `locale`. `missing`: no such menu, or not in that language.
 */
export type PublicRoute =
  | { kind: 'live'; route: RouteContext }
  | { kind: 'redirect'; slug: string }
  | { kind: 'unavailable'; name: string; locale: Locale }
  | { kind: 'missing' };

const MISSING: PublicRoute = { kind: 'missing' };

export async function resolvePublicRoute(params: { tenant: string; locale: string }): Promise<PublicRoute> {
  const { locale } = params;
  if (!isLocale(locale)) return MISSING;

  const result = await resolvePublicMenu(params.tenant);
  switch (result.kind) {
    case 'live':
      return result.tenant.locales.includes(locale) ? { kind: 'live', route: { tenant: result.tenant, locale } } : MISSING;
    case 'redirect':
      return result.tenant.locales.includes(locale) ? { kind: 'redirect', slug: result.slug } : MISSING;
    case 'unavailable':
      // The neutral page is shown in the visitor's language when the menu has it, else in the menu's own.
      return { kind: 'unavailable', name: result.name, locale: result.locales.includes(locale) ? locale : result.defaultLocale };
    case 'missing':
      return MISSING;
  }
}

/**
 * Runs a public page for the menu its address names. A live menu renders; a former slug answers a permanent
 * redirect (308) to the same page under the current slug, with the query kept; a suspended or archived menu shows
 * the neutral page; anything else is a 404. `subpath` is the page's path below `/{slug}/{locale}` (`''`,
 * `/cart`, `/p/espresso`) and `search` its query string including the `?` (or `''`).
 */
export async function withPublicMenu(
  params: { tenant: string; locale: string },
  subpath: string,
  search: string,
  render: (route: RouteContext) => Promise<ReactNode>,
): Promise<ReactNode> {
  const resolved = await resolvePublicRoute(params);
  switch (resolved.kind) {
    case 'live':
      return render(resolved.route);
    case 'redirect':
      return permanentRedirect(`/${resolved.slug}/${params.locale}${subpath}${search}`);
    case 'unavailable':
      return <MenuUnavailable name={resolved.name} locale={resolved.locale} />;
    case 'missing':
      return notFound();
  }
}

/** A path segment that could be a menu's slug (the same test the 404 page's link always made). */
const SLUG_SEGMENT = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Where the 404 page's "Back to the menu" leads, from the path the visitor asked for (`REQUEST_PATH_HEADER`, or null
 * when the proxy did not see the request). Inside a live menu: its home in the visitor's language. When the menu did
 * not render (a language it lacks, an unknown language, a paused menu, or no such menu): its entry address `/{slug}`,
 * which picks a language the menu has (or answers 404 again). With no usable slug: `/`. Only these three shapes come
 * out, whatever the path holds.
 */
export async function backToMenuHref(pathname: string | null): Promise<string> {
  const [, tenant = '', locale = ''] = (pathname ?? '').split('/');
  if (!SLUG_SEGMENT.test(tenant)) return '/';
  const resolved = await resolvePublicRoute({ tenant, locale });
  return resolved.kind === 'live' ? `/${resolved.route.tenant.slug}/${resolved.route.locale}` : `/${tenant}`;
}

/** What a page's `searchParams` holds. */
export type SearchParams = Record<string, string | string[] | undefined>;

/** A query string, with its `?`, from a page's `searchParams`; `''` when there is none. */
export function searchString(searchParams: SearchParams): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) for (const item of value) query.append(key, item);
    else if (value !== undefined) query.append(key, value);
  }
  const text = query.toString();
  return text ? `?${text}` : '';
}
