import type { Locale } from '@/lib/locale';
import { resolvePublicMenu } from '@/server/data/public-menu';
import { pickLocale } from '@/server/domain/locale-negotiation';

const TABLE_PATH = /^\/t\/(\d{1,3})$/;

/**
 * Where a language-less address goes. With the intro on, every scan meets it: the plain `/{slug}` and a table's `/{slug}/t/{table}` both go
 * to `/{slug}/intro`, the table riding along as `?table=` so the language buttons lead on to that table. A remembered language does not skip
 * it. Otherwise it goes to the menu in the visitor's language, under the same path and query.
 */
export function entryTarget(args: { slug: string; subpath: string; search: string; locale: Locale; intro: boolean }): string {
  const { slug, subpath, search, locale, intro } = args;
  const table = TABLE_PATH.exec(subpath)?.[1];
  if (intro && (subpath === '' || (table !== undefined && Number(table) >= 1))) {
    const query = new URLSearchParams(search);
    query.delete('table');
    if (table !== undefined) query.set('table', table);
    const text = query.toString();
    return `/${slug}/intro${text ? `?${text}` : ''}`;
  }
  return `/${slug}/${locale}${subpath}${search}`;
}

/**
 * Sends a language-less menu address (`/{slug}`, `/{slug}/t/{table}`) on: to the intro when the menu has it on (see `entryTarget`),
 * else to the menu in the visitor's best language, under the menu's current slug, with the query string kept. 307, not 308: the
 * destination depends on the visitor, so it is not permanent. A suspended menu stays on the slug that was asked for, where the
 * neutral page answers; an unknown one is a 404.
 */
export async function redirectToMenu(request: Request, slug: string, subpath: string): Promise<Response> {
  const menu = await resolvePublicMenu(slug);
  if (menu.kind === 'missing') return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });

  const current = menu.kind === 'redirect' ? menu.slug : slug;
  const offered = menu.kind === 'unavailable' ? menu : menu.tenant;
  const locale = pickLocale(request.headers.get('accept-language'), offered.locales, offered.defaultLocale);
  const intro = menu.kind !== 'unavailable' && menu.tenant.extras.intro;

  return new Response(null, {
    status: 307,
    // Relative, so it needs no knowledge of the public host. It depends on the language header, so caches must too.
    headers: { location: entryTarget({ slug: current, subpath, search: new URL(request.url).search, locale, intro }), vary: 'accept-language' },
  });
}
