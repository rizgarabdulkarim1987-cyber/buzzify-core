import { getCatalog } from '@/server/data/catalog-loader';
import { buildSearchIndex } from '@/server/data/menu-view';
import { handleTenantRequest } from '@/server/http/route';
import { searchIndexRequestSchema } from '@/server/http/schemas';

/**
 * Search text in every language for the products on the menu. The menu page carries only its own language,
 * so the search box fetches this the first time it is used.
 */
export async function POST(request: Request, ctx: { params: Promise<{ tenant: string }> }) {
  return handleTenantRequest(
    request,
    ctx,
    { schema: searchIndexRequestSchema, route: 'search-index', limit: 30 },
    async ({ tenant, now }) => {
      const catalog = await getCatalog(tenant.id);
      return Response.json({ keys: buildSearchIndex(catalog, now) });
    },
  );
}
