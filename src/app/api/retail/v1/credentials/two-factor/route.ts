import { credentialsRoute, twoFactorInput, twoFactorStep } from '@/server/retail/credentials';

export const dynamic = 'force-dynamic';

/**
 * `POST /api/retail/v1/credentials/two-factor` `{ challenge, code, clientIp, nonce, userAgent? }`, signed by Buzzify
 * Retail: the second step of its own sign-in form (src/server/retail/credentials.ts).
 */
export function POST(request: Request): Promise<Response> {
  return credentialsRoute(request, 'two-factor', twoFactorInput, twoFactorStep);
}
