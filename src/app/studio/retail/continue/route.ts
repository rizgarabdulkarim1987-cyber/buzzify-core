import { continueRoute } from '@/server/retail/handoff-http';

export const dynamic = 'force-dynamic';

/**
 * `GET /studio/retail/continue`: where sign-in returns to when Buzzify Retail's handoff found no session. A Route Handler
 * with fixed segments, so it wins over the `(studio)/[...rest]` catch-all (src/server/retail/handoff-http.ts).
 */
export function GET(request: Request): Promise<Response> {
  return continueRoute(request);
}
