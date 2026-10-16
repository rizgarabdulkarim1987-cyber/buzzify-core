import { getAuth } from '@/server/studio/auth/auth';
import { isPublicAuthRequest } from '@/server/studio/auth/http';

/**
 * The few Better Auth routes the Studio serves over HTTP (`isPublicAuthRequest` lists them and says why); anything else
 * is a 404. The instance is built when the first request arrives, not when the file is loaded, so building the
 * application reads no sign-in configuration. Only the Studio host serves this path (see `routeHost`).
 */
export const dynamic = 'force-dynamic';

async function handle(request: Request): Promise<Response> {
  if (!isPublicAuthRequest(request.method, request.url)) {
    return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' } });
  }
  return getAuth().handler(request);
}

export const GET = handle;
export const POST = handle;
