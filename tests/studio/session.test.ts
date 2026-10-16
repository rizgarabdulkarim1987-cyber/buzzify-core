import { headers } from 'next/headers';
import * as OTPAuth from 'otpauth';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import { readDevMail } from '@/server/email/send';
import { renderEmail } from '@/server/email/templates';
import { getAuth } from '@/server/studio/auth/auth';
import { createPasswordUser, deactivateUser } from '@/server/studio/auth/users';
import { invokePublic } from '@/server/studio/framework/invoke';
import type { ActionResult } from '@/server/studio/framework/result';
import * as session from '@/server/studio/public-actions/session';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { Browser, CHALLENGE_COOKIE, SESSION_COOKIE } from '../helpers/browser';
import { requireTestDb, resetTestData } from '../helpers/db';
import { devMail, linkIn, linkParam } from '../helpers/mail';

// Server Actions read the request through `headers()` and write cookies through `cookies()`, which only exist inside
// Next. `Browser` stands in for both, with a cookie jar.
vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const GOOD = 'correct horse battery staple';
const NEW = 'another long passphrase 2027';
const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const { address, mailTo, nextTest, quiet, clean } = devMail();
const prisma = () => getPrisma();

let browser: Browser;

const signIn = (email: string, password: string) => invokePublic(session.signIn, { email, password });
const codeOf = (result: ActionResult<unknown>) => (result.ok ? 'OK' : result.error.code);

const totp = (secret: string, timestamp = Date.now()) =>
  new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30, algorithm: 'SHA1' }).generate({ timestamp });

/** Enrols a user in two-factor through Better Auth and returns what an authenticator app and the recovery sheet hold. */
async function enrol(email: string, password = GOOD): Promise<{ secret: string; backupCodes: string[] }> {
  const phone = new Browser('203.0.113.50', 'enrolment').activate();
  const signedIn = await invokePublic(session.signIn, { email, password });
  expect(signedIn).toEqual({ ok: true, data: { next: '/studio' } });
  const enabled = await getAuth().api.enableTwoFactor({ body: { password }, headers: phone.requestHeaders() });
  if (enabled.method !== 'totp') throw new Error('unexpected two-factor method');
  const secret = new URL(enabled.totpURI).searchParams.get('secret') as string;
  await getAuth().api.verifyTOTP({ body: { code: totp(secret) }, headers: phone.requestHeaders() });
  browser.activate();
  return { secret, backupCodes: enabled.backupCodes };
}

/** A failed sign-in logs a warning from Better Auth, and the dev mailer logs each message: expected noise. */
function silence() {
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
}

beforeAll(async () => {
  requireTestDb();
  // The framework uses the application's client, which reads DATABASE_URL: point it at the test database.
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
  // Never send real mail from a test, whatever the developer's shell exports.
  vi.stubEnv('RESEND_API_KEY', '');
  await resetTestData(prisma());
});

beforeEach(async () => {
  nextTest();
  await resetTestData(prisma());
  browser = new Browser().activate();
  silence();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await clean();
});

afterAll(async () => {
  await quiet();
  await clean();
  await resetTestData(prisma());
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
  vi.unstubAllEnvs();
});

