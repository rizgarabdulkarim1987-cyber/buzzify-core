import { randomUUID } from 'node:crypto';
import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { after } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readDevMail } from '@/server/email/send';
import { renderEmail } from '@/server/email/templates';
import { loadActor } from '@/server/studio/auth/actor';
import { createAuth } from '@/server/studio/auth/auth';
import { checkPasswordPolicy } from '@/server/studio/auth/password-policy';
import {
  createPasswordUser,
  deactivateUser,
  EmailTakenError,
  normalizeEmail,
  PasswordPolicyError,
} from '@/server/studio/auth/users';
import { cookieHeader, totpFromUri } from '../helpers/auth';
import { resetTestData, testPrisma } from '../helpers/db';

/** Lets a test slow down or break the send that Better Auth's callbacks make, and leaves it alone otherwise. */
const sending = vi.hoisted(() => ({ delayMs: 0, failure: null as Error | null }));
vi.mock('@/server/email/send', async (importActual) => {
  const actual = await importActual<typeof import('@/server/email/send')>();
  return {
    ...actual,
    sendEmail: async (email: Parameters<typeof actual.sendEmail>[0]) => {
      if (sending.delayMs) await new Promise((resolve) => setTimeout(resolve, sending.delayMs));
      if (sending.failure) throw sending.failure;
      return actual.sendEmail(email);
    },
  };
});

/**
 * `after()` throws outside a request scope, which is what the Studio's fallback is for. Wrapping it lets a test stand in
 * for a request: it records what was scheduled instead of running it, so the test can show that nothing ran early.
 */
vi.mock('next/server', async (importActual) => {
  const actual = await importActual<typeof import('next/server')>();
  return { ...actual, after: vi.fn(actual.after) };
});

const prisma = testPrisma();
const auth = createAuth(prisma);

const BASE = 'http://127.0.0.1:3100';
const JSON_HEADERS = { 'content-type': 'application/json', origin: BASE, 'x-forwarded-for': '198.51.100.7' };
const GOOD = 'correct horse battery staple';
const MAIL_DIR = path.join(process.cwd(), '.data', 'mail');
const run = randomUUID().slice(0, 8);

/** An address no other test run shares, so the shared development mail folder never mixes runs. */
const address = (label: string) => `${label}-${run}@example.test`;

async function ownMailFiles(): Promise<string[]> {
  try {
    return (await readdir(MAIL_DIR)).filter((name) => name.includes(run));
  } catch {
    return [];
  }
}

/** The one development email sent to an address, waiting for it when the sender did not wait for the send. */
async function mailTo(to: string, count = 1) {
  await vi.waitFor(async () => expect(await readDevMail(to)).toHaveLength(count), { timeout: 5000, interval: 25 });
  return readDevMail(to);
}

const linkIn = (text: string) => /https?:\/\/[^\s]+/.exec(text)?.[0] as string;

let realAfter: typeof after;

beforeAll(async () => {
  realAfter = (await vi.importActual<typeof import('next/server')>('next/server')).after;
  // Never send real mail from a test, whatever the developer's shell exports.
  vi.stubEnv('RESEND_API_KEY', '');
  await resetTestData(prisma);
});

beforeEach(async () => {
  vi.mocked(after).mockReset();
  vi.mocked(after).mockImplementation(realAfter);
  sending.delayMs = 0;
  sending.failure = null;
  await resetTestData(prisma);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all((await ownMailFiles()).map((name) => rm(path.join(MAIL_DIR, name), { force: true })));
});

afterAll(async () => {
  await resetTestData(prisma);
  await prisma.$disconnect();
  vi.unstubAllEnvs();
});

