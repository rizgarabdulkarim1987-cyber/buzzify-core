import { headers } from 'next/headers';
import QRCode from 'qrcode';
import { z } from 'zod';
import { checkAppearance, DEFAULT_APPEARANCE } from '@/lib/appearance';
import { LOCALES } from '@/lib/locale';
import { Prisma } from '@/generated/prisma/client';
import { authFor, sendAfterResponse } from '@/server/studio/auth/auth';
import { authErrorCode, policyProblemOf } from '@/server/studio/auth/errors';
import { currentPasswordField, emailField, newPasswordField, totpCodeField } from '@/server/studio/auth/fields';
import { checkPasswordPolicy, passwordProblemMessage } from '@/server/studio/auth/password-policy';
import { checkRateLimit, RATE_RULES } from '@/server/studio/auth/rate-limit';
import { currentSessionId } from '@/server/studio/auth/sessions';
import { defineAction, type ActionContext } from '@/server/studio/framework/action';
import { ACCOUNT_PATH } from '@/server/studio/framework/paths';
import { StudioError } from '@/server/studio/framework/result';

/**
 * A person's own account: their password, two-factor, email, language and sessions. Every action here has the `self`
 * target and keys what it does by `ctx.actor.userId`, never by an id from its input. Better Auth does the work that is
 * its own (the password check, the secrets, the new session after a change) with the request's own cookies, passed as
 * `headers()`; the action adds the limits, the audit row and the notice. Nothing secret is audited: no password, key,
 * code or token goes in an audit row's `changes`.
 */

const SELF = { kind: 'self' } as const;

/** What an action with nothing to read takes: whatever arrives (a `<form action>` passes its FormData) is ignored. */
const nothing = z.unknown();

const WRONG_PASSWORD = 'That password is not correct';

/**
 * Counts one check of the signed-in person's password against a limit shared by every action that asks for it. Without
 * it, a stolen session could be used to guess the password through the account page, which the sign-in limits do not see.
 */
async function limitPasswordChecks(ctx: ActionContext): Promise<void> {
  const verdict = await checkRateLimit(ctx.db, `reauth:user:${ctx.actor.userId}`, RATE_RULES['reauth:user'], new Date());
  if (!verdict.allowed) throw new StudioError('RATE_LIMITED', undefined, { retryAfterSec: String(verdict.retryAfterSec) });
}

/** The password field's message for a wrong password; every other failure goes on to the framework. */
function wrongPassword(error: unknown, field: string): never {
  if (authErrorCode(error) === 'INVALID_PASSWORD') throw new StudioError('INVALID', undefined, { [field]: WRONG_PASSWORD });
  throw error;
}