describe('signIn', () => {
  it('signs in with any letter case and surrounding spaces in the email, and keeps the session in a cookie', async () => {
    await createPasswordUser(prisma(), { email: 'owner@example.com', name: 'Owner', password: GOOD });

    expect(await signIn('  Owner@Example.COM ', GOOD)).toEqual({ ok: true, data: { next: '/studio' } });

    expect(browser.has(SESSION_COOKIE)).toBe(true);
    const current = await getAuth().api.getSession({ headers: browser.requestHeaders() });
    expect(current?.user.email).toBe('owner@example.com');
  });

  it("records the request's address and browser on the session", async () => {
    await createPasswordUser(prisma(), { email: 'owner@example.com', name: 'Owner', password: GOOD });
    browser.ip = '198.51.100.9';
    browser.userAgent = 'Mozilla/5.0 (Sign-in test)';
    await signIn('owner@example.com', GOOD);
    expect(await prisma().session.findFirstOrThrow()).toMatchObject({ ipAddress: '198.51.100.9', userAgent: 'Mozilla/5.0 (Sign-in test)' });
  });

  it('answers a wrong password, an unknown email and a deactivated account with one and the same INVALID', async () => {
    await createPasswordUser(prisma(), { email: 'owner@example.com', name: 'Owner', password: GOOD });
    const { userId } = await createPasswordUser(prisma(), { email: 'gone@example.com', name: 'Gone', password: GOOD });
    await deactivateUser(prisma(), userId);

    const wrong = await signIn('owner@example.com', `${GOOD}!`);
    const unknown = await signIn('nobody@example.com', GOOD);
    const deactivated = await signIn('gone@example.com', GOOD);

    expect(wrong).toMatchObject({ ok: false, error: { code: 'INVALID' } });
    expect(unknown).toEqual(wrong);
    expect(deactivated).toEqual(wrong);
    // A generic message: it names neither the address nor what was wrong with it, and carries no per-field detail.
    if (wrong.ok) throw new Error('expected a failure');
    expect(wrong.error.fields).toBeUndefined();
    expect(wrong.error.message).not.toMatch(/owner|nobody|gone|password is|deactivated|exist/i);
    expect(browser.has(SESSION_COOKIE)).toBe(false);
    expect(await prisma().session.count()).toBe(0);
  });

  it('counts every attempt, wrong or right, against the address and the email, using the normalized email', async () => {
    await createPasswordUser(prisma(), { email: 'owner@example.com', name: 'Owner', password: GOOD });

    await signIn('  Owner@Example.COM ', `${GOOD}!`);
    await signIn('OWNER@example.com', GOOD);
    await signIn('nobody@example.com', GOOD);

    const rows = await prisma().authRateLimit.findMany({ orderBy: { key: 'asc' } });
    expect(rows.map((r) => [r.key, r.count])).toEqual([
      ['signin:email:nobody@example.com', 1],
      ['signin:email:owner@example.com', 2],
      ['signin:ip:198.51.100.7', 3],
    ]);
  });

  it('refuses the sixth attempt for one email in ten minutes, even with the right password', async () => {
    await createPasswordUser(prisma(), { email: 'owner@example.com', name: 'Owner', password: GOOD });

    for (let i = 0; i < 5; i += 1) expect(codeOf(await signIn('owner@example.com', `${GOOD}${i}`))).toBe('INVALID');
    const sixth = await signIn('owner@example.com', GOOD);

    expect(sixth).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED', fields: { retryAfterSec: expect.stringMatching(/^\d+$/) } } });
    expect(browser.has(SESSION_COOKIE)).toBe(false);
    // The email's spelling does not give a fresh allowance, and another email is not affected.
    expect(codeOf(await signIn(' OWNER@example.com', GOOD))).toBe('RATE_LIMITED');
    expect(codeOf(await signIn('other@example.com', GOOD))).toBe('INVALID');
  });

  it('refuses the twenty-first attempt from one address, whichever emails it tries, and still counts the email', async () => {
    await prisma().authRateLimit.create({ data: { key: 'signin:ip:198.51.100.7', windowStart: new Date(), count: 20 } });

    const result = await signIn('someone@example.com', GOOD);

    expect(codeOf(result)).toBe('RATE_LIMITED');
    // The refused attempt counted against the email as well, and against the address.
    expect(await prisma().authRateLimit.findUniqueOrThrow({ where: { key: 'signin:email:someone@example.com' } })).toMatchObject({ count: 1 });
    expect(await prisma().authRateLimit.findUniqueOrThrow({ where: { key: 'signin:ip:198.51.100.7' } })).toMatchObject({ count: 21 });
    // Another address is not affected.
    browser.ip = '198.51.100.8';
    expect(codeOf(await signIn('someone@example.com', GOOD))).toBe('INVALID');
  });

  it('shares one bucket among requests whose address is unknown, rather than leaving them unlimited', async () => {
    await prisma().authRateLimit.create({ data: { key: 'signin:ip:unknown', windowStart: new Date(), count: 20 } });
    browser.ip = '';
    expect(codeOf(await signIn('someone@example.com', GOOD))).toBe('RATE_LIMITED');
  });

  it('asks for the second step, and starts no session, when the account has two-factor on', async () => {
    await createPasswordUser(prisma(), { email: 'owner@example.com', name: 'Owner', password: GOOD });
    await enrol('owner@example.com');
    browser = new Browser().activate();

    expect(await signIn('owner@example.com', GOOD)).toEqual({ ok: true, data: { next: '/studio/two-factor' } });

    expect(browser.has(CHALLENGE_COOKIE)).toBe(true);
    expect(browser.has(SESSION_COOKIE)).toBe(false);
    expect(await getAuth().api.getSession({ headers: browser.requestHeaders() })).toBeNull();
  });

  it('sends a Super Admin who has not set up two-factor to the Studio, whose layout then asks for the setup', async () => {
    await createPasswordUser(prisma(), { email: 'root@example.com', name: 'Root', password: GOOD, isSuperAdmin: true });
    expect(await signIn('root@example.com', GOOD)).toEqual({ ok: true, data: { next: '/studio' } });
    expect(browser.has(SESSION_COOKIE)).toBe(true);
  });

  it('rejects input that is not text without counting it', async () => {
    expect(codeOf(await invokePublic(session.signIn, { email: 42, password: GOOD }))).toBe('INVALID');
    expect(codeOf(await invokePublic(session.signIn, null))).toBe('INVALID');
    expect(await prisma().authRateLimit.count()).toBe(0);
  });
});

