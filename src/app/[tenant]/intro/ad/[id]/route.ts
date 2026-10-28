import { countAdvert } from '@/server/data/advert-stats';
import { handleTenantGet, problem } from '@/server/http/route';

/**
 * A click on an advert: counted here, then sent on to the address saved on the advert. The address comes from the database, never from
 * the request, so this cannot be used to send a visitor anywhere else.
 */
export async function GET(request: Request, ctx: { params: Promise<{ tenant: string; id: string }> }) {
  const { id } = await ctx.params;
  return handleTenantGet(request, ctx, { route: 'intro-ad', limit: 60 }, async ({ tenant, now }) => {
    const counted = await countAdvert(tenant, id, 'click', now);
    if (!counted) return problem(404, 'NOT_FOUND', 'Not found', { 'cache-control': 'no-store' });
    return new Response(null, { status: 307, headers: { location: counted.href, 'cache-control': 'no-store' } });
  });
}
