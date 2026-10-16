import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { nextCookies } from 'better-auth/next-js';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { after } from 'next/server';
import type { PrismaClient } from '@/generated/prisma/client';
import { isLocale, type Locale } from '@/lib/locale';
import { getPrisma } from '@/server/data/prisma';
import { sendEmail } from '@/server/email/send';
import { renderEmail, type EmailParams, type EmailTemplate } from '@/server/email/templates';
import { authEnv, type AuthEnv } from '@/server/env';
import { checkPasswordPolicy, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from './password-policy';

/** The person an email is for: the address to send to, and what to call them in it. */
interface Recipient {
  email: string;
  name: string;
}

/** The language of the recipient's Studio account. The `locale` column is an additional field Better Auth's `User` type does not name. */
function localeOf(user: object): Locale {
  const value = (user as { locale?: unknown }).locale;
  return typeof value === 'string' && isLocale(value) ? value : 'en';
}

/**
 * Renders and sends one of the account emails. A failure is logged, never thrown: the template and the error go in the
 * log, but the address, the link and the token never do. (Better Auth also swallows what its callbacks throw, so
 * letting it propagate would only change what is logged.)
 */
async function deliver(user: Recipient, template: EmailTemplate, params: EmailParams): Promise<void> {
  try {
    const mail = renderEmail(template, localeOf(user), { name: user.name, ...params });
    await sendEmail({ to: user.email, ...mail });
  } catch (error) {
    console.error(`[auth] The ${template} email was not sent: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Sends after the response, never inside the request: a request that sends a mail answers as fast as one that does not,
 * so the response time says nothing about whether an address has an account. `after()` also keeps a serverless
 * function alive until the send has finished, which a floating promise does not (the platform may freeze the
 * function the moment the response is out, and the mail is never sent). Without a request scope (tests, scripts) there
 * is no response to wait for and `after()` throws, so the send simply starts.
 */
function sendAfterResponse(user: Recipient, template: EmailTemplate, params: EmailParams): void {
  const task = () => deliver(user, template, params);
  try {
    after(task);
  } catch {
    void task();
  }
}

/**
 * The second layer of the password policy (the Studio's actions check it first and say why). It refuses a new password
 * that fails `checkPasswordPolicy` before Better Auth stores it, with a 400 and a stable code: `PASSWORD_POLICY`, and
 * the policy's reason (`TOO_SHORT`, `TOO_LONG`, `COMMON`) in `reason`.
 *
 * It applies to every call that carries a `newPassword`: `/reset-password`, `/change-password` and `/set-password`. It
 * matches on the field and not on the path because `set-password` is server-only and has no path to match.
 *
 * It sits on these calls and not on `password.hash`: Better Auth also hashes the password it was given when a sign-in
 * names an unknown email, to make that case take as long as a wrong password, and a hash that refused weak passwords
 * would fail there first and fast, telling a caller which emails have accounts.
 *
 * `hooks.before` runs for `auth.api.*` calls as well as for HTTP requests (both go through Better Auth's one hook runner).
 */
const enforcePasswordPolicy = createAuthMiddleware(async (ctx) => {
  const newPassword = (ctx.body as { newPassword?: unknown } | undefined)?.newPassword;
  // A missing or malformed value is Better Auth's own validation to reject.
  if (typeof newPassword !== 'string') return;
  const reason = checkPasswordPolicy(newPassword);
  if (reason) {
    throw new APIError('BAD_REQUEST', { message: 'The password is not acceptable', code: 'PASSWORD_POLICY', reason });
  }
});

/**
 * The Studio's Better Auth instance on `prisma`. Accounts are invitation-only (no public sign-up), a password needs 12
 * to 128 characters, two-factor is time-based codes with ten single-use backup codes, and Better Auth's own emails
 * (password reset, password changed, e-mail change) go out through `sendEmail` in the account's language.
 *
 * It is a factory because tests build one on the test database; the application uses `getAuth()`.
 */
export function createAuth(prisma: PrismaClient, config: AuthEnv = authEnv()) {
  const { secret, baseUrl, production } = config;

  return betterAuth({
    appName: 'Buzzify Studio',
    baseURL: baseUrl,
    secret,
    database: prismaAdapter(prisma, { provider: 'postgresql' }),

    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
      resetPasswordTokenExpiresIn: 3600,
      revokeSessionsOnPasswordReset: true,
      // The link is the Studio's reset page, not Better Auth's endpoint.
      sendResetPassword: async ({ user, token }) => {
        sendAfterResponse(user, 'reset', { url: `${baseUrl}/studio/reset?token=${encodeURIComponent(token)}` });
      },
      // The password is already changed and the sessions already ended, so a mail failure must not fail the reset.
      onPasswordReset: async ({ user }) => {
        sendAfterResponse(user, 'passwordChanged', {});
      },
    },

    // Sent when someone changes their address: to the new one, once the old one has confirmed.
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        sendAfterResponse(user, 'verifyNewEmail', { url });
      },
    },

    user: {
      additionalFields: {
        isSuperAdmin: { type: 'boolean', required: false, defaultValue: false, input: false },
        locale: { type: 'string', required: false, defaultValue: 'en', input: false },
        deactivatedAt: { type: 'date', required: false, input: false },
      },
      changeEmail: {
        enabled: true,
        // To the old address, which must confirm before the new one is asked to verify.
        sendChangeEmailConfirmation: async ({ user, newEmail, url }) => {
          sendAfterResponse(user, 'changeEmailConfirm', { newEmail, url });
        },
      },
    },

    session: { expiresIn: 2592000, updateAge: 86400 },

    // Host-only cookies (no cross-subdomain sharing), so the public menu host never receives a Studio session.
    advanced: { cookiePrefix: 'studio', useSecureCookies: production },

    // Better Auth's limiter covers requests that arrive over HTTP only; the Server Actions use checkRateLimit.
    rateLimit: { enabled: true, storage: 'database' },

    trustedOrigins: [baseUrl, ...(production ? [] : ['http://localhost:3100', 'http://127.0.0.1:3100'])],

    // `disabledPaths` hides the HTTP route (404); `disableSignUp` also refuses `auth.api.signUpEmail`.
    disabledPaths: ['/sign-up/email'],

    hooks: { before: enforcePasswordPolicy },

    databaseHooks: {
      session: {
        create: {
          // A deactivated person cannot start a session, whatever they know: not by password, not by a reset.
          before: async (session) => {
            const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { deactivatedAt: true } });
            if (user?.deactivatedAt) {
              throw new APIError('FORBIDDEN', { message: 'This account is deactivated', code: 'ACCOUNT_DEACTIVATED' });
            }
          },
        },
      },
    },

    // nextCookies must come last: it warns when another plugin follows it.
    plugins: [twoFactor({ issuer: 'Buzzify Studio', backupCodeOptions: { amount: 10 } }), nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

const instances = new WeakMap<PrismaClient, Auth>();

/** One instance per database client, built on first use: whoever holds a client gets an auth that writes to the same database. */
export function authFor(prisma: PrismaClient): Auth {
  let auth = instances.get(prisma);
  if (!auth) {
    auth = createAuth(prisma);
    instances.set(prisma, auth);
  }
  return auth;
}

/** The application's auth, on the application's database client. Built on first use, so importing this file reads no configuration. */
export function getAuth(): Auth {
  return authFor(getPrisma());
}