export const startTwoFactorSetup = defineAction({
  name: 'account.startTwoFactorSetup',
  permission: null,
  input: z.object({ password: currentPasswordField }),
  target: () => SELF,
  // How a Super Admin gets to turn it on in the first place.
  allowWithoutTwoFactor: true,
  run: async (ctx, { password }) => {
    if (ctx.actor.twoFactorEnabled) throw new StudioError('CONFLICT', 'Two-factor authentication is already on');
    await limitPasswordChecks(ctx);

    let enabled;
    try {
      enabled = await authFor(ctx.db).api.enableTwoFactor({ body: { password }, headers: await headers() });
    } catch (error) {
      if (authErrorCode(error) === 'TOTP_ALREADY_ENABLED') throw new StudioError('CONFLICT', 'Two-factor authentication is already on');
      return wrongPassword(error, 'password');
    }
    if (enabled.method !== 'totp') throw new Error('Better Auth started a two-factor method other than an authenticator app');

    const secret = new URL(enabled.totpURI).searchParams.get('secret');
    if (!secret) throw new Error('Better Auth gave a two-factor link without a key');
    // Drawn here, so the key never goes to a QR service. It is an <svg> of plain paths: no script, no image, no link.
    const qrSvg = await QRCode.toString(enabled.totpURI, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    return { totpUri: enabled.totpURI, secret, qrSvg, backupCodes: enabled.backupCodes };
  },
});

export const confirmTwoFactor = defineAction({
  name: 'account.confirmTwoFactor',
  permission: null,
  input: z.object({ code: totpCodeField }),
  target: () => SELF,
  allowWithoutTwoFactor: true,
  run: async (ctx, { code }) => {
    if (ctx.actor.twoFactorEnabled) throw new StudioError('CONFLICT', 'Two-factor authentication is already on');
    // Better Auth does not count wrong codes while someone is signed in, so the Studio does.
    const verdict = await checkRateLimit(ctx.db, `totp:user:${ctx.actor.userId}`, RATE_RULES['totp:user'], new Date());
    if (!verdict.allowed) throw new StudioError('RATE_LIMITED', undefined, { retryAfterSec: String(verdict.retryAfterSec) });

    try {
      // Turns two-factor on and starts a new session: the cookie in the response replaces the one in this request.
      await authFor(ctx.db).api.verifyTOTP({ body: { code }, headers: await headers() });
    } catch (error) {
      switch (authErrorCode(error)) {
        case 'INVALID_CODE':
          throw new StudioError('INVALID', undefined, { code: 'That code is not correct' });
        case 'TOTP_NOT_ENABLED':
          throw new StudioError('INVALID', 'Start the setup again', { code: 'Start the setup again' });
      }
      throw error;
    }
    ctx.audit({
      action: 'account.two_factor_enabled',
      entityType: 'User',
      entityId: ctx.actor.userId,
      changes: { twoFactorEnabled: { before: false, after: true } },
    });
    return { enabled: true as const };
  },
});

export const regenerateRecoveryCodes = defineAction({
  name: 'account.regenerateRecoveryCodes',
  permission: null,
  input: z.object({ password: currentPasswordField }),
  target: () => SELF,
  run: async (ctx, { password }) => {
    await limitPasswordChecks(ctx);
    let fresh;
    try {
      fresh = await authFor(ctx.db).api.generateBackupCodes({ body: { password }, headers: await headers() });
    } catch (error) {
      if (authErrorCode(error) === 'TWO_FACTOR_NOT_ENABLED') throw new StudioError('CONFLICT', 'Two-factor authentication is not on');
      return wrongPassword(error, 'password');
    }
    ctx.audit({ action: 'account.recovery_codes_regenerated', entityType: 'User', entityId: ctx.actor.userId });
    return { backupCodes: fresh.backupCodes };
  },
});

export const disableTwoFactor = defineAction({
  name: 'account.disableTwoFactor',
  permission: null,
  input: z.object({ password: currentPasswordField }),
  target: () => SELF,
  run: async (ctx, { password }) => {
    // The one account setting a Super Admin cannot change: their access is only as safe as this.
    if (ctx.actor.isSuperAdmin) throw new StudioError('FORBIDDEN', 'Super Admins must keep two-factor authentication on');
    await limitPasswordChecks(ctx);
    try {
      // Starts a new session without it: the cookie in the response replaces the one in this request.
      await authFor(ctx.db).api.disableTwoFactor({ body: { password }, headers: await headers() });
    } catch (error) {
      return wrongPassword(error, 'password');
    }
    ctx.audit({
      action: 'account.two_factor_disabled',
      entityType: 'User',
      entityId: ctx.actor.userId,
      changes: { twoFactorEnabled: { before: true, after: false } },
    });
    return { enabled: false as const };
  },
});

export const changePassword = defineAction({
  name: 'account.changePassword',
  permission: null,
  input: z.object({ current: currentPasswordField, next: newPasswordField }),
  target: () => SELF,
  run: async (ctx, { current, next }) => {
    const problem = checkPasswordPolicy(next);
    if (problem) throw new StudioError('INVALID', undefined, { next: passwordProblemMessage(problem) });
    await limitPasswordChecks(ctx);

    try {
      // Every other session ends, and this one is replaced by a new one: the cookie in the response carries it.
      await authFor(ctx.db).api.changePassword({
        body: { currentPassword: current, newPassword: next, revokeOtherSessions: true },
        headers: await headers(),
      });
    } catch (error) {
      if (authErrorCode(error) === 'PASSWORD_POLICY') {
        throw new StudioError('INVALID', undefined, { next: passwordProblemMessage(policyProblemOf(error)) });
      }
      return wrongPassword(error, 'current');
    }
    ctx.audit({ action: 'account.password_changed', entityType: 'User', entityId: ctx.actor.userId });
    // To the address on the account, in the person's language, after the response.
    ctx.afterCommit(() => sendAfterResponse(ctx.actor, 'passwordChanged', {}));
    return { changed: true as const };
  },
});

export const requestEmailChange = defineAction({
  name: 'account.requestEmailChange',
  permission: null,
  input: z.object({ newEmail: emailField }),
  target: () => SELF,
  run: async (ctx, { newEmail }) => {
    if (newEmail === ctx.actor.email) throw new StudioError('INVALID', undefined, { newEmail: 'This is already your email address' });

    // The old address is asked to confirm first; once it has, the new address is asked to verify, and the address
    // changes when that link is opened in a signed-in browser (see `emailChangeNeedsSession` in auth.ts). Better Auth
    // answers an address that another account has like any other, so this does not say whether there is one.
    await authFor(ctx.db).api.changeEmail({ body: { newEmail, callbackURL: ACCOUNT_PATH }, headers: await headers() });

    ctx.audit({
      action: 'account.email_change_requested',
      entityType: 'User',
      entityId: ctx.actor.userId,
      changes: { requestedEmail: { before: null, after: newEmail } },
    });
    return { sent: true as const };
  },
});

export const setStudioLanguage = defineAction({
  name: 'account.setStudioLanguage',
  permission: null,
  input: z.object({ locale: z.enum(LOCALES, { error: 'Choose one of the languages offered' }) }),
  target: () => SELF,
  // Also the sign-in page's language switch for a Super Admin who has not set up two-factor yet.
  allowWithoutTwoFactor: true,
  run: (ctx, { locale }) =>
    ctx.transaction(async (tx) => {
      const before = await tx.user.findUniqueOrThrow({ where: { id: ctx.actor.userId }, select: { locale: true } });
      await tx.user.update({ where: { id: ctx.actor.userId }, data: { locale } });
      ctx.audit({
        action: 'account.language_changed',
        entityType: 'User',
        entityId: ctx.actor.userId,
        changes: { locale: { before: before.locale, after: locale } },
      });
      return { locale };
    }),
});

const appearanceInput = z.object({
  font: z.string().max(32),
  bg: z.string().max(16),
  text: z.string().max(16),
  button: z.string().max(16),
  buttonText: z.string().max(16),
  shape: z.string().max(16),
});

/** The person's own look. Keyed by the actor, so nobody can change another person's; unreadable colour sets are refused. */
export const setAppearance = defineAction({
  name: 'account.setAppearance',
  permission: null,
  input: appearanceInput,
  target: () => SELF,
  run: (ctx, input) => {
    const checked = checkAppearance(input);
    if (!checked.ok) throw new StudioError('INVALID', undefined, { [checked.field]: checked.reason });
    const { value } = checked;
    return ctx.transaction(async (tx) => {
      const before = await tx.user.findUniqueOrThrow({ where: { id: ctx.actor.userId }, select: { appearance: true } });
      await tx.user.update({ where: { id: ctx.actor.userId }, data: { appearance: { ...value } } });
      ctx.audit({
        action: 'account.appearance_changed',
        entityType: 'User',
        entityId: ctx.actor.userId,
        changes: { appearance: { before: before.appearance, after: value } },
      });
      return value;
    });
  },
});

export const resetAppearance = defineAction({
  name: 'account.resetAppearance',
  permission: null,
  input: nothing,
  target: () => SELF,
  run: (ctx) =>
    ctx.transaction(async (tx) => {
      const before = await tx.user.findUniqueOrThrow({ where: { id: ctx.actor.userId }, select: { appearance: true } });
      await tx.user.update({ where: { id: ctx.actor.userId }, data: { appearance: Prisma.DbNull } });
      ctx.audit({
        action: 'account.appearance_changed',
        entityType: 'User',
        entityId: ctx.actor.userId,
        changes: { appearance: { before: before.appearance, after: null } },
      });
      return DEFAULT_APPEARANCE;
    }),
});

export const endSession = defineAction({
  name: 'account.endSession',
  permission: null,
  input: z.object({ sessionId: z.string().min(1).max(200) }),
  target: () => SELF,
  run: (ctx, { sessionId }) =>
    ctx.transaction(async (tx) => {
      // Only the actor's own: another person's session (or none) is simply not found.
      const { count } = await tx.session.deleteMany({ where: { id: sessionId, userId: ctx.actor.userId } });
      if (count === 0) throw new StudioError('NOT_FOUND');
      ctx.audit({ action: 'account.session_ended', entityType: 'Session', entityId: sessionId });
      return { ended: true as const };
    }),
});

export const endOtherSessions = defineAction({
  name: 'account.endOtherSessions',
  permission: null,
  input: nothing,
  target: () => SELF,
  run: async (ctx) => {
    const current = await currentSessionId(ctx.db);
    return ctx.transaction(async (tx) => {
      const { count } = await tx.session.deleteMany({
        where: { userId: ctx.actor.userId, ...(current ? { id: { not: current } } : {}) },
      });
      if (count > 0) {
        ctx.audit({
          action: 'account.other_sessions_ended',
          entityType: 'User',
          entityId: ctx.actor.userId,
          changes: { ended: { before: null, after: count } },
        });
      }
      return { ended: count };
    });
  },
});
