import { unstable_rethrow } from 'next/navigation';
import { readBodyWithLimit } from '@/server/http/route';
import { DEVICE_COOKIE, deviceCookieOptions } from '@/server/pos/device-cookie';
import { registerPosDevice } from '@/server/studio/actions/pos-pin';
import { invoke } from '@/server/studio/framework/invoke';
import { sameOrigin } from '@/server/studio/framework/route';

/**
 * Registers this browser as a shared till device. A Route Handler because the device secret must go into an HttpOnly
 * cookie and never into the page: the answer carries the device id only. The work is the ordinary `pos.registerDevice`
 * action, so permission, audit and limits are the framework's.
 */

const NO_STORE = { 'cache-control': 'no-store' };

const refuse = (status: number, code: string) => Response.json({ ok: false, error: { code, message: code } }, { status, headers: NO_STORE });

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return refuse(403, 'FORBIDDEN');
  try {
    const text = await readBodyWithLimit(request, 1024);
    let body: unknown;
    try {
      body = text === null ? undefined : JSON.parse(text);
    } catch {
      return refuse(400, 'INVALID');
    }
    const result = await invoke(registerPosDevice, body);
    if (!result.ok) return Response.json(result, { headers: NO_STORE });
    const answer = Response.json({ ok: true, data: { deviceId: result.data.deviceId } }, { headers: NO_STORE });
    const { maxAge, sameSite, httpOnly, secure, path } = deviceCookieOptions();
    answer.headers.append(
      'set-cookie',
      `${DEVICE_COOKIE}=${result.data.token}; Path=${path}; Max-Age=${maxAge}; SameSite=${sameSite === 'lax' ? 'Lax' : sameSite}${httpOnly ? '; HttpOnly' : ''}${secure ? '; Secure' : ''}`,
    );
    return answer;
  } catch (error) {
    unstable_rethrow(error);
    console.error(`[pos] Registering a device failed with ${error instanceof Error ? error.name : 'an unknown error'}`);
    return refuse(500, 'INVALID');
  }
}
