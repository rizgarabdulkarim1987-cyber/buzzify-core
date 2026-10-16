import { parseCookies } from 'better-auth/cookies';
import type { PrismaClient } from '@/generated/prisma/client';
import { authFor } from './auth';

/** A sign-in that has passed its password and is waiting for its second step. */
export interface TwoFactorChallenge {
  /** The person the challenge was issued to. */
  userId: string;
  /**
   * The request's headers with its cookies replaced by the challenge cookie alone. Hand these to Better Auth for the
   * second step: with a session cookie in the request it would treat the call as a signed-in person confirming
   * two-factor (no challenge, none of the second-step limits, and it can switch two-factor on), and with the challenge
   * cookie in any other spelling than the one read here the limit and the check could be about different challenges.
   */
  headers: Headers;
}

/**
 * What Better Auth names a challenge in its `verification` table: `2fa-` and random letters, digits, `-` and `_`. Its
 * attempt counters sit in the same table as `2fa-attempts-<id>` and are not challenges.
 */
const CHALLENGE_ID = /^2fa-(?!attempts-)[A-Za-z0-9_-]+$/;

/**
 * The pending second step in `headers`, or `null` when the request has no two-factor challenge cookie or the challenge
 * has run out (ten minutes after the password step) or does not exist. A request that is merely signed in has none.
 *
 * The cookie holds `<challenge id>.<signature>`. It is read with Better Auth's own cookie parser (quoted values
 * included), and the cookie Better Auth is then given is rebuilt from the value read here, so the person the limits and
 * the audit log name is the person whose challenge Better Auth checks. Better Auth checks the signature when it
 * verifies the code; this only looks the challenge up.
 */
export async function pendingTwoFactor(prisma: PrismaClient, headers: Headers): Promise<TwoFactorChallenge | null> {
  const { name } = (await authFor(prisma).$context).createAuthCookie('two_factor');
  const signed = parseCookies(headers.get('cookie') ?? '').get(name);
  if (!signed) return null;
  const dot = signed.lastIndexOf('.');
  const identifier = dot > 0 ? signed.slice(0, dot) : signed;
  if (!CHALLENGE_ID.test(identifier)) return null;
  const challenge = await prisma.verification.findFirst({
    where: { identifier, expiresAt: { gt: new Date() } },
    select: { value: true },
  });
  if (!challenge) return null;
  const alone = new Headers(headers);
  alone.set('cookie', `${name}=${encodeURIComponent(signed)}`);
  return { userId: challenge.value, headers: alone };
}
