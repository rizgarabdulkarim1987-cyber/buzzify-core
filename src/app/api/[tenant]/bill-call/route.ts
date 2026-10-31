import { z } from 'zod';
import { getPrisma } from '@/server/data/prisma';
import { QR_LIMITS } from '@/server/domain/pos/customer-order-rules';
import { handleTenantRequest, problem } from '@/server/http/route';
import { callForBill } from '@/server/pos/bill-calls';
import { QrGateClosed, QrOrderRefusal } from '@/server/pos/customer-orders-guest';

const billCallSchema = z.strictObject({ table: z.number().int().min(1).max(999) });

/** A guest at a table asks for the bill. Nothing but the table number is read. */
export async function POST(request: Request, ctx: { params: Promise<{ tenant: string }> }) {
  return handleTenantRequest(request, ctx, { schema: billCallSchema, route: 'bill-call', limit: QR_LIMITS.perIpPerMinute }, async ({ tenant, input, now }) => {
    try {
      await callForBill(getPrisma(), tenant, { table: input.table }, now);
      return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
    } catch (error) {
      if (error instanceof QrGateClosed) return problem(404, 'NOT_FOUND', 'Not found');
      if (error instanceof QrOrderRefusal) return problem(429, error.code, 'Too many calls from this table', { 'Retry-After': '60' });
      throw error;
    }
  });
}
