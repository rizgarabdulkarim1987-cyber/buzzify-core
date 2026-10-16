import { isAPIError } from 'better-auth/api';
import { z } from 'zod';
import { authFor } from '@/server/studio/auth/auth';
import { authErrorCode, policyProblemOf } from '@/server/studio/auth/errors';
import { emailField, isRecoveryCode, newPasswordField, signInCodeField } from '@/server/studio/auth/fields';
import { checkPasswordPolicy, passwordProblemMessage } from '@/server/studio/auth/password-policy';
import { addressKey, RATE_RULES } from '@/server/studio/auth/rate-limit';
import { pendingTwoFactor } from '@/server/studio/auth/two-factor';
import { normalizeEmail } from '@/server/studio/auth/users';
import { SIGN_IN_PATH, STUDIO_HOME, TWO_FACTOR_PATH } from '@/server/studio/framework/paths';
import { definePublicAction } from '@/server/studio/framework/public';
import { StudioError } from '@/server/studio/framework/result';

/**
 * The flows for a person who is not signed in. Each is a public action: it checks its own input and limits, and calls
 * Better Auth directly (Better Auth's HTTP routes for these flows are closed; see `auth/http.ts`).
 */

/** The one answer to a failed sign-in, whatever failed: it must not say which of the email and the password was wrong. */
const SIGN_IN_FAILED = 'Wrong email or password';

const CODE_REFUSED = 'That code is not correct';
const CHALLENGE_ENDED = 'Your sign-in has expired. Sign in again.';

export const signIn = definePublicAction({
  name: 'session.signIn',
  // Only a bound on size: whatever else is typed is for Better Auth to say is not an account, the same as for a wrong
  // password, and counts against the limits.
  input: z.object({ email: z.string().min(1).max(254), password: z.string().min(1).max(1024) }),
  // Both limits count every attempt, the right password included, so neither can be used to probe the other.
  rateLimit: (input, { ip }) => [
    { key: `signin:ip:${addressKey(ip)}`, rule: RATE_RULES['signin:ip'] },
    { key: `signin:email:${normalizeEmail(input.email)}`, rule: RATE_RULES['signin:email'] },
  ],
  run: async ({ prisma, headers }, { email, password }) => {
    try {
      const result = await authFor(prisma).api.signInEmail({ body: { email: normalizeEmail(email), password }, headers });
      // The password was right, and the account has two-factor: Better Auth has set the challenge cookie instead of a session.
      const next: typeof STUDIO_HOME | typeof TWO_FACTOR_PATH =
        'twoFactorRedirect' in result && result.twoFactorRedirect ? TWO_FACTOR_PATH : STUDIO_HOME;
      return { next };
    } catch (error) {
      // 401 is a wrong password or an unknown email; 403 is a deactivated account. Nobody learns which.
      if (isAPIError(error) && (error.statusCode === 401 || error.statusCode === 403)) throw new StudioError('INVALID', SIGN_IN_FAILED);
      throw error;
    }
  },
});

