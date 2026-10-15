import { getCatalog } from '@/server/data/catalog-loader';
import { describeSuggestions } from '@/server/data/suggestion-view';
import { buildSuggestions } from '@/server/domain';
import { handleTenantRequest } from '@/server/http/route';
import { suggestionsRequestSchema } from '@/server/http/schemas';

export async function POST(request: Request, ctx: { params: Promise<{ tenant: string }> }) {
  return handleTenantRequest(
    request,
    ctx,
    { schema: suggestionsRequestSchema, route: 'suggestions', limit: 90 },
    async ({ tenant, input, now }) => {
      const catalog = await getCatalog(tenant.id);
      const response = buildSuggestions(catalog, input, now, tenant.engineConfig);
      return Response.json(describeSuggestions(catalog, response, input.locale, input.cart));
    },
  );
}
