import { NextResponse, type NextRequest } from 'next/server';
import { hostEnv } from '@/server/env';
import { CORE_GATE_COOKIE, coreGateToken, hasCoreGate } from '@/server/http/core-gate';
import { routeHost } from '@/server/http/hosts';
import { REQUEST_PATH_HEADER } from '@/server/http/request-path';

/**
 * Host routing for the one deployment that serves public menus and the Studio (`routeHost` has the rules). It runs
 * before every page and API request, so it reads only the request and the cached environment: no database, no
 * network. A request it lets through carries its path in `REQUEST_PATH_HEADER`, for the 404 page's link back.
 */
export function proxy(request: NextRequest) {
  const { publicHost, studioHost, pharmacyHost, coreHost, coreGatePath, apexHost, legacyHosts, rootRedirect } = hostEnv();
  const host = request.headers.get('host') ?? '';
  // The super admin host opens only for a request that carries the cookie its secret path hands out. Without an auth
  // secret to sign it with, nothing can open it.
  const authSecret = process.env.BETTER_AUTH_SECRET ?? '';
  const coreGate =
    !!coreGatePath && !!authSecret && hasCoreGate(request.cookies.get(CORE_GATE_COOKIE)?.value, coreGatePath, authSecret);
  const decision = routeHost(
    { host, pathname: request.nextUrl.pathname, search: request.nextUrl.search, coreGate },
    { publicHost, studioHost, pharmacyHost, coreHost, coreGatePath, apexHost, legacyHosts, rootRedirect, production: process.env.NODE_ENV === 'production' },
  );

  switch (decision.action) {
    case 'redirect':
      return NextResponse.redirect(new URL(decision.to, request.url));
    case 'knock': {
      if (!coreGatePath || !authSecret) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
      const response = NextResponse.redirect(new URL(decision.to, request.url));
      response.cookies.set(CORE_GATE_COOKIE, coreGateToken(coreGatePath, authSecret), {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 30,
      });
      return response;
    }
    case 'notFound':
      return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    case 'next': {
      // `set`, not `append`: whatever the browser sent under this name is replaced.
      const headers = new Headers(request.headers);
      headers.set(REQUEST_PATH_HEADER, request.nextUrl.pathname);
      const response = NextResponse.next({ request: { headers } });
      // Only the menu host is for search engines; the Studio, till, pharmacy and super admin hosts are not.
      if (!publicHost || host.trim().toLowerCase().replace(/:\d+$/, '') !== publicHost.replace(/:\d+$/, '')) {
        response.headers.set('X-Robots-Tag', 'noindex, nofollow');
      }
      return response;
    }
  }
}

export const config = {
  // Everything except Next's static files and image optimizer, and files with an extension (fonts, images) outside the
  // Studio, till and pharmacy. A dotted path under those (`/studio/restaurants/x.y`) still goes through `routeHost`,
  // or the menu host would answer it from the Studio's catch-all routes.
  matcher: ['/((?!_next/static|_next/image|(?!(?:studio|pos|pharmacy|api)(?:/|$)).*\\.[a-z0-9]+$).*)'],
};
