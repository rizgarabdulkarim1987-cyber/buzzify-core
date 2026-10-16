import { getCatalog } from '@/server/data/public-menu';
import { describeQuote } from '@/server/data/quote-view';
import { quoteCart } from '@/server/domain';
import { handleTenantRequest } from '@/server/http/route';
import { quoteRequestSchema } from '@/server/http/schemas';

export async function POST(request: Request, ctx: { params: Promise<{ tenant: string }> }) {
  return handleTenantRequest(
    request,
    ctx,
    { schema: quoteRequestSchema, route: 'quote', limit: 60 },
    async ({ tenant, input, now }) => {
      const catalog = await getCatalog(tenant);
      const quote = quoteCart(catalog, input.cart, now);
      return Response.json({ quote: describeQuote(catalog, quote, input.locale) });
    },
  );
}
