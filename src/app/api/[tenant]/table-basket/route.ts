import { getCatalog } from '@/server/data/public-menu';
import { getPrisma } from '@/server/data/prisma';
import { handleTenantGet, handleTenantRequest, problem } from '@/server/http/route';
import { basketPartSchema, basketToken } from '@/server/http/schemas';
import { BasketRefusal, QrGateClosed, readBasket, writePart } from '@/server/pos/table-basket';

const TABLE = /^\d{1,3}$/;
const NO_STORE = { 'cache-control': 'no-store' };

function refusal(error: unknown): Response {
  if (error instanceof QrGateClosed) return problem(404, 'NOT_FOUND', 'Not found');
  if (error instanceof BasketRefusal) {
    if (error.code === 'TOO_MANY_GUESTS' || error.code === 'TOO_MANY_LINES') return problem(409, error.code, 'The table basket is full');
    return problem(400, error.code, 'The basket cannot be changed');
  }
  throw error;
}

/** The table's live basket for one guest. The guest's token comes in a header, never the address. */
export async function GET(request: Request, ctx: { params: Promise<{ tenant: string }> }) {
  return handleTenantGet(request, ctx, { route: 'table-basket-read', limit: 600 }, async ({ tenant, now }) => {
    const table = new URL(request.url).searchParams.get('table') ?? '';
    const token = basketToken.safeParse(request.headers.get('x-basket-token') ?? '');
    if (!TABLE.test(table) || !token.success) return problem(400, 'INVALID_REQUEST', 'A table and a basket token are needed');
    try {
      const view = await readBasket(getPrisma(), tenant, await getCatalog(tenant), { table: Number(table), token: token.data }, now);
      return Response.json(view, { headers: NO_STORE });
    } catch (error) {
      return refusal(error);
    }
  });
}

/** A guest replaces their own part of the basket; no lines removes it. */
export async function PUT(request: Request, ctx: { params: Promise<{ tenant: string }> }) {
  return handleTenantRequest(request, ctx, { schema: basketPartSchema, route: 'table-basket-write', limit: 120 }, async ({ tenant, input, now }) => {
    try {
      await writePart(getPrisma(), tenant, await getCatalog(tenant), input, now);
      return new Response(null, { status: 204, headers: NO_STORE });
    } catch (error) {
      return refusal(error);
    }
  });
}
