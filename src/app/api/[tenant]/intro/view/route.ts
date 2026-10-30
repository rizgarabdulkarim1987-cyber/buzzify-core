import { z } from 'zod';
import { countAdvert } from '@/server/data/advert-stats';
import { handleTenantRequest } from '@/server/http/route';

const schema = z.strictObject({ advertId: z.string().min(1).max(64) });

/** An advert card on the intro page was seen (sent once per advert per page load by the card itself). Counts only; answers 204 whatever it did. */
export async function POST(request: Request, ctx: { params: Promise<{ tenant: string }> }) {
  return handleTenantRequest(request, ctx, { schema, route: 'intro-view', limit: 120 }, async ({ tenant, input, now }) => {
    await countAdvert(tenant, input.advertId, 'view', now);
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  });
}