export const verifyTwoFactor = definePublicAction({
  name: 'session.verifyTwoFactor',
  input: z.object({ code: signInCodeField }),
  // Limited by the person the challenge was issued to. A request without a challenge has nothing to guess at: `run`
  // refuses it.
  rateLimit: async (_input, { prisma, headers }) => {
    const challenge = await pendingTwoFactor(prisma, headers);
    return challenge ? [{ key: `totp:user:${challenge.userId}`, rule: RATE_RULES['totp:user'] }] : [];
  },
  run: async (ctx, { code }) => {
    // Only the second step of a sign-in. A signed-in person has none, and Better Auth would otherwise take their session
    // for the confirmation step of setting up two-factor, which it neither limits nor audits (see `confirmTwoFactor`).
    const challenge = await pendingTwoFactor(ctx.prisma, ctx.headers);
    if (!challenge) throw new StudioError('UNAUTHENTICATED', CHALLENGE_ENDED);

    const auth = authFor(ctx.prisma);
    const recovery = isRecoveryCode(code);
    try {
      // With the challenge cookie alone, so the challenge is all Better Auth can use.
      if (recovery) await auth.api.verifyBackupCode({ body: { code }, headers: challenge.headers });
      else await auth.api.verifyTOTP({ body: { code }, headers: challenge.headers });
    } catch (error) {
      switch (authErrorCode(error)) {
        case 'INVALID_CODE':
        case 'INVALID_BACKUP_CODE':
          throw new StudioError('INVALID', undefined, { code: CODE_REFUSED });
        // Better Auth ends the challenge after five wrong codes (or when ten minutes pass): start again.
        case 'INVALID_TWO_FACTOR_COOKIE':
        case 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE':
          throw new StudioError('UNAUTHENTICATED', CHALLENGE_ENDED);
        case 'ACCOUNT_TEMPORARILY_LOCKED':
          throw new StudioError('RATE_LIMITED');
      }
      throw error;
    }
    // A recovery code is gone for good once used: the person may want to know it was.
    if (recovery) {
      await ctx.audit(challenge.userId, { action: 'account.recovery_code_used', entityType: 'User', entityId: challenge.userId });
    }
    return { next: STUDIO_HOME };
  },
});

export const requestPasswordReset = definePublicAction({
  name: 'session.requestPasswordReset',
  input: z.object({ email: emailField }),
  // Keyed by what was typed, so the limit is the same for an address with an account and one without.
  rateLimit: ({ email }, { ip }) => [
    { key: `reset:email:${email}`, rule: RATE_RULES['reset:email'] },
    { key: `reset:ip:${addressKey(ip)}`, rule: RATE_RULES['reset:ip'] },
  ],
  run: async ({ prisma }, { email }) => {
    // Better Auth answers an unknown address like a known one and takes as long; the mail goes out after the response.
    await authFor(prisma).api.requestPasswordReset({ body: { email } });
    return { sent: true as const };
  },
});

export const resetPassword = definePublicAction({
  name: 'session.resetPassword',
  input: z.object({ token: z.string().min(1).max(256), password: newPasswordField }),
  // The same per-address count as asking for a reset, taken before the token is looked at, so a refusal spends nothing.
  rateLimit: (_input, { ip }) => [{ key: `reset:ip:${addressKey(ip)}`, rule: RATE_RULES['reset:ip'] }],
  run: async (ctx, { token, password }) => {
    const problem = checkPasswordPolicy(password);
    if (problem) throw new StudioError('INVALID', undefined, { password: passwordProblemMessage(problem) });

    // Read before the reset spends the token, to say in the audit log whose password it was.
    const pending = await ctx.prisma.verification.findFirst({
      where: { identifier: `reset-password:${token}`, expiresAt: { gt: new Date() } },
      select: { value: true },
    });
    try {
      // Better Auth ends every session of the person with the reset and sends the password-changed notice.
      await authFor(ctx.prisma).api.resetPassword({ body: { newPassword: password, token }, headers: ctx.headers });
    } catch (error) {
      switch (authErrorCode(error)) {
        case 'INVALID_TOKEN':
          throw new StudioError('INVALID', undefined, { token: 'This link has expired or was already used. Ask for a new one.' });
        case 'PASSWORD_POLICY':
          throw new StudioError('INVALID', undefined, { password: passwordProblemMessage(policyProblemOf(error)) });
      }
      throw error;
    }
    if (pending) await ctx.audit(pending.value, { action: 'account.password_reset', entityType: 'User', entityId: pending.value });
    return { next: SIGN_IN_PATH };
  },
});

export const signOut = definePublicAction({
  name: 'session.signOut',
  // Whatever a form passes along (a `<form action>` hands its FormData to the function) is not read.
  input: z.unknown(),
  run: async ({ prisma, headers }) => {
    try {
      await authFor(prisma).api.signOut({ headers });
    } catch (error) {
      // No session to end is the same outcome as ending it.
      if (!isAPIError(error)) throw error;
    }
    return { next: SIGN_IN_PATH };
  },
});
