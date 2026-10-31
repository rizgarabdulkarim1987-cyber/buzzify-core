import { getCatalog } from '@/server/data/public-menu';
import { getPrisma } from '@/server/data/prisma';
import { handleTenantRequest, problem } from '@/server/http/route';
import { qrOrderSchema } from '@/server/http/schemas';
import { QR_LIMITS } from '@/server/domain/pos/customer-order-rules';
import { QrGateClosed, QrOrderRefusal, submitCustomerOrder } from '@/server/pos/customer-orders-guest';

/** A guest sends the cart of their table to the cashier. Only ids, quantities and notes are read; prices are the Menu's. */
export async function POST(request: Request, ctx: { params: Promise<{ tenant: string }> }) {
  return handleTenantRequest(
    request,
    ctx,
    { schema: qrOrderSchema, route: 'qr-order', limit: QR_LIMITS.perIpPerMinute },
    async ({ tenant, input, now }) => {
      try {
        const catalog = await getCatalog(tenant);
        const { publicId } = await submitCustomerOrder(
          getPrisma(),
          tenant,
          catalog,
          {
            table: input.table,
            locale: input.locale,
            lines: input.cart.lines,
            bundleCount: input.cart.bundles.length,
            note: input.note,
            ...(input.card ? { card: input.card } : {}),
          },
          now,
        );
        return Response.json({ publicId }, { status: 201, headers: { 'cache-control': 'no-store' } });
      } catch (error) {
        if (error instanceof QrGateClosed) return problem(404, 'NOT_FOUND', 'Not found');
        if (error instanceof QrOrderRefusal) {
          if (error.code === 'TOO_MANY_REQUESTS') return problem(429, error.code, 'Too many orders from this table', { 'Retry-After': '60' });
          return problem(400, error.code, 'The order cannot be sent');
        }
        throw error;
      }
    },
  );
}
