import { resolvePublicMenu } from '@/server/data/public-menu';
import { pickLocale } from '@/server/domain/locale-negotiation';

/**
 * Sends a language-less menu address (`/{slug}`, `/{slug}/t/{table}`) to the menu in the visitor's best language,
 * under the menu's current slug, with the query string kept. 307, not 308: the language comes from the visitor's
 * browser, so the destination is not permanent. A suspended menu stays on the slug that was asked for, where the
 * neutral page answers; an unknown one is a 404.
 */
export async function redirectToMenu(request: Request, slug: string, subpath: string): Promise<Response> {
  const menu = await resolvePublicMenu(slug);
  if (menu.kind === 'missing') return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });

  const current = menu.kind === 'redirect' ? menu.slug : slug;
  const offered = menu.kind === 'unavailable' ? menu : menu.tenant;
  const locale = pickLocale(request.headers.get('accept-language'), offered.locales, offered.defaultLocale);

  return new Response(null, {
    status: 307,
    // Relative, so it needs no knowledge of the public host. It depends on the language header, so caches must too.
    headers: { location: `/${current}/${locale}${subpath}${new URL(request.url).search}`, vary: 'accept-language' },
  });
}
