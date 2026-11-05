import { createHmac, timingSafeEqual } from 'node:crypto';

/** The super admin host's gate cookie. A plain name, so it says nothing about what it opens. */
export const CORE_GATE_COOKIE = '__cg';

/** What the gate cookie holds: a keyed hash of the secret path, so the path itself never leaves the server. */
export function coreGateToken(gatePath: string, secret: string): string {
  return createHmac('sha256', secret).update(`core-gate:${gatePath}`).digest('hex');
}

/** Whether `cookie` is the token for `gatePath`. Compared in constant time. */
export function hasCoreGate(cookie: string | undefined, gatePath: string, secret: string): boolean {
  if (!cookie) return false;
  const expected = Buffer.from(coreGateToken(gatePath, secret));
  const given = Buffer.from(cookie);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
