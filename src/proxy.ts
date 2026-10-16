import { NextResponse, type NextRequest } from 'next/server';
import { hostEnv } from '@/server/env';
import { routeHost } from '@/server/http/hosts';

/**
 * Host routing for the one deployment that serves public menus and the Studio (`routeHost` has the rules). It runs
 * before every page and API request, so it reads only the request and the cached environment: no database, no
 * network.
 */
export function proxy(request: NextRequest) {
  const { publicHost, studioHost, rootRedirect } = hostEnv();
  const decision = routeHost(
    { host: request.headers.get('host') ?? '', pathname: request.nextUrl.pathname },
    { publicHost, studioHost, rootRedirect },
  );

  switch (decision.action) {
    case 'redirect':
      return NextResponse.redirect(new URL(decision.to, request.url));
    case 'notFound':
      return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    case 'next':
      return NextResponse.next();
  }
}

export const config = {
  // Everything except Next's static files and image optimizer, and files with an extension (fonts, images).
  matcher: ['/((?!_next/static|_next/image|.*\\..*).*)'],
};
