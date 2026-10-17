import { z } from 'zod';
import { authFor } from '@/server/studio/auth/auth';
import { newPasswordField } from '@/server/studio/auth/fields';
import { addressKey, RATE_RULES } from '@/server/studio/auth/rate-limit';
import { describeError } from '@/server/studio/framework/result';
import { SIGN_IN_PATH, STUDIO_HOME } from '@/server/studio/framework/paths';
import { definePublicAction } from '@/server/studio/framework/public';
import { acceptInvitation, hashToken, inspectInvitation } from '@/server/studio/services/invitations';

/**
 * The two steps of an invitation for a person who may not have an account yet: opening the link, and accepting. The
 * token in the link is the whole credential, so both are limited per address (a 256-bit token cannot be guessed, but
 * every call reads the database, and accepting hashes a password), and neither says more than the link's owner needs.
 */

const tokenField = z.string().min(1).max(256);

/** Both calls count against the same limit, taken before the token is looked at. */
const limit = (_input: unknown, { ip }: { ip: string }) => [{ key: `invite:ip:${addressKey(ip)}`, rule: RATE_RULES['invite:ip'] }];

/**
 * Accepting also counts against the invitation itself (spec 8: per address and per account; the invitation is the
 * account-to-be), so attempts spread over many addresses still meet a limit. The key holds the token's hash, never the
 * token, and is computed from the typed value alone, so it says nothing about whether such an invitation exists.
 */
const acceptLimit = (input: { token: string }, request: { ip: string }) => [
  ...limit(input, request),
  { key: `invite:token:${hashToken(input.token)}`, rule: RATE_RULES['invite:token'] },
];

export const getInvitation = definePublicAction({
  name: 'invitation.get',
  input: z.object({ token: tokenField }),
  rateLimit: limit,
  run: ({ prisma }, { token }) => inspectInvitation(prisma, token, new Date()),
});

export const acceptInvitationAction = definePublicAction({
  name: 'invitation.accept',
  input: z.object({
    token: tokenField,
    // For an address with no account yet; ignored for one that has an account.
    name: z.string().max(200).optional(),
    password: newPasswordField.optional(),
  }),
  rateLimit: acceptLimit,
  run: async (ctx, { token, name, password }) => {
    const auth = authFor(ctx.prisma);
    // Whoever is signed in to this browser: an existing account may only accept an invitation addressed to it.
    const current = await auth.api.getSession({ headers: ctx.headers });
    const accepted = await acceptInvitation(ctx.prisma, {
      token,
      signedInUserId: current?.user.id ?? null,
      name,
      password,
      now: new Date(),
      meta: { ip: ctx.ip, userAgent: ctx.userAgent },
    });
    if (!accepted.createdAccount) return { next: STUDIO_HOME };

    // A new person is signed in with the password they just chose. The invitation is used and the account exists whether
    // or not this works, so a failure sends them to the sign-in page rather than failing the acceptance.
    try {
      await auth.api.signInEmail({ body: { email: accepted.email, password: password as string }, headers: ctx.headers });
      return { next: STUDIO_HOME };
    } catch (error) {
      console.error(`[studio] Signing in after an invitation failed with ${describeError(error)}`);
      return { next: SIGN_IN_PATH };
    }
  },
});
