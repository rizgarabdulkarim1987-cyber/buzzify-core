import { getPrisma } from '@/server/data/prisma';
import { COMPLAINT_LIMITS, COMPLAINT_TEXT_MAX, cleanGuestText, hasContent } from '@/server/domain/pos/complaint-rules';
import { handleTenantRequest, problem } from '@/server/http/route';
import { complaintSchema } from '@/server/http/schemas';
import { ComplaintGateClosed, ComplaintTooMany, submitComplaint } from '@/server/pos/complaints-guest';

/**
 * A guest tells the restaurant what went wrong, from the table's own page. No sign-in; only text is read. The honeypot answers
 * as accepted without storing, a contact needs the guest's consent, and the same key sent twice is one complaint.
 */
export async function POST(request: Request, ctx: { params: Promise<{ tenant: string }> }) {
  return handleTenantRequest(
    request,
    ctx,
    { schema: complaintSchema, route: 'complaint', limit: COMPLAINT_LIMITS.perIpPerMinute },
    async ({ tenant, input, now }) => {
      if (input.website !== '') return Response.json({ ok: true }, { status: 201, headers: { 'cache-control': 'no-store' } });
      const body = cleanGuestText(input.body).trim();
      if (!hasContent(body) || [...body].length > COMPLAINT_TEXT_MAX) return problem(400, 'INVALID_REQUEST', 'body: Write what happened');
      const contactName = input.contactName ? cleanGuestText(input.contactName).replace(/\s+/g, ' ').trim() : '';
      const contactPhone = input.contactPhone ?? '';
      if ((contactName || contactPhone) && !input.consent) return problem(400, 'CONSENT_REQUIRED', 'Agree to be contacted to leave a name or phone');
      try {
        await submitComplaint(
          getPrisma(),
          tenant,
          {
            table: input.table ?? null,
            locale: input.locale,
            clientKey: input.clientKey,
            body,
            ...(input.category ? { category: input.category } : {}),
            ...(contactName ? { contactName } : {}),
            ...(contactPhone ? { contactPhone } : {}),
          },
          now,
        );
        return Response.json({ ok: true }, { status: 201, headers: { 'cache-control': 'no-store' } });
      } catch (error) {
        if (error instanceof ComplaintGateClosed) return problem(404, 'NOT_FOUND', 'Not found');
        if (error instanceof ComplaintTooMany) return problem(429, 'TOO_MANY_REQUESTS', 'Too many complaints from this table', { 'Retry-After': '600' });
        throw error;
      }
    },
  );
}
