import { credentialsRoute, passwordInput, passwordStep } from '@/server/retail/credentials';

export const dynamic = 'force-dynamic';

/**
 * `POST /api/retail/v1/credentials` `{ email, password, clientIp, nonce, userAgent? }`, signed by Buzzify Retail: its own
 * sign-in form's email and password, checked like the Studio's sign-in (src/server/retail/credentials.ts). Keep request
 * bodies of this path out of every log: the password travels in them.
 */
export function POST(request: Request): Promise<Response> {
  return credentialsRoute(request, 'password', passwordInput, passwordStep);
}
