import { handoffRoute } from '@/server/retail/handoff-http';

export const dynamic = 'force-dynamic';

/**
 * `GET /api/retail/v1/handoff?return=&state=&nonce=`: Buzzify Retail's "Sign in with Studio" lands here and leaves with a
 * 60-second token for its callback, or signs in first (src/server/retail/handoff-http.ts). Keep this path's query
 * strings out of access logs: the state travels in them.
 */
export function GET(request: Request): Promise<Response> {
  return handoffRoute(request);
}
