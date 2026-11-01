import { after } from 'next/server';
import { z } from 'zod';
import type { PrismaClient } from '@/generated/prisma/client';
import { authFor } from '@/server/studio/auth/auth';
import { checkRateLimit, RATE_RULES } from '@/server/studio/auth/rate-limit';
import { isUniqueViolation, normalizeEmail } from '@/server/studio/auth/users';

/**
 * The Studio account behind a Buzzify Retail staff email (`POST /api/retail/v1/identities`). Retails links its local
 * user to the answer's `coreUserId` only when `emailVerified` is true, so that flag is true only when Studio has proven
 * the address: an account that exists, is verified and is not deactivated. Super Admins are answered like anyone else
 * (Retails itself refuses to link a platform admin).
 *
 * An unknown address gets an identity-only account (`User.identityOnly`): not verified, no password, no membership. Its
 * person is mailed a set-password link after the response (Better Auth's reset, with the `retailIdentity` wording); the
 * link proves the address (`onPasswordReset` marks it verified), and the owner's next add in Retails then links.
 * Asked again for an identity-only account that has no password yet, it mails the link again (at most once per ten
 * minutes, and the route's per-email limit bounds the calls). A known account is never changed here. The answer is the same three fields for every case, and no link, token or
 * password ever travels in it.
 */

export const identityInput = z.object({
  email: z.string().trim().max(254).pipe(z.email()),
  // A name longer than Studio keeps is cut, not refused: the account matters more than the last letters of a name.
  name: z
    .string()
    .transform((value) => value.trim().slice(0, 120).trim())
    .optional(),
});
export type IdentityInput = z.infer<typeof identityInput>;

export interface Identity {
  coreUserId: string;
  created: boolean;
  emailVerified: boolean;
}

const answer = (user: { id: string; emailVerified: boolean; deactivatedAt: Date | null }, created: boolean): Identity => ({
  coreUserId: user.id,
  created,
  emailVerified: user.emailVerified && !user.deactivatedAt,
});

const IDENTITY_FIELDS = { id: true, emailVerified: true, deactivatedAt: true } as const;
/** What deciding on a repeat mail needs: an identity-only account whose person never set a password has no credential. */
const FOUND_FIELDS = { ...IDENTITY_FIELDS, identityOnly: true, accounts: { where: { providerId: 'credential' }, select: { id: true } } } as const;

/**
 * Asks Better Auth for the reset link (its token, its expiry), after the response: `sendResetPassword` words it for Retail.
 * At most once per `retail-identity:mail` window per account, counted atomically, so concurrent calls for one new address
 * mail once, and a retry soon after the first mail sends nothing while its link is fresh.
 */
async function mailSetPassword(prisma: PrismaClient, userId: string, email: string, now: Date): Promise<void> {
  if (!(await checkRateLimit(prisma, `retail-identity:mail:${userId}`, RATE_RULES['retail-identity:mail'], now)).allowed) return;
  const task = async () => {
    try {
      await authFor(prisma).api.requestPasswordReset({ body: { email } });
    } catch (error) {
      // No address, no link: the error's name only.
      console.error(`[retail.identity] SET_PASSWORD_MAIL_FAILED ${error instanceof Error ? error.name : 'unknown error'}`);
    }
  };
  try {
    after(task);
  } catch {
    // Outside a request (tests, scripts) there is no response to wait for.
    void task();
  }
}

export async function ensureIdentity(prisma: PrismaClient, input: { email: string; name?: string }, now: Date): Promise<Identity> {
  const email = normalizeEmail(input.email);
  const found = await prisma.user.findUnique({ where: { email }, select: FOUND_FIELDS });
  if (found) {
    // The person was mailed before but never set a password (the link lasts an hour): the owner's retried add re-sends it.
    // An ordinary account, or one whose password is set, is never mailed from here.
    if (found.identityOnly && found.accounts.length === 0 && !found.deactivatedAt) await mailSetPassword(prisma, found.id, email, now);
    return answer(found, false);
  }

  const name = input.name?.trim() || email.slice(0, email.indexOf('@'));
  const ctx = await authFor(prisma).$context;
  let id: string;
  try {
    ({ id } = await ctx.internalAdapter.createUser(
      { email, name, emailVerified: false, identityOnly: true, isSuperAdmin: false, isPlatformOwner: false, locale: 'en', createdAt: now, updatedAt: now },
      { method: 'admin' },
    ));
  } catch (error) {
    // Two calls for one address raced: the other made it.
    if (!isUniqueViolation(error)) throw error;
    const winner = await prisma.user.findUnique({ where: { email }, select: IDENTITY_FIELDS });
    if (!winner) throw error;
    return answer(winner, false);
  }
  await mailSetPassword(prisma, id, email, now);
  return { coreUserId: id, created: true, emailVerified: false };
}
