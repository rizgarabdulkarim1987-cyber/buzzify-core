import { APIError } from 'better-auth/api';
import { unstable_rethrow } from 'next/navigation';
import { readBodyWithLimit } from '@/server/http/route';
import { getAuth } from '@/server/studio/auth/auth';
import { pinSignInBody } from '@/server/studio/auth/pin-plugin';
import { sameOrigin } from '@/server/studio/framework/route';

/**
 * Quick sign-in on a shared till device. A Route Handler in front of the auth plugin so the Studio's public auth
 * allowlist stays as it is: the PIN endpoint is not reachable under /api/auth. Every answer is uncacheable.
 */

const MAX_BODY_BYTES = 1024;
const NO_STORE = { 'cache-control': 'no-store' };

const refuse = (status: number, code: string, extra: Record<string, unknown> = {}) =>
  Response.json({ error: { code, ...extra } }, { status, headers: NO_STORE });

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return refuse(403, 'FORBIDDEN');
  try {
    const text = await readBodyWithLimit(request, MAX_BODY_BYTES);
    if (text === null) return refuse(413, 'INVALID');
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return refuse(400, 'INVALID');
    }
    const parsed = pinSignInBody.safeParse(body);
    if (!parsed.success) return refuse(400, 'INVALID');
    try {
      const { headers, response } = await getAuth().api.pinSignIn({ body: parsed.data, headers: request.headers, returnHeaders: true });
      const answer = Response.json(response, { headers: NO_STORE });
      for (const cookie of headers.getSetCookie()) answer.headers.append('set-cookie', cookie);
      return answer;
    } catch (error) {
      if (error instanceof APIError) {
        const detail = (error.body ?? {}) as { code?: string; retryAt?: string };
        return refuse(Number(error.statusCode) || 400, detail.code ?? 'INVALID', detail.retryAt ? { retryAt: detail.retryAt } : {});
      }
      throw error;
    }
  } catch (error) {
    unstable_rethrow(error);
    console.error(`[pos] The PIN sign-in route failed with ${error instanceof Error ? error.name : 'an unknown error'}`);
    return refuse(500, 'INVALID');
  }
}
