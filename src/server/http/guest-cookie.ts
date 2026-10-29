import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { authEnv } from '@/server/env';

/** The wheel's guest key: a random value signed with the server secret, so a guest cannot pick or guess another guest's. No personal data. */
export const GUEST_COOKIE = 'bz_guest';
const ONE_YEAR = 60 * 60 * 24 * 365;

const sign = (value: string) => createHmac('sha256', authEnv().secret).update(`guest:${value}`).digest('base64url');

/** The guest's key out of a request's Cookie header, or null when it is missing or its signature does not match. */
export function readGuestKey(headers: Headers): string | null {
  const raw = headers.get('cookie');
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name !== GUEST_COOKIE) continue;
    const [value, signature, ...extra] = rest.join('=').split('.');
    if (!value || !signature || extra.length > 0) return null;
    const expected = Buffer.from(sign(value));
    const given = Buffer.from(signature);
    return given.length === expected.length && timingSafeEqual(given, expected) ? value : null;
  }
  return null;
}

/** A new key and the Set-Cookie header that keeps it: HttpOnly, Lax, one year, and Secure everywhere but development and test. */
export function newGuestKey(env: Record<string, string | undefined> = process.env): { key: string; setCookie: string } {
  const key = randomBytes(18).toString('base64url');
  const devLike = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
  const parts = [`${GUEST_COOKIE}=${key}.${sign(key)}`, 'Path=/', `Max-Age=${ONE_YEAR}`, 'HttpOnly', 'SameSite=Lax'];
  if (!devLike) parts.push('Secure');
  return { key, setCookie: parts.join('; ') };
}

/** A salted hash of an address for one menu: enough to count a day's spins from it, not to find the address again. */
export function hashAddress(address: string, menuId: string): string {
  return createHmac('sha256', authEnv().secret).update(`ip:${menuId}:${address}`).digest('base64url');
}
