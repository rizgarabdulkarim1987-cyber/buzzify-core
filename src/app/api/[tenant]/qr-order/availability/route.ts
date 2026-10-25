import { getPrisma } from '@/server/data/prisma';
import { handleTenantGet } from '@/server/http/route';
import { qrOrderGate } from '@/server/pos/customer-orders-guest';

const TABLE = /^\d{1,3}$/;

/** Whether the guest at this table may order from the Menu. The same answer for every reason it may not. */
export async function GET(request: Request, ctx: { params: Promise<{ tenant: string }> }) {
  return handleTenantGet(request, ctx, { route: 'qr-order-availability', limit: 60 }, async ({ tenant, now }) => {
    const table = new URL(request.url).searchParams.get('table') ?? '';
    const gate = TABLE.test(table) ? await qrOrderGate(getPrisma(), tenant, Number(table), now) : { open: false as const };
    return Response.json({ available: gate.open }, { headers: { 'cache-control': 'no-store' } });
  });
}
