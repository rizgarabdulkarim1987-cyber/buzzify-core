import { getPrisma } from '@/server/data/prisma';
import { handleTenantGet, problem } from '@/server/http/route';
import { readGuestRequest } from '@/server/pos/customer-orders-guest';

const TABLE = /^\d{1,3}$/;
const PUBLIC_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** The state of a guest's own request: the id from the submission and the table it was sent from are both needed. */
export async function GET(request: Request, ctx: { params: Promise<{ tenant: string; publicId: string }> }) {
  const { publicId } = await ctx.params;
  return handleTenantGet(request, ctx, { route: 'qr-order-status', limit: 600 }, async ({ tenant, now }) => {
    const table = new URL(request.url).searchParams.get('table') ?? '';
    if (!TABLE.test(table) || !PUBLIC_ID.test(publicId)) return problem(404, 'NOT_FOUND', 'Not found');
    const view = await readGuestRequest(getPrisma(), tenant, Number(table), publicId, now);
    if (!view) return problem(404, 'NOT_FOUND', 'Not found');
    return Response.json(view, { headers: { 'cache-control': 'no-store' } });
  });
}