describe('verifyTwoFactor', () => {
  async function twoFactorUser() {
    await createPasswordUser(prisma(), { email: 'owner@example.com', name: 'Owner', password: GOOD });
    const enrolment = await enrol('owner@example.com');
    browser = new Browser().activate();
    expect(await signIn('owner@example.com', GOOD)).toEqual({ ok: true, data: { next: '/studio/two-factor' } });
    return enrolment;
  }

  it('finishes signing in with a code generated from the enrolment secret', async () => {
    const { secret } = await twoFactorUser();

    expect(await invokePublic(session.verifyTwoFactor, { code: ` ${totp(secret).slice(0, 3)} ${totp(secret).slice(3)} ` })).toEqual({
      ok: true,
      data: { next: '/studio' },
    });

    expect(browser.has(SESSION_COOKIE)).toBe(true);
    expect(browser.has(CHALLENGE_COOKIE)).toBe(false);
    expect((await getAuth().api.getSession({ headers: browser.requestHeaders() }))?.user.email).toBe('owner@example.com');
  });

  it('refuses a wrong code on the code field, leaves the sign-in open, and then accepts the right one', async () => {
    const { secret } = await twoFactorUser();
    const right = totp(secret);
    const wrong = right === '000000' ? '000001' : '000000';

    const refused = await invokePublic(session.verifyTwoFactor, { code: wrong });

    expect(refused).toMatchObject({ ok: false, error: { code: 'INVALID', fields: { code: expect.any(String) } } });
    expect(browser.has(SESSION_COOKIE)).toBe(false);
    expect(codeOf(await invokePublic(session.verifyTwoFactor, { code: right }))).toBe('OK');
  });

  it('accepts a recovery code once; the same code fails the second time', async () => {
    const { backupCodes } = await twoFactorUser();
    const [first, second] = backupCodes as [string, string];

    expect(await invokePublic(session.verifyTwoFactor, { code: first })).toEqual({ ok: true, data: { next: '/studio' } });
    expect(browser.has(SESSION_COOKIE)).toBe(true);

    // A new sign-in, with the used code again.
    browser = new Browser().activate();
    await signIn('owner@example.com', GOOD);
    const again = await invokePublic(session.verifyTwoFactor, { code: first });
    expect(again).toMatchObject({ ok: false, error: { code: 'INVALID', fields: { code: expect.any(String) } } });
    expect(browser.has(SESSION_COOKIE)).toBe(false);
    // Another code still works.
    expect(codeOf(await invokePublic(session.verifyTwoFactor, { code: second }))).toBe('OK');
  });

  it('records the use of a recovery code in the audit log, without the code', async () => {
    const { backupCodes } = await twoFactorUser();
    const [code] = backupCodes as [string];
    await invokePublic(session.verifyTwoFactor, { code });

    const user = await prisma().user.findFirstOrThrow();
    const rows = await prisma().auditLog.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: user.id,
      action: 'account.recovery_code_used',
      entityType: 'User',
      entityId: user.id,
      ip: '198.51.100.7',
    });
    expect(JSON.stringify(rows)).not.toContain(code);
  });

  it('does not take a code from a person whose sign-in has expired or never started', async () => {
    await createPasswordUser(prisma(), { email: 'owner@example.com', name: 'Owner', password: GOOD });
    const { secret } = await enrol('owner@example.com');
    browser = new Browser().activate();

    // No password step yet, so no challenge cookie.
    expect(await invokePublic(session.verifyTwoFactor, { code: totp(secret) })).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHENTICATED' },
    });
    expect(browser.has(SESSION_COOKIE)).toBe(false);
  });

  it('refuses text that is neither a six-digit code nor a recovery code, on the code field', async () => {
    await twoFactorUser();
    for (const code of ['', 'abcdef', '12345', '1234567', 'not-a-recovery-code']) {
      expect(await invokePublic(session.verifyTwoFactor, { code })).toMatchObject({
        ok: false,
        error: { code: 'INVALID', fields: { code: expect.any(String) } },
      });
    }
  });

  it('refuses the sixth attempt for one person in five minutes, even with the right code', async () => {
    const { secret } = await twoFactorUser();
    const right = totp(secret);
    const wrong = right === '000000' ? '000001' : '000000';

    for (let i = 0; i < 5; i += 1) expect(codeOf(await invokePublic(session.verifyTwoFactor, { code: wrong }))).toBe('INVALID');

    expect(codeOf(await invokePublic(session.verifyTwoFactor, { code: right }))).toBe('RATE_LIMITED');
    expect(browser.has(SESSION_COOKIE)).toBe(false);
    const user = await prisma().user.findFirstOrThrow();
    expect((await prisma().authRateLimit.findUniqueOrThrow({ where: { key: `totp:user:${user.id}` } })).count).toBe(6);
  });
});