describe('creating users', () => {
  it('creates a user who can sign in with any letter case and surrounding spaces in the email', async () => {
    await createPasswordUser(prisma, { email: 'Owner@Example.com ', name: 'Owner', password: GOOD }, auth);
    const res = await auth.api.signInEmail({ body: { email: normalizeEmail('  owner@example.COM'), password: GOOD } });
    expect(res.user.email).toBe('owner@example.com');
  });

  it('normalizes an email by trimming and lower-casing it', () => {
    expect(normalizeEmail('  Owner@Example.COM\t')).toBe('owner@example.com');
  });

  it('stores the user verified, with a credential account and the flags that were asked for', async () => {
    const plain = await createPasswordUser(prisma, { email: 'a@example.com', name: ' Ann ', password: GOOD }, auth);
    const admin = await createPasswordUser(
      prisma,
      { email: 'b@example.com', name: 'Bo', password: GOOD, isSuperAdmin: true, locale: 'ckb' },
      auth,
    );

    const a = await prisma.user.findUniqueOrThrow({ where: { id: plain.userId }, include: { accounts: true } });
    expect(a).toMatchObject({ email: 'a@example.com', name: 'Ann', emailVerified: true, isSuperAdmin: false, locale: 'en', deactivatedAt: null });
    expect(a.twoFactorEnabled).toBeFalsy();
    expect(a.accounts).toHaveLength(1);
    expect(a.accounts[0]).toMatchObject({ providerId: 'credential', accountId: plain.userId });
    expect(a.accounts[0]?.password).toBeTruthy();
    expect(a.accounts[0]?.password).not.toContain(GOOD);

    const b = await prisma.user.findUniqueOrThrow({ where: { id: admin.userId } });
    expect(b).toMatchObject({ isSuperAdmin: true, locale: 'ckb' });
  });

  it('rejects public sign-up over HTTP and through the server API, and creates no user', async () => {
    const res = await auth.handler(
      new Request(`${BASE}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ email: 'x@y.z', password: GOOD, name: 'X' }),
      }),
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await prisma.user.count({ where: { email: 'x@y.z' } })).toBe(0);

    await expect(
      auth.api.signUpEmail({ body: { email: 'intruder@example.com', password: GOOD, name: 'X' } }),
    ).rejects.toMatchObject({
      body: { code: 'EMAIL_PASSWORD_SIGN_UP_DISABLED' },
    });
    expect(await prisma.user.count()).toBe(0);
  });

  it('rejects a duplicate email, whatever its case or spacing, and leaves the first user alone', async () => {
    const first = await createPasswordUser(prisma, { email: 'owner@example.com', name: 'Owner', password: GOOD }, auth);
    for (const email of ['owner@example.com', 'OWNER@example.com', '  Owner@Example.COM ']) {
      await expect(createPasswordUser(prisma, { email, name: 'Other', password: GOOD }, auth)).rejects.toBeInstanceOf(EmailTakenError);
    }
    expect(await prisma.user.count()).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: first.userId } })).name).toBe('Owner');
  });

  it('lets exactly one of two simultaneous creations of the same email win, and reports the other as taken', async () => {
    const attempts = await Promise.allSettled(
      Array.from({ length: 4 }, (_, i) => createPasswordUser(prisma, { email: 'race@example.com', name: `R${i}`, password: GOOD }, auth)),
    );
    expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(1);
    for (const failed of attempts.filter((a) => a.status === 'rejected')) {
      expect((failed as PromiseRejectedResult).reason).toBeInstanceOf(EmailTakenError);
    }
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.account.count()).toBe(1);
  });

  it("reports the database's unique violation as a taken email when the lookup before it missed the other user", async () => {
    await createPasswordUser(prisma, { email: 'owner@example.com', name: 'Owner', password: GOOD }, auth);
    const ctx = await auth.$context;
    vi.spyOn(ctx.internalAdapter, 'findUserByEmail').mockResolvedValue(null);
    await expect(createPasswordUser(prisma, { email: 'owner@example.com', name: 'Other', password: GOOD }, auth)).rejects.toBeInstanceOf(
      EmailTakenError,
    );
    expect(await prisma.user.count()).toBe(1);
  });

  it.each([
    ['short', 'TOO_SHORT'],
    ['password1234', 'COMMON'],
    ['k'.repeat(129), 'TOO_LONG'],
  ] as const)('refuses the password %#, with the policy reason, before anything is stored', async (password, reason) => {
    expect(checkPasswordPolicy(password)).toBe(reason);
    const error = await createPasswordUser(prisma, { email: 'weak@example.com', name: 'Weak', password }, auth).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PasswordPolicyError);
    expect((error as PasswordPolicyError).reason).toBe(reason);
    expect(await prisma.user.count()).toBe(0);
  });

  it('checks the password before it looks at the email, so a weak password never reveals that an address is taken', async () => {
    await createPasswordUser(prisma, { email: 'taken@example.com', name: 'T', password: GOOD }, auth);
    await expect(createPasswordUser(prisma, { email: 'taken@example.com', name: 'T2', password: 'short' }, auth)).rejects.toBeInstanceOf(
      PasswordPolicyError,
    );
  });

  it('removes the user again when the credential cannot be saved, and reports the original error', async () => {
    const ctx = await auth.$context;
    const failure = new Error('disk on fire');
    vi.spyOn(ctx.internalAdapter, 'linkAccount').mockRejectedValueOnce(failure);
    await expect(createPasswordUser(prisma, { email: 'half@example.com', name: 'Half', password: GOOD }, auth)).rejects.toBe(failure);
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.account.count()).toBe(0);
    // The address is free again.
    await expect(createPasswordUser(prisma, { email: 'half@example.com', name: 'Half', password: GOOD }, auth)).resolves.toBeDefined();
  });
});

describe('the password hash', () => {
  it.each([
    ['short', 'TOO_SHORT'],
    ['password1234', 'COMMON'],
    ['k'.repeat(129), 'TOO_LONG'],
  ] as const)('refuses to hash the password %#, so no route can store it', async (password, reason) => {
    const ctx = await auth.$context;
    const error = await ctx.password.hash(password).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PasswordPolicyError);
    expect((error as PasswordPolicyError).reason).toBe(reason);
  });

  it('hashes an acceptable password in a form that verifies', async () => {
    const ctx = await auth.$context;
    const hash = await ctx.password.hash(GOOD);
    expect(hash).not.toContain(GOOD);
    expect(await ctx.password.verify({ hash, password: GOOD })).toBe(true);
    expect(await ctx.password.verify({ hash, password: `${GOOD}!` })).toBe(false);
  });

  it("stops a reset to a common password that passed Better Auth's own length check, and keeps the old password", async () => {
    const to = address('commonreset');
    await createPasswordUser(prisma, { email: to, name: 'Omar', password: GOOD }, auth);
    await auth.api.requestPasswordReset({ body: { email: to } });
    const [mail] = await mailTo(to);
    const token = new URL(linkIn(mail?.text ?? '')).searchParams.get('token') as string;

    await expect(auth.api.resetPassword({ body: { newPassword: 'password1234', token } })).rejects.toBeInstanceOf(PasswordPolicyError);
    expect((await auth.api.signInEmail({ body: { email: to, password: GOOD } })).user.email).toBe(to);
    await expect(auth.api.signInEmail({ body: { email: to, password: 'password1234' } })).rejects.toMatchObject({ statusCode: 401 });
  });

  it('stops a password change to a common password', async () => {
    await createPasswordUser(prisma, { email: 'owner@example.com', name: 'Owner', password: GOOD }, auth);
    const signedIn = await auth.api.signInEmail({ body: { email: 'owner@example.com', password: GOOD }, returnHeaders: true });
    await expect(
      auth.api.changePassword({
        body: { currentPassword: GOOD, newPassword: 'password1234' },
        headers: cookieHeader(signedIn.headers.getSetCookie()),
      }),
    ).rejects.toBeInstanceOf(PasswordPolicyError);
    expect((await auth.api.signInEmail({ body: { email: 'owner@example.com', password: GOOD } })).user.email).toBe('owner@example.com');
  });
});

describe('signing in', () => {
  it('refuses a wrong password and an unknown email with the same answer', async () => {
    await createPasswordUser(prisma, { email: 'owner@example.com', name: 'Owner', password: GOOD }, auth);
    const wrong = await auth.api.signInEmail({ body: { email: 'owner@example.com', password: `${GOOD}!` } }).catch((e: unknown) => e);
    const unknown = await auth.api.signInEmail({ body: { email: 'nobody@example.com', password: GOOD } }).catch((e: unknown) => e);
    for (const error of [wrong, unknown]) {
      expect(error).toMatchObject({ statusCode: 401, body: { code: 'INVALID_EMAIL_OR_PASSWORD' } });
    }
  });

  it('sets a host-only session cookie named with the studio prefix that lasts thirty days', async () => {
    await createPasswordUser(prisma, { email: 'owner@example.com', name: 'Owner', password: GOOD }, auth);
    const res = await auth.api.signInEmail({ body: { email: 'owner@example.com', password: GOOD }, returnHeaders: true });
    const cookie = res.headers.getSetCookie().find((line) => line.startsWith('studio.session_token='));
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/Max-Age=2592000/i);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).not.toMatch(/Domain=/i);
    expect(cookie).not.toMatch(/Secure/i); // development runs over http
    expect(res.headers.getSetCookie().some((line) => line.startsWith('better-auth.'))).toBe(false);
  });

  it('enrols two-factor under the Studio name, with ten backup codes, and then asks for the code at sign-in', async () => {
    await createPasswordUser(prisma, { email: 'owner@example.com', name: 'Owner', password: GOOD }, auth);
    const jar = new Map<string, string>();
    const signedIn = await auth.api.signInEmail({ body: { email: 'owner@example.com', password: GOOD }, returnHeaders: true });
    const session = cookieHeader(signedIn.headers.getSetCookie(), jar);

    const enabled = await auth.api.enableTwoFactor({ body: { password: GOOD }, headers: session });
    if (enabled.method !== 'totp') throw new Error(`unexpected two-factor method ${enabled.method}`);
    expect(enabled.backupCodes).toHaveLength(10);
    expect(new URL(enabled.totpURI).searchParams.get('issuer')).toBe('Buzzify Studio');

    const verified = await auth.api.verifyTOTP({ body: { code: totpFromUri(enabled.totpURI) }, headers: session, returnHeaders: true });
    expect(verified.headers.getSetCookie().some((line) => line.startsWith('studio.session_token='))).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { email: 'owner@example.com' } })).twoFactorEnabled).toBe(true);

    const again = await auth.api.signInEmail({ body: { email: 'owner@example.com', password: GOOD }, returnHeaders: true });
    expect(again.response).toMatchObject({ twoFactorRedirect: true });
    expect(again.headers.getSetCookie().some((line) => line.startsWith('studio.two_factor='))).toBe(true);
  });

  it('refuses a deactivated user a new session', async () => {
    const { userId } = await createPasswordUser(prisma, { email: 'gone@example.com', name: 'Gone', password: GOOD }, auth);
    await deactivateUser(prisma, userId);
    await expect(auth.api.signInEmail({ body: { email: 'gone@example.com', password: GOOD } })).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.session.count({ where: { userId } })).toBe(0);
  });
});

describe('the actor', () => {
  it('loads memberships into the actor', async () => {
    const { userId } = await createPasswordUser(
      prisma,
      { email: 'owner@example.com', name: 'Owner', password: GOOD, locale: 'ar' },
      auth,
    );
    const a = await prisma.restaurant.create({ data: { name: 'Alpha' } });
    const b = await prisma.restaurant.create({ data: { name: 'Beta' } });
    await prisma.membership.create({ data: { userId, restaurantId: a.id, role: 'OWNER' } });
    await prisma.membership.create({ data: { userId, restaurantId: b.id, role: 'DESIGNER' } });

    const actor = await loadActor(prisma, userId);
    expect(actor).toMatchObject({
      userId,
      email: 'owner@example.com',
      name: 'Owner',
      isSuperAdmin: false,
      twoFactorEnabled: false,
      locale: 'ar',
    });
    expect(actor?.memberships).toHaveLength(2);
    expect(actor?.memberships).toEqual(
      expect.arrayContaining([
        { restaurantId: a.id, role: 'OWNER' },
        { restaurantId: b.id, role: 'DESIGNER' },
      ]),
    );
  });

  it('has no memberships for a user without any, and the Super Admin flag when set', async () => {
    const { userId } = await createPasswordUser(prisma, { email: 'root@example.com', name: 'Root', password: GOOD, isSuperAdmin: true }, auth);
    expect(await loadActor(prisma, userId)).toMatchObject({ isSuperAdmin: true, memberships: [] });
  });

  it('returns no actor for an unknown user', async () => {
    expect(await loadActor(prisma, 'nobody')).toBeNull();
  });

  it('returns no actor for a deactivated user and ends their sessions', async () => {
    const { userId } = await createPasswordUser(prisma, { email: 'owner@example.com', name: 'Owner', password: GOOD }, auth);
    const signedIn = await auth.api.signInEmail({ body: { email: 'owner@example.com', password: GOOD }, returnHeaders: true });
    const session = cookieHeader(signedIn.headers.getSetCookie());
    expect(await auth.api.getSession({ headers: session })).not.toBeNull();
    expect(await loadActor(prisma, userId)).not.toBeNull();

    await deactivateUser(prisma, userId);

    expect(await loadActor(prisma, userId)).toBeNull();
    expect(await auth.api.getSession({ headers: session })).toBeNull();
    expect(await prisma.session.count({ where: { userId } })).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).deactivatedAt).toBeInstanceOf(Date);
  });

  it('removes a user\'s memberships with the user, and a restaurant\'s with the restaurant', async () => {
    const { userId } = await createPasswordUser(prisma, { email: 'owner@example.com', name: 'Owner', password: GOOD }, auth);
    const restaurant = await prisma.restaurant.create({ data: { name: 'Alpha' } });
    await prisma.membership.create({ data: { userId, restaurantId: restaurant.id, role: 'OWNER' } });
    await prisma.restaurant.delete({ where: { id: restaurant.id } });
    expect(await prisma.membership.count()).toBe(0);
    expect(await prisma.user.count()).toBe(1);
  });

  it('allows one membership per user and restaurant', async () => {
    const { userId } = await createPasswordUser(prisma, { email: 'owner@example.com', name: 'Owner', password: GOOD }, auth);
    const restaurant = await prisma.restaurant.create({ data: { name: 'Alpha' } });
    await prisma.membership.create({ data: { userId, restaurantId: restaurant.id, role: 'OWNER' } });
    await expect(prisma.membership.create({ data: { userId, restaurantId: restaurant.id, role: 'DESIGNER' } })).rejects.toMatchObject({ code: 'P2002' });
  });
});

describe('account emails', () => {
  it('sends the reset link to the Studio page, in the user\'s language, without waiting for the send', async () => {
    const to = address('reset');
    await createPasswordUser(prisma, { email: to, name: 'Lina', password: GOOD, locale: 'ar' }, auth);

    await auth.api.requestPasswordReset({ body: { email: to } });
    const [mail] = await mailTo(to);
    const url = new URL(linkIn(mail?.text ?? ''));
    expect(`${url.origin}${url.pathname}`).toBe(`${BASE}/studio/reset`);
    expect(url.searchParams.get('token')).toBeTruthy();
    expect(mail?.subject).toBe(renderEmail('reset', 'ar', { name: 'Lina', url: url.href }).subject);
    expect(mail?.html).toContain('dir="rtl"');
  });

  it('answers a reset request without waiting for the mail to go out', async () => {
    const to = address('slow');
    await createPasswordUser(prisma, { email: to, name: 'Lina', password: GOOD }, auth);
    sending.delayMs = 300;
    await auth.api.requestPasswordReset({ body: { email: to } });
    expect(await readDevMail(to)).toHaveLength(0);
    await mailTo(to); // it does arrive
  });

  it('answers a reset request when the mail cannot be sent, and logs the failure without the address or the link', async () => {
    const to = address('broken');
    await createPasswordUser(prisma, { email: to, name: 'Lina', password: GOOD }, auth);
    sending.failure = new Error('Email delivery failed (rate_limit_exceeded): slow down');
    await expect(auth.api.requestPasswordReset({ body: { email: to } })).resolves.toBeDefined();
    await vi.waitFor(() => expect(console.error).toHaveBeenCalled());
    const logged = vi.mocked(console.error).mock.calls.flat().join(' ');
    expect(logged).toContain('reset');
    expect(logged).toContain('slow down');
    expect(logged).not.toContain(to);
    expect(logged).not.toContain('token');
    expect(await readDevMail(to)).toHaveLength(0);
  });

  it('logs an email-change confirmation that could not be sent, without the addresses, and leaves the address unchanged', async () => {
    const to = address('mover');
    const next = address('moved');
    await createPasswordUser(prisma, { email: to, name: 'Sara', password: GOOD }, auth);
    const signedIn = await auth.api.signInEmail({ body: { email: to, password: GOOD }, returnHeaders: true });
    sending.failure = new Error('Email delivery failed (invalid_from_address): bad sender');

    // A failed send is logged, not thrown, and the request still answers.
    await auth.api.changeEmail({ body: { newEmail: next }, headers: cookieHeader(signedIn.headers.getSetCookie()) });
    await vi.waitFor(() => expect(console.error).toHaveBeenCalled());
    const logged = vi.mocked(console.error).mock.calls.flat().join(' ');
    expect(logged).toContain('changeEmailConfirm');
    expect(logged).toContain('bad sender');
    expect(logged).not.toContain(to);
    expect(logged).not.toContain(next);
    expect((await prisma.user.findFirstOrThrow({ where: { name: 'Sara' } })).email).toBe(to);
  });

  it('answers a reset request for an unknown address like any other, and sends nothing', async () => {
    const to = address('nobody');
    await expect(auth.api.requestPasswordReset({ body: { email: to } })).resolves.toBeDefined();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await readDevMail(to)).toHaveLength(0);
  });

  it('resets the password with the emailed token, ends every session and sends a password-changed notice', async () => {
    const to = address('reset2');
    await createPasswordUser(prisma, { email: to, name: 'Omar', password: GOOD }, auth);
    const old = await auth.api.signInEmail({ body: { email: to, password: GOOD }, returnHeaders: true });
    const oldSession = cookieHeader(old.headers.getSetCookie());

    await auth.api.requestPasswordReset({ body: { email: to } });
    const [resetMail] = await mailTo(to);
    const token = new URL(linkIn(resetMail?.text ?? '')).searchParams.get('token') as string;

    const NEW = 'another long passphrase 2027';
    await auth.api.resetPassword({ body: { newPassword: NEW, token } });

    expect(await auth.api.getSession({ headers: oldSession })).toBeNull();
    await expect(auth.api.signInEmail({ body: { email: to, password: GOOD } })).rejects.toMatchObject({ statusCode: 401 });
    expect((await auth.api.signInEmail({ body: { email: to, password: NEW } })).user.email).toBe(to);

    const mails = await mailTo(to, 2);
    expect(mails.map((m) => m.subject)).toContain(renderEmail('passwordChanged', 'en', { name: 'Omar' }).subject);
    // The token works once.
    await expect(auth.api.resetPassword({ body: { newPassword: 'yet another long passphrase', token } })).rejects.toBeDefined();
  });

  it('refuses a reset token for a password that is too short', async () => {
    const to = address('reset3');
    await createPasswordUser(prisma, { email: to, name: 'Omar', password: GOOD }, auth);
    await auth.api.requestPasswordReset({ body: { email: to } });
    const [mail] = await mailTo(to);
    const token = new URL(linkIn(mail?.text ?? '')).searchParams.get('token') as string;
    await expect(auth.api.resetPassword({ body: { newPassword: 'short', token } })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('confirms an email change with the old address first and then verifies the new one', async () => {
    const oldAddress = address('old');
    const newAddress = address('new');
    await createPasswordUser(prisma, { email: oldAddress, name: 'Sara', password: GOOD, locale: 'ckb' }, auth);
    const signedIn = await auth.api.signInEmail({ body: { email: oldAddress, password: GOOD }, returnHeaders: true });
    const session = cookieHeader(signedIn.headers.getSetCookie());

    await auth.api.changeEmail({ body: { newEmail: newAddress }, headers: session });

    // Leg one: the old address is asked to confirm, and the message names the new one.
    const [confirm] = await mailTo(oldAddress);
    expect(confirm?.subject).toBe(renderEmail('changeEmailConfirm', 'ckb', { name: 'Sara', newEmail: newAddress, url: BASE }).subject);
    expect(confirm?.text).toContain(newAddress);
    const confirmUrl = new URL(linkIn(confirm?.text ?? ''));
    expect(`${confirmUrl.origin}${confirmUrl.pathname}`).toBe(`${BASE}/api/auth/verify-email`);
    expect(await readDevMail(newAddress)).toHaveLength(0);

    // Leg two: following that link makes Better Auth ask the new address to verify.
    await auth.api.verifyEmail({ query: { token: confirmUrl.searchParams.get('token') as string }, headers: session });
    const [verify] = await mailTo(newAddress);
    expect(verify?.subject).toBe(renderEmail('verifyNewEmail', 'ckb', { name: 'Sara', url: BASE }).subject);
    const verifyUrl = new URL(linkIn(verify?.text ?? ''));
    expect(`${verifyUrl.origin}${verifyUrl.pathname}`).toBe(`${BASE}/api/auth/verify-email`);

    // Following that link completes the change.
    await auth.api.verifyEmail({ query: { token: verifyUrl.searchParams.get('token') as string }, headers: session });
    expect((await prisma.user.findFirstOrThrow({ where: { name: 'Sara' } })).email).toBe(newAddress);
  });
});

describe('sending after the response', () => {
  /** Stands in for a request: `after()` records its task instead of running it. */
  function schedule() {
    const tasks: Array<() => Promise<void> | void> = [];
    vi.mocked(after).mockImplementation((task) => {
      tasks.push(task as () => Promise<void> | void);
    });
    return tasks;
  }
  const quiet = () => new Promise((resolve) => setTimeout(resolve, 150));

  it('hands the reset mail to after() and sends nothing until the response is out', async () => {
    const to = address('afterreset');
    await createPasswordUser(prisma, { email: to, name: 'Lina', password: GOOD }, auth);
    const tasks = schedule();

    await auth.api.requestPasswordReset({ body: { email: to } });
    expect(tasks).toHaveLength(1);
    await quiet();
    expect(await readDevMail(to)).toHaveLength(0);

    await tasks[0]?.();
    expect(await readDevMail(to)).toHaveLength(1);
  });

  it('hands the password-changed notice to after() as well', async () => {
    const to = address('afterchanged');
    await createPasswordUser(prisma, { email: to, name: 'Lina', password: GOOD }, auth);
    await auth.api.requestPasswordReset({ body: { email: to } });
    const [mail] = await mailTo(to);
    const token = new URL(linkIn(mail?.text ?? '')).searchParams.get('token') as string;
    const tasks = schedule();

    await auth.api.resetPassword({ body: { newPassword: 'another long passphrase 2027', token } });
    expect(tasks).toHaveLength(1);
    await quiet();
    expect(await readDevMail(to)).toHaveLength(1); // only the reset link so far

    await tasks[0]?.();
    expect(await readDevMail(to)).toHaveLength(2);
  });

  it('hands both email-change mails to after()', async () => {
    const oldAddress = address('afterold');
    const newAddress = address('afternew');
    await createPasswordUser(prisma, { email: oldAddress, name: 'Sara', password: GOOD }, auth);
    const signedIn = await auth.api.signInEmail({ body: { email: oldAddress, password: GOOD }, returnHeaders: true });
    const session = cookieHeader(signedIn.headers.getSetCookie());
    const tasks = schedule();

    await auth.api.changeEmail({ body: { newEmail: newAddress }, headers: session });
    expect(tasks).toHaveLength(1);
    await quiet();
    expect(await readDevMail(oldAddress)).toHaveLength(0);
    await tasks[0]?.();
    const [confirm] = await readDevMail(oldAddress);
    const token = new URL(linkIn(confirm?.text ?? '')).searchParams.get('token') as string;

    await auth.api.verifyEmail({ query: { token }, headers: session });
    expect(tasks).toHaveLength(2);
    await quiet();
    expect(await readDevMail(newAddress)).toHaveLength(0);
    await tasks[1]?.();
    expect(await readDevMail(newAddress)).toHaveLength(1);
  });

  it('starts the send itself when there is no request scope, and still delivers it to the development mail folder', async () => {
    const to = address('noscope');
    await createPasswordUser(prisma, { email: to, name: 'Lina', password: GOOD }, auth);
    // The real after() throws here: this is a test, not a request.
    expect(() => realAfter(() => undefined)).toThrow(/outside a request scope/);

    await auth.api.requestPasswordReset({ body: { email: to } });
    expect(vi.mocked(after)).toHaveBeenCalledTimes(1);
    const [mail] = await mailTo(to);
    expect(mail?.subject).toBe(renderEmail('reset', 'en', { name: 'Lina', url: BASE }).subject);
  });

  it('logs a failure from the scheduled send, without the address, and does not throw', async () => {
    const to = address('afterfail');
    await createPasswordUser(prisma, { email: to, name: 'Lina', password: GOOD }, auth);
    const tasks = schedule();
    sending.failure = new Error('Email delivery failed (rate_limit_exceeded): slow down');

    await auth.api.requestPasswordReset({ body: { email: to } });
    await expect(tasks[0]?.()).resolves.toBeUndefined();
    const logged = vi.mocked(console.error).mock.calls.flat().join(' ');
    expect(logged).toContain('reset');
    expect(logged).toContain('slow down');
    expect(logged).not.toContain(to);
  });
});
