import { getCatalog } from '@/server/data/public-menu';
import { getPrisma } from '@/server/data/prisma';
import { handleTenantRequest, problem } from '@/server/http/route';
import { basketSendSchema } from '@/server/http/schemas';
import { BasketRefusal, QrGateClosed, QrOrderRefusal, sendBasket } from '@/server/pos/table-basket';

/** One guest sends the whole table's basket to the cashier as a single order request. */
export async function POST(request: Request, ctx: { params: Promise<{ tenant: string }> }) {
  return handleTenantRequest(request, ctx, { schema: basketSendSchema, route: 'table-basket-send', limit: 10 }, async ({ tenant, input, now }) => {
    try {
      const catalog = await getCatalog(tenant);
      const { publicId } = await sendBasket(getPrisma(), tenant, catalog, input, now);
      return Response.json({ publicId }, { status: 201, headers: { 'cache-control': 'no-store' } });
    } catch (error) {
      if (error instanceof QrGateClosed) return problem(404, 'NOT_FOUND', 'Not found');
      if (error instanceof QrOrderRefusal) {
        if (error.code === 'TOO_MANY_REQUESTS') return problem(429, error.code, 'Too many orders from this table', { 'Retry-After': '60' });
        return problem(400, error.code, 'The order cannot be sent');
      }
      if (error instanceof BasketRefusal) return problem(400, error.code, 'The basket cannot be sent');
      throw error;
    }
  });
}
