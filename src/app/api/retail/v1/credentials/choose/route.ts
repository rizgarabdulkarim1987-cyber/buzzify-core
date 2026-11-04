import { chooseInput, chooseStep, credentialsRoute } from '@/server/retail/credentials';

export const dynamic = 'force-dynamic';

/**
 * `POST /api/retail/v1/credentials/choose` `{ challenge, shopId, clientIp, nonce }`, signed by Buzzify Retail: an owner
 * of several shops picks the one to open after signing in on Retails' own form (src/server/retail/credentials.ts).
 */
export function POST(request: Request): Promise<Response> {
  return credentialsRoute(request, 'choose', chooseInput, chooseStep);
}