describe('verifyTwoFactor is for a pending sign-in only', () => {
  /** A user with two-factor on. */
  async function enrolled(email: string) {
    const { userId } = await createPasswordUser(prisma(), { email, name: email, password: GOOD });
    return { userId, ...(await enrol(email)) };
  }

  /** A browser that has done the password step for `email` and holds the two-factor challenge. */
  async function atTheSecondStep(email: string): Promise<Browser> {
    const waiting = new Browser().activate();
    expect(await signIn(email, GOOD)).toEqual({ ok: true, data: { next: '/studio/two-factor' } });
    expect(waiting.has(CHALLENGE_COOKIE)).toBe(true);
    return waiting;
  }

  const totpRows = () => prisma().authRateLimit.findMany({ where: { key: { startsWith: 'totp:user:' } } });
  const refusedAsExpired = { ok: false, error: { code: 'UNAUTHENTICATED' } };

  it('refuses a valid code from a signed-in browser that has begun setting up two-factor, and enables nothing', async () => {
    const { userId } = await createPasswordUser(prisma(), { email: 'dana@example.com', name: 'Dana', password: GOOD });
    await signIn('dana@example.com', GOOD);
    const cookieBefore = browser.jar.get(SESSION_COOKIE);
    const started = await getAuth().api.enableTwoFactor({ body: { password: GOOD }, headers: browser.requestHeaders() });
    if (started.method !== 'totp') throw new Error('unexpected two-factor method');
    const secret = new URL(started.totpURI).searchParams.get('secret') as string;

    // No challenge, only a session: Better Auth would take this for the confirmation step, unlimited and unaudited.
    expect(await invokePublic(session.verifyTwoFactor, { code: totp(secret) })).toMatchObject(refusedAsExpired);

    expect((await prisma().user.findUniqueOrThrow({ where: { id: userId } })).twoFactorEnabled).toBe(false);
    expect((await prisma().twoFactor.findFirstOrThrow({ where: { userId } })).verified).toBe(false);
    expect(browser.jar.get(SESSION_COOKIE)).toBe(cookieBefore);
    expect(await prisma().auditLog.count()).toBe(0);
    expect(await totpRows()).toEqual([]);
  });

  it('gives a signed-in two-factor user no way to test codes: a right code and a wrong one get the same answer, unlimited', async () => {
    const { secret } = await enrolled('owner@example.com');
    browser = await atTheSecondStep('owner@example.com');
    expect(codeOf(await invokePublic(session.verifyTwoFactor, { code: totp(secret) }))).toBe('OK');
    const right = totp(secret);
    const countedByTheSignIn = await totpRows();
    const wrong = right === '000000' ? '000001' : '000000';

    const answers = [];
    for (let i = 0; i < 8; i += 1) answers.push(await invokePublic(session.verifyTwoFactor, { code: i % 2 ? right : wrong }));

    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
    expect(answers[0]).toMatchObject(refusedAsExpired);
    expect(await totpRows()).toEqual(countedByTheSignIn);
  });

  it('does not use up a recovery code sent from a signed-in browser, and audits no use of it', async () => {
    const { backupCodes } = await enrolled('owner@example.com');
    browser = await atTheSecondStep('owner@example.com');
    expect(codeOf(await invokePublic(session.verifyTwoFactor, { code: backupCodes[1] }))).toBe('OK');
    expect(await prisma().auditLog.count()).toBe(1);

    expect(await invokePublic(session.verifyTwoFactor, { code: backupCodes[0] })).toMatchObject(refusedAsExpired);
    expect(await prisma().auditLog.count()).toBe(1);

    // The code is still good for a real sign-in.
    browser = await atTheSecondStep('owner@example.com');
    expect(codeOf(await invokePublic(session.verifyTwoFactor, { code: backupCodes[0] }))).toBe('OK');
    expect(await prisma().auditLog.count()).toBe(2);
  });

  it('checks the challenge and not a session the browser also carries', async () => {
    const other = await enrolled('owner@example.com');
    const waiting = await atTheSecondStep('owner@example.com');
    const { userId: danaId } = await createPasswordUser(prisma(), { email: 'dana@example.com', name: 'Dana', password: GOOD });
    const dana = new Browser('203.0.113.60').activate();
    await signIn('dana@example.com', GOOD);
    dana.jar.set(CHALLENGE_COOKIE, waiting.jar.get(CHALLENGE_COOKIE) as string);
    dana.activate();

    expect(await invokePublic(session.verifyTwoFactor, { code: totp(other.secret) })).toEqual({ ok: true, data: { next: '/studio' } });

    // Dana's session was only carried along: the code was the owner's, and the sign-in that finished is the owner's.
    expect((await getAuth().api.getSession({ headers: dana.requestHeaders() }))?.user.id).toBe(other.userId);
    expect((await prisma().user.findUniqueOrThrow({ where: { id: danaId } })).twoFactorEnabled).toBe(false);
    expect((await totpRows()).map((r) => r.key)).toEqual([`totp:user:${other.userId}`]);
  });

  it('counts attempts made with a quoted challenge cookie, and still accepts the right code in it', async () => {
    const { secret, userId } = await enrolled('owner@example.com');
    browser = await atTheSecondStep('owner@example.com');
    browser.quoted.add(CHALLENGE_COOKIE);
    const right = totp(secret);
    const wrong = right === '000000' ? '000001' : '000000';

    for (let i = 0; i < 5; i += 1) expect(codeOf(await invokePublic(session.verifyTwoFactor, { code: wrong }))).toBe('INVALID');

    expect(codeOf(await invokePublic(session.verifyTwoFactor, { code: right }))).toBe('RATE_LIMITED');
    expect((await prisma().authRateLimit.findUniqueOrThrow({ where: { key: `totp:user:${userId}` } })).count).toBe(6);
    expect(browser.has(SESSION_COOKIE)).toBe(false);
  });

  it('finishes a sign-in whose challenge cookie is quoted', async () => {
    const { secret } = await enrolled('owner@example.com');
    browser = await atTheSecondStep('owner@example.com');
    browser.quoted.add(CHALLENGE_COOKIE);

    expect(codeOf(await invokePublic(session.verifyTwoFactor, { code: totp(secret) }))).toBe('OK');
    expect(browser.has(SESSION_COOKIE)).toBe(true);
  });

  it('counts an attempt against the challenge that is checked, whichever of several challenge cookies is read', async () => {
    const first = await enrolled('owner@example.com');
    const firstBrowser = await atTheSecondStep('owner@example.com');
    const second = await enrolled('other@example.com');
    const secondBrowser = await atTheSecondStep('other@example.com');
    const header = [firstBrowser, secondBrowser]
      .map((b) => `${CHALLENGE_COOKIE}=${encodeURIComponent(b.jar.get(CHALLENGE_COOKIE) as string)}`)
      .join('; ');
    vi.mocked(headers).mockResolvedValue(new Headers({ cookie: header, 'x-forwarded-for': '198.51.100.7' }) as never);
    const wrong = (secret: string) => (totp(secret) === '000000' ? '000001' : '000000');

    for (let i = 0; i < 3; i += 1) {
      expect(codeOf(await invokePublic(session.verifyTwoFactor, { code: wrong(first.secret) }))).toBe('INVALID');
    }

    // One person's limit was counted, and it is the person whose challenge Better Auth checked: only their code works.
    const counted = (await totpRows()).map((r) => [r.key, r.count]);
    expect(counted).toHaveLength(1);
    const [key] = counted[0] as [string, number];
    const countedUser = [first, second].find((u) => key === `totp:user:${u.userId}`);
    expect(countedUser).toBeDefined();
    expect(codeOf(await invokePublic(session.verifyTwoFactor, { code: totp((countedUser as typeof first).secret) }))).toBe('OK');
  });
});

