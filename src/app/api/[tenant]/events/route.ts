import { recordEvents } from '@/server/data/events';
import { getPrisma } from '@/server/data/prisma';
import { handleTenantRequest } from '@/server/http/route';
import { eventsRequestSchema } from '@/server/http/schemas';

export async function POST(request: Request, ctx: { params: Promise<{ tenant: string }> }) {
  return handleTenantRequest(
    request,
    ctx,
    { schema: eventsRequestSchema, route: 'events', limit: 120 },
    async ({ tenant, input }) => {
      await recordEvents(getPrisma(), tenant.id, input);
      return new Response(null, { status: 204 });
    },
  );
}
