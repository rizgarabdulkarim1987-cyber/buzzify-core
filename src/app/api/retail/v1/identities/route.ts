import { getPrisma } from '@/server/data/prisma';
import { ensureIdentity, identityInput } from '@/server/retail/identities';
import { admitRetailCall, rateLimited, retailJson, retailRefusal } from '@/server/retail/inbound';
import { normalizeEmail } from '@/server/studio/auth/users';
import { checkRateLimit, RATE_RULES } from '@/server/studio/auth/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * `POST /api/retail/v1/identities` `{ email, name? }`, signed by Buzzify Retail: the Studio account for a staff email,
 * `{ coreUserId, created, emailVerified }` (src/server/retail/identities.ts). The signature is checked before the body
 * is parsed, and the calling address and the email are each counted before anything is written: an account can be
 * made here for any address.
 */
export async function POST(request: Request): Promise<Response> {
  const prisma = getPrisma();
  try {
    const now = new Date();
    const admitted = await admitRetailCall(prisma, request, now);
    if (!admitted.ok) return admitted.response;

    let json: unknown;
    try {
      json = JSON.parse(admitted.body);
    } catch {
      return retailRefusal(400, 'INVALID_INPUT');
    }
    const parsed = identityInput.safeParse(json);
    if (!parsed.success) return retailRefusal(400, 'INVALID_INPUT');

    for (const [key, rule] of [
      [`retail-identity:ip:${admitted.ip}`, RATE_RULES['retail-identity:ip']],
      [`retail-identity:email:${normalizeEmail(parsed.data.email)}`, RATE_RULES['retail-identity:email']],
    ] as const) {
      const verdict = await checkRateLimit(prisma, key, rule, now);
      if (!verdict.allowed) return rateLimited(verdict.retryAfterSec);
    }

    return retailJson(await ensureIdentity(prisma, parsed.data, now));
  } catch (error) {
    // The error's name only: never the address.
    console.error(`[retail.identities] ${error instanceof Error ? error.name : 'unknown error'}`);
    return retailRefusal(503, 'UNAVAILABLE');
  }
}
