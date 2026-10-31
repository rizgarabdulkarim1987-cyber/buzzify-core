import { recordEvents } from '@/server/data/events';
import { getPrisma } from '@/server/data/prisma';
import { countProductViews } from '@/server/data/product-views';
import { clientIp } from '@/server/http/client-ip';
import { hashAddress, newGuestKey, readGuestKey } from '@/server/http/guest-cookie';
import { MAX_VIEWS_PER_REQUEST } from '@/server/domain/dish-counts';
import { handleTenantRequest } from '@/server/http/route';
import { eventsRequestSchema } from '@/server/http/schemas';

export async function POST(request: Request, ctx: { params: Promise<{ tenant: string }> }) {
  return handleTenantRequest(
    request,
    ctx,
    { schema: eventsRequestSchema, route: 'events', limit: 120 },
    async ({ tenant, input, now }) => {
      await recordEvents(getPrisma(), tenant.id, input);
      // The first dishes only: one request never makes more than a handful of writes, whatever it names.
      const opened = [...new Set(input.events.flatMap((event) => (event.type === 'PRODUCT_VIEW' && event.productId ? [event.productId] : [])))].slice(0, MAX_VIEWS_PER_REQUEST);
      const headers = new Headers();
      if (opened.length > 0) {
        // A guest without a valid signed key gets one; the address's own count still caps what new keys can do.
        const existing = readGuestKey(request.headers);
        const fresh = existing === null ? newGuestKey() : null;
        // The address the nearest proxy saw, never the first entry: that one is whatever the caller wrote.
        const address = clientIp(request.headers) || 'unknown';
        await countProductViews(getPrisma(), {
          menuId: tenant.id,
          timeZone: tenant.timeZone,
          guestKey: existing ?? (fresh as { key: string }).key,
          ipHash: hashAddress(address, tenant.id),
          userAgent: request.headers.get('user-agent'),
          productIds: opened,
          now,
        });
        if (fresh) headers.append('set-cookie', fresh.setCookie);
      }
      return new Response(null, { status: 204, headers });
    },
  );
}
