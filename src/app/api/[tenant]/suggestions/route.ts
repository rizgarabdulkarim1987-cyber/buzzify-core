import { getCatalog } from '@/server/data/public-menu';
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
      const catalog = await getCatalog(tenant);
      const built = buildSuggestions(catalog, input, now, tenant.engineConfig);
      // Without smart selling no offer of any kind reaches guests, the ones from suggested options and bigger sizes
      // included (spec: plans and entitlements, 4.1); the signature dish is in every plan.
      const response = tenant.features.smartSelling ? built : { ...built, upgrades: [], pairings: [], bundles: [] };
      return Response.json(describeSuggestions(catalog, response, input.locale, input.cart));
    },
  );
}
