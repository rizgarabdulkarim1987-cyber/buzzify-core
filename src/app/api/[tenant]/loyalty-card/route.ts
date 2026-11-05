import { getPrisma } from '@/server/data/prisma';
import { handleTenantGet, problem } from '@/server/http/route';
import { basketToken } from '@/server/http/schemas';
import { QrGateClosed } from '@/server/pos/customer-orders-guest';
import { readCard } from '@/server/pos/loyalty';

const TABLE = /^\d{1,3}$/;

/** The guest's stamp card at a table where ordering is open. The token comes in a header, never the address; a plan or restaurant without the program answers 404. */
export async function GET(request: Request, ctx: { params: Promise<{ tenant: string }> }) {
  return handleTenantGet(request, ctx, { route: 'loyalty-card', limit: 120 }, async ({ tenant, now }) => {
    const table = new URL(request.url).searchParams.get('table') ?? '';
    const token = basketToken.safeParse(request.headers.get('x-card-token') ?? '');
    if (!TABLE.test(table) || !token.success) return problem(400, 'INVALID_REQUEST', 'A table and a card token are needed');
    try {
      const card = await readCard(getPrisma(), tenant, { table: Number(table), token: token.data }, now);
      return Response.json(card, { headers: { 'cache-control': 'no-store' } });
    } catch (error) {
      if (error instanceof QrGateClosed) return problem(404, 'NOT_FOUND', 'Not found');
      throw error;
    }
  });
}