describe('requestPasswordReset', () => {
  it('answers an unknown address like a known one, and sends nothing', async () => {
    const known = address('known');
    await createPasswordUser(prisma(), { email: known, name: 'Lina', password: GOOD });
    const unknown = address('nobody');

    const forKnown = await invokePublic(session.requestPasswordReset, { email: known });
    const forUnknown = await invokePublic(session.requestPasswordReset, { email: unknown });

    expect(forKnown).toEqual({ ok: true, data: { sent: true } });
    expect(forUnknown).toEqual(forKnown);
    await mailTo(known);
    await quiet();
    expect(await readDevMail(unknown)).toHaveLength(0);
  });

  it('sends one reset email for an address typed with other letter case and spaces, with a link the reset accepts once', async () => {
    const to = address('reset');
    await createPasswordUser(prisma(), { email: to, name: 'Lina', password: GOOD });
    const old = new Browser().activate();
    await signIn(to, GOOD);
    const oldSession = old.requestHeaders();

    expect(await invokePublic(session.requestPasswordReset, { email: `  ${to.toUpperCase()} ` })).toEqual({ ok: true, data: { sent: true } });

    const [mail] = await mailTo(to);
    await quiet();
    expect(await readDevMail(to)).toHaveLength(1);
    expect(mail?.subject).toBe(renderEmail('reset', 'en', { name: 'Lina', url: 'http://127.0.0.1:3100' }).subject);
    const url = new URL(linkIn(mail?.text ?? ''));
    expect(`${url.origin}${url.pathname}`).toBe('http://127.0.0.1:3100/studio/reset');
    const token = url.searchParams.get('token') as string;
    expect(token).toBeTruthy();

    browser = new Browser('203.0.113.77').activate();
    expect(await invokePublic(session.resetPassword, { token, password: NEW })).toEqual({ ok: true, data: { next: '/studio/sign-in' } });

    // Every session that existed is gone, the old password is dead, and the new one signs in.
    expect(await getAuth().api.getSession({ headers: oldSession })).toBeNull();
    expect(await prisma().session.count()).toBe(0);
    expect(codeOf(await signIn(to, GOOD))).toBe('INVALID');
    expect(codeOf(await signIn(to, NEW))).toBe('OK');
    // The person is told, and the token works once.
    const mails = await mailTo(to, 2);
    expect(mails.map((m) => m.subject)).toContain(renderEmail('passwordChanged', 'en', { name: 'Lina' }).subject);
    expect(await invokePublic(session.resetPassword, { token, password: 'yet another long passphrase' })).toMatchObject({
      ok: false,
      error: { code: 'INVALID', fields: { token: expect.any(String) } },
    });
  });

  it('records a reset in the audit log for the person it happened to, with no password or token', async () => {
    const to = address('audited');
    const { userId } = await createPasswordUser(prisma(), { email: to, name: 'Lina', password: GOOD });
    await invokePublic(session.requestPasswordReset, { email: to });
    const token = linkParam((await mailTo(to))[0]?.text ?? '', 'token');

    browser = new Browser('203.0.113.78', 'Reset browser').activate();
    await invokePublic(session.resetPassword, { token, password: NEW });

    const rows = await prisma().auditLog.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: userId,
      action: 'account.password_reset',
      entityType: 'User',
      entityId: userId,
      ip: '203.0.113.78',
      userAgent: 'Reset browser',
    });
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(JSON.stringify(rows)).not.toContain(NEW);
  });

  it('sends nothing to a deactivated account, and answers as for any other address', async () => {
    const to = address('gone');
    const { userId } = await createPasswordUser(prisma(), { email: to, name: 'Gone', password: GOOD });
    await deactivateUser(prisma(), userId);

    expect(await invokePublic(session.requestPasswordReset, { email: to })).toEqual({ ok: true, data: { sent: true } });

    await quiet();
    expect(await readDevMail(to)).toHaveLength(0);
  });

  it('refuses the fourth request for one address in an hour, whether or not it has an account', async () => {
    const known = address('known');
    await createPasswordUser(prisma(), { email: known, name: 'Lina', password: GOOD });
    const unknown = address('nobody');
    for (const email of [known, unknown]) {
      const answers = [];
      for (let i = 0; i < 4; i += 1) answers.push(codeOf(await invokePublic(session.requestPasswordReset, { email: i % 2 ? email.toUpperCase() : email })));
      expect(answers).toEqual(['OK', 'OK', 'OK', 'RATE_LIMITED']);
    }
    await mailTo(known, 3);
  });

  it('refuses the twenty-first request from one address, for any addresses', async () => {
    await prisma().authRateLimit.create({ data: { key: 'reset:ip:198.51.100.7', windowStart: new Date(), count: 20 } });
    expect(codeOf(await invokePublic(session.requestPasswordReset, { email: address('any') }))).toBe('RATE_LIMITED');
  });

  it('refuses an address that cannot be one, on the email field', async () => {
    expect(await invokePublic(session.requestPasswordReset, { email: 'not an email' })).toMatchObject({
      ok: false,
      error: { code: 'INVALID', fields: { email: expect.any(String) } },
    });
    expect(await prisma().authRateLimit.count()).toBe(0);
  });
});

