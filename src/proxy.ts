import { NextResponse, type NextRequest } from 'next/server';
import { hostEnv } from '@/server/env';
import { routeHost } from '@/server/http/hosts';
import { REQUEST_PATH_HEADER } from '@/server/http/request-path';

/**
 * Host routing for the one deployment that serves public menus and the Studio (`routeHost` has the rules). It runs
 * before every page and API request, so it reads only the request and the cached environment: no database, no
 * network. A request it lets through carries its path in `REQUEST_PATH_HEADER`, for the 404 page's link back.
 */
export function proxy(request: NextRequest) {
  const { publicHost, studioHost, rootRedirect } = hostEnv();
  const decision = routeHost(
    { host: request.headers.get('host') ?? '', pathname: request.nextUrl.pathname, search: request.nextUrl.search },
    { publicHost, studioHost, rootRedirect, production: process.env.NODE_ENV === 'production' },
  );

  switch (decision.action) {
    case 'redirect':
      return NextResponse.redirect(new URL(decision.to, request.url));
    case 'notFound':
      return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    case 'next': {
      // `set`, not `append`: whatever the browser sent under this name is replaced.
      const headers = new Headers(request.headers);
      headers.set(REQUEST_PATH_HEADER, request.nextUrl.pathname);
      return NextResponse.next({ request: { headers } });
    }
  }
}

export const config = {
  // Everything except Next's static files and image optimizer, and files with an extension (fonts, images) outside the
  // Studio, till and pharmacy. A dotted path under those (`/studio/restaurants/x.y`) still goes through `routeHost`,
  // or the menu host would answer it from the Studio's catch-all routes.
  matcher: ['/((?!_next/static|_next/image|(?!(?:studio|pos|pharmacy|api)(?:/|$)).*\\.[a-z0-9]+$).*)'],
};
