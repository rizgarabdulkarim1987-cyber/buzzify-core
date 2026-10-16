import type { PrismaClient } from '@/generated/prisma/client';
import { authFor } from './auth';

/** The value of one cookie in a `Cookie` header, decoded, or `null`. */
function cookieValue(header: string | null, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at < 0 || part.slice(0, at).trim() !== name) continue;
    const raw = part.slice(at + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

/**
 * The person whose sign-in is waiting for its second step: whoever the request's two-factor challenge cookie was issued
 * to, or `null` when the request has none or it has run out (ten minutes after the password step).
 *
 * The cookie holds `<challenge id>.<signature>`; Better Auth checks the signature when it verifies the code. This only
 * names who the attempt is for, so the second-step limits and the audit log can say whose it is. A cookie that was made
 * up names no challenge and gets `null`; one that cites a real challenge cannot be made up without knowing its random id.
 */
export async function pendingTwoFactorUser(prisma: PrismaClient, headers: Headers): Promise<string | null> {
  const { name } = (await authFor(prisma).$context).createAuthCookie('two_factor');
  const signed = cookieValue(headers.get('cookie'), name);
  if (!signed) return null;
  const dot = signed.lastIndexOf('.');
  const identifier = dot > 0 ? signed.slice(0, dot) : signed;
  const challenge = await prisma.verification.findFirst({
    where: { identifier, expiresAt: { gt: new Date() } },
    select: { value: true },
  });
  return challenge?.value ?? null;
}