describe('resetPassword', () => {
  async function resetToken(label: string) {
    const to = address(label);
    const { userId } = await createPasswordUser(prisma(), { email: to, name: 'Omar', password: GOOD });
    await invokePublic(session.requestPasswordReset, { email: to });
    const token = linkParam((await mailTo(to))[0]?.text ?? '', 'token');
    return { to, userId, token };
  }

  it.each([
    ['password1234', 'COMMON'],
    ['short', 'TOO_SHORT'],
    ['k'.repeat(129), 'TOO_LONG'],
  ])('refuses the password %j on the password field, keeps the old one, and does not spend the token', async (password) => {
    const { to, token } = await resetToken('policy');

    expect(await invokePublic(session.resetPassword, { token, password })).toMatchObject({
      ok: false,
      error: { code: 'INVALID', fields: { password: expect.any(String) } },
    });

    expect(codeOf(await signIn(to, GOOD))).toBe('OK');
    expect(await invokePublic(session.resetPassword, { token, password: NEW })).toEqual({ ok: true, data: { next: '/studio/sign-in' } });
  });

  it('counts against the same per-address limit as asking for a reset, and refuses without spending the token', async () => {
    const { to, token } = await resetToken('limited');
    const key = 'reset:ip:198.51.100.7';
    // The request for the link was the first count; the address has now used up its allowance.
    expect((await prisma().authRateLimit.findUniqueOrThrow({ where: { key } })).count).toBe(1);
    await prisma().authRateLimit.update({ where: { key }, data: { count: 20 } });

    const refused = await invokePublic(session.resetPassword, { token, password: NEW });

    expect(refused).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED', fields: { retryAfterSec: expect.stringMatching(/^\d+$/) } } });
    expect((await prisma().authRateLimit.findUniqueOrThrow({ where: { key } })).count).toBe(21);
    // Nothing happened: the token is still there, the old password still works, and once the window is over it resets.
    expect(await prisma().verification.count({ where: { identifier: `reset-password:${token}` } })).toBe(1);
    expect(codeOf(await signIn(to, GOOD))).toBe('OK');
    await prisma().authRateLimit.delete({ where: { key } });
    expect(await invokePublic(session.resetPassword, { token, password: NEW })).toEqual({ ok: true, data: { next: '/studio/sign-in' } });
  });

  it('refuses a token that does not exist, on the token field, without saying why', async () => {
    const result = await invokePublic(session.resetPassword, { token: 'not-a-real-token', password: NEW });
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID', fields: { token: expect.any(String) } } });
  });
});

describe('signOut', () => {
  it('ends the session and clears the cookie', async () => {
    await createPasswordUser(prisma(), { email: 'owner@example.com', name: 'Owner', password: GOOD });
    await signIn('owner@example.com', GOOD);
    const held = browser.requestHeaders();
    expect(await prisma().session.count()).toBe(1);

    expect(await invokePublic(session.signOut, undefined)).toEqual({ ok: true, data: { next: '/studio/sign-in' } });

    expect(browser.has(SESSION_COOKIE)).toBe(false);
    expect(await prisma().session.count()).toBe(0);
    expect(await getAuth().api.getSession({ headers: held })).toBeNull();
  });

  it('answers the same when nobody is signed in, and accepts whatever a form sends along', async () => {
    expect(await invokePublic(session.signOut, undefined)).toEqual({ ok: true, data: { next: '/studio/sign-in' } });
    expect(await invokePublic(session.signOut, new FormData())).toEqual({ ok: true, data: { next: '/studio/sign-in' } });
  });
});
