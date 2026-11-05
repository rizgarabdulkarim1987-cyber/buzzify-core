import { openRoute } from '@/server/retail/handoff-http';

export const dynamic = 'force-dynamic';

/**
 * `GET /studio/retail/open/[restaurantId]`: an owner's "Open Retails" for that retail shop; anyone else gets 404
 * (src/server/retail/handoff-http.ts). Its static `retail/open` segments win over the `(studio)/[...rest]` catch-all.
 */
export async function GET(request: Request, context: { params: Promise<{ restaurantId: string }> }): Promise<Response> {
  const { restaurantId } = await context.params;
  return openRoute(request, restaurantId);
}
