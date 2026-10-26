import { DEVICE_COOKIE, DEVICE_COOKIE_MAX_AGE } from '@/server/domain/pos/pin';

export { DEVICE_COOKIE };

/**
 * The cookie that marks a browser as a registered shared device. HttpOnly (script never sees it), Lax, host-only, and
 * Secure everywhere but development and test. Only the token's sha256 is stored on the server.
 */
export function deviceCookieOptions(env: Record<string, string | undefined> = process.env) {
  const devLike = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
  return { httpOnly: true, sameSite: 'lax' as const, path: '/', maxAge: DEVICE_COOKIE_MAX_AGE, secure: !devLike };
}

/** The device token out of a request's Cookie header, if any. */
export function readDeviceToken(headers: Headers): string | undefined {
  const raw = headers.get('cookie');
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === DEVICE_COOKIE) return rest.join('=') || undefined;
  }
  return undefined;
}
