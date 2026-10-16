import * as OTPAuth from 'otpauth';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import { readDevMail } from '@/server/email/send';
import { renderEmail } from '@/server/email/templates';
import * as accountActions from '@/server/studio/actions/account';
import { getAuth } from '@/server/studio/auth/auth';
import { createPasswordUser } from '@/server/studio/auth/users';
import { invoke, invokePublic, invokeQuery } from '@/server/studio/framework/invoke';
import type { ActionResult } from '@/server/studio/framework/result';
import * as session from '@/server/studio/public-actions/session';
import * as accountQueries from '@/server/studio/queries/account';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { Browser, SESSION_COOKIE } from '../helpers/browser';
import { requireTestDb, resetTestData } from '../helpers/db';
import { devMail, linkParam } from '../helpers/mail';

// Server Actions read the request through `headers()` and write cookies through `cookies()`, which only exist inside
// Next. `Browser` stands in for both, with a cookie jar.
vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const GOOD = 'correct horse battery staple';
const NEW = 'another long passphrase 2027';
const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const { address, mailTo, nextTest, quiet, clean } = devMail();
const prisma = () => getPrisma();

const codeOf = (result: ActionResult<unknown>) => (result.ok ? 'OK' : result.error.code);
const failureOf = (result: ActionResult<unknown>) => {
  if (result.ok) throw new Error(`expected a failure, got ${JSON.stringify(result.data)}`);
  return result.error;
};
const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  return result.data;
};

const totp = (secret: string, timestamp = Date.now()) =>
  new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30, algorithm: 'SHA1' }).generate({ timestamp });
const wrongCode = (secret: string) => (totp(secret) === '000000' ? '000001' : '000000');

/** A browser that has signed in as `email`, through the sign-in action. */
async function signedIn(email: string, password = GOOD, ip = '198.51.100.7', userAgent = 'Mozilla/5.0 (vitest browser)') {
  const browser = new Browser(ip, userAgent).activate();
  expect(await invokePublic(session.signIn, { email, password })).toMatchObject({ ok: true });
  return browser;
}

/** Turns two-factor on for the signed-in browser, through the actions. Returns the secret and the recovery codes. */
async function enableTwoFactor(browser: Browser, password = GOOD) {
  browser.activate();
  const started = dataOf(await invoke(accountActions.startTwoFactorSetup, { password }));
  dataOf(await invoke(accountActions.confirmTwoFactor, { code: totp(started.secret) }));
  return { secret: started.secret, backupCodes: started.backupCodes };
}

/**
 * Who a browser's session belongs to, or null. Better Auth clears the cookies of a session that no longer exists, and
 * `nextCookies()` writes that to whichever browser is active, so the browser asked about is made the active one first.
 */
async function sessionOf(browser: Browser) {
  browser.activate();
  return getAuth().api.getSession({ headers: browser.requestHeaders() });
}
const userIdOf = async (browser: Browser) => (await sessionOf(browser))?.user.id ?? null;
const emailOf = async (browser: Browser) => (await sessionOf(browser))?.user.email ?? null;

const auditRows = () => prisma().auditLog.findMany({ orderBy: { occurredAt: 'asc' } });

/** What a sign-in with the password gives a browser that has not signed in: a session, or the second step. */
async function signInResult(email: string, password: string) {
  new Browser('203.0.113.99', 'fresh browser').activate();
  return invokePublic(session.signIn, { email, password });
}

let dana: { userId: string };
let danaBrowser: Browser;

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
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  dana = await createPasswordUser(prisma(), { email: address('dana'), name: 'Dana', password: GOOD });
  danaBrowser = await signedIn(address('dana'));
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

describe('who may use the account actions', () => {
  const samples = [
    ['startTwoFactorSetup', accountActions.startTwoFactorSetup, { password: GOOD }],
    ['confirmTwoFactor', accountActions.confirmTwoFactor, { code: '123456' }],
    ['regenerateRecoveryCodes', accountActions.regenerateRecoveryCodes, { password: GOOD }],
    ['disableTwoFactor', accountActions.disableTwoFactor, { password: GOOD }],
    ['changePassword', accountActions.changePassword, { current: GOOD, next: NEW }],
    ['requestEmailChange', accountActions.requestEmailChange, { newEmail: 'new@example.com' }],
    ['setStudioLanguage', accountActions.setStudioLanguage, { locale: 'ar' }],
    ['endSession', accountActions.endSession, { sessionId: 'x' }],
    ['endOtherSessions', accountActions.endOtherSessions, undefined],
  ] as const;

  it.each(samples)('%s refuses a request without a session', async (_name, def, input) => {
    new Browser().activate();
    expect(codeOf(await invoke(def as never, input))).toBe('UNAUTHENTICATED');
  });

  it('listMySessions refuses a request without a session', async () => {
    new Browser().activate();
    expect(codeOf(await invokeQuery(accountQueries.listMySessions, undefined))).toBe('UNAUTHENTICATED');
  });

  it('lets a Super Admin without two-factor run only what enrolling needs', async () => {
    await createPasswordUser(prisma(), { email: 'root@example.com', name: 'Root', password: GOOD, isSuperAdmin: true });
    const root = await signedIn('root@example.com');
    root.activate();

    const refused = samples.filter(([name]) => !['startTwoFactorSetup', 'confirmTwoFactor', 'setStudioLanguage'].includes(name));
    for (const [name, def, input] of refused) {
      expect([name, codeOf(await invoke(def as never, input))]).toEqual([name, 'TWO_FACTOR_REQUIRED']);
    }
    expect(codeOf(await invokeQuery(accountQueries.listMySessions, undefined))).toBe('TWO_FACTOR_REQUIRED');

    expect(codeOf(await invoke(accountActions.setStudioLanguage, { locale: 'ckb' }))).toBe('OK');
    const { secret } = dataOf(await invoke(accountActions.startTwoFactorSetup, { password: GOOD }));
    expect(codeOf(await invoke(accountActions.confirmTwoFactor, { code: totp(secret) }))).toBe('OK');

    // With two-factor on the same person may use the rest.
    expect(codeOf(await invoke(accountActions.setStudioLanguage, { locale: 'en' }))).toBe('OK');
    expect(codeOf(await invokeQuery(accountQueries.listMySessions, undefined))).toBe('OK');
  });
});

describe('two-factor enrolment', () => {
  it('refuses a wrong password on the password field and starts nothing', async () => {
    expect(failureOf(await invoke(accountActions.startTwoFactorSetup, { password: `${GOOD}!` }))).toMatchObject({
      code: 'INVALID',
      fields: { password: expect.any(String) },
    });
    expect(await prisma().twoFactor.count()).toBe(0);
  });

  it('gives the key, the link, a QR code drawn on the server and ten recovery codes, and does not turn two-factor on yet', async () => {
    const started = dataOf(await invoke(accountActions.startTwoFactorSetup, { password: GOOD }));

    expect(started.totpUri).toMatch(/^otpauth:\/\/totp\//);
    expect(new URL(started.totpUri).searchParams.get('issuer')).toBe('Buzzify Studio');
    expect(started.secret).toMatch(/^[A-Z2-7]{16,}$/);
    expect(new URL(started.totpUri).searchParams.get('secret')).toBe(started.secret);
    expect(started.qrSvg).toMatch(/^<\?xml[^>]*>\s*<svg|^<svg/);
    expect(started.qrSvg).not.toMatch(/<script|<image|href=/i);
    expect(started.backupCodes).toHaveLength(10);
    expect(new Set(started.backupCodes).size).toBe(10);
    for (const code of started.backupCodes) expect(code).toMatch(/^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$/);

    expect((await prisma().user.findUniqueOrThrow({ where: { id: dana.userId } })).twoFactorEnabled).toBe(false);
    expect(await signInResult(address('dana'), GOOD)).toEqual({ ok: true, data: { next: '/studio' } });
  });

  it('turns two-factor on with a code from the key, replaces the session cookie, and audits it without any secret', async () => {
    danaBrowser.activate();
    const started = dataOf(await invoke(accountActions.startTwoFactorSetup, { password: GOOD }));
    const before = danaBrowser.jar.get(SESSION_COOKIE);

    expect(failureOf(await invoke(accountActions.confirmTwoFactor, { code: wrongCode(started.secret) }))).toMatchObject({
      code: 'INVALID',
      fields: { code: expect.any(String) },
    });
    expect((await prisma().user.findUniqueOrThrow({ where: { id: dana.userId } })).twoFactorEnabled).toBe(false);

    expect(await invoke(accountActions.confirmTwoFactor, { code: ` ${totp(started.secret)} ` })).toEqual({ ok: true, data: { enabled: true } });

    expect((await prisma().user.findUniqueOrThrow({ where: { id: dana.userId } })).twoFactorEnabled).toBe(true);
    // Better Auth starts a new session when two-factor turns on; the browser carries the new one and still works.
    const after = danaBrowser.jar.get(SESSION_COOKIE);
    expect(after).toBeTruthy();
    expect(after).not.toBe(before);
    expect(await userIdOf(danaBrowser)).toBe(dana.userId);
    expect(codeOf(await invoke(accountActions.setStudioLanguage, { locale: 'ar' }))).toBe('OK');

    const rows = await auditRows();
    const enabled = rows.filter((r) => r.action === 'account.two_factor_enabled');
    expect(enabled).toHaveLength(1);
    expect(enabled[0]).toMatchObject({
      actorId: dana.userId,
      entityType: 'User',
      entityId: dana.userId,
      restaurantId: null,
      menuId: null,
      ip: '198.51.100.7',
      userAgent: 'Mozilla/5.0 (vitest browser)',
    });
    const everything = JSON.stringify(rows);
    expect(everything).not.toContain(started.secret);
    for (const code of started.backupCodes) expect(everything).not.toContain(code);
  });

  it('asks for the second step at the next sign-in once it is on', async () => {
    await enableTwoFactor(danaBrowser);
    expect(await signInResult(address('dana'), GOOD)).toEqual({ ok: true, data: { next: '/studio/two-factor' } });
  });

  it('refuses to confirm before setup has started', async () => {
    danaBrowser.activate();
    expect(codeOf(await invoke(accountActions.confirmTwoFactor, { code: '123456' }))).toBe('INVALID');
  });

  it('refuses to start or confirm again once two-factor is on', async () => {
    const { secret } = await enableTwoFactor(danaBrowser);
    expect(codeOf(await invoke(accountActions.startTwoFactorSetup, { password: GOOD }))).toBe('CONFLICT');
    expect(codeOf(await invoke(accountActions.confirmTwoFactor, { code: totp(secret) }))).toBe('CONFLICT');
  });

  it('starting again before confirming replaces the key', async () => {
    const first = dataOf(await invoke(accountActions.startTwoFactorSetup, { password: GOOD }));
    const second = dataOf(await invoke(accountActions.startTwoFactorSetup, { password: GOOD }));
    expect(second.secret).not.toBe(first.secret);
    expect(await prisma().twoFactor.count()).toBe(1);
    expect(codeOf(await invoke(accountActions.confirmTwoFactor, { code: totp(second.secret) }))).toBe('OK');
  });

  it('refuses the sixth code in five minutes, even the right one', async () => {
    const { secret } = dataOf(await invoke(accountActions.startTwoFactorSetup, { password: GOOD }));
    for (let i = 0; i < 5; i += 1) expect(codeOf(await invoke(accountActions.confirmTwoFactor, { code: wrongCode(secret) }))).toBe('INVALID');
    expect(failureOf(await invoke(accountActions.confirmTwoFactor, { code: totp(secret) }))).toMatchObject({
      code: 'RATE_LIMITED',
      fields: { retryAfterSec: expect.stringMatching(/^\d+$/) },
    });
    expect((await prisma().user.findUniqueOrThrow({ where: { id: dana.userId } })).twoFactorEnabled).toBe(false);
  });

  it('refuses a code that is not six digits on the code field', async () => {
    for (const code of ['', 'abcdef', '12345', '1234567']) {
      expect(failureOf(await invoke(accountActions.confirmTwoFactor, { code }))).toMatchObject({ code: 'INVALID', fields: { code: expect.any(String) } });
    }
  });
});

describe('recovery codes', () => {
  it('replaces the ten codes: the old ones stop working and the new ones sign in once', async () => {
    const { backupCodes: oldCodes } = await enableTwoFactor(danaBrowser);
    danaBrowser.activate();

    const fresh = dataOf(await invoke(accountActions.regenerateRecoveryCodes, { password: GOOD }));

    expect(fresh.backupCodes).toHaveLength(10);
    expect(fresh.backupCodes.filter((code) => oldCodes.includes(code))).toEqual([]);
    expect(await signInResult(address('dana'), GOOD)).toEqual({ ok: true, data: { next: '/studio/two-factor' } });
    expect(codeOf(await invokePublic(session.verifyTwoFactor, { code: oldCodes[0] }))).toBe('INVALID');
    expect(codeOf(await invokePublic(session.verifyTwoFactor, { code: fresh.backupCodes[0] }))).toBe('OK');

    const rows = (await auditRows()).filter((r) => r.action === 'account.recovery_codes_regenerated');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: dana.userId, entityId: dana.userId });
    for (const code of [...oldCodes, ...fresh.backupCodes]) expect(JSON.stringify(rows)).not.toContain(code);
  });

  it('asks for the password, and for two-factor to be on', async () => {
    expect(codeOf(await invoke(accountActions.regenerateRecoveryCodes, { password: GOOD }))).toBe('CONFLICT');
    await enableTwoFactor(danaBrowser);
    danaBrowser.activate();
    expect(failureOf(await invoke(accountActions.regenerateRecoveryCodes, { password: `${GOOD}!` }))).toMatchObject({
      code: 'INVALID',
      fields: { password: expect.any(String) },
    });
  });
});

describe('disableTwoFactor', () => {
  it('turns it off for someone who is not a Super Admin, with the password, and the next sign-in has no second step', async () => {
    await enableTwoFactor(danaBrowser);
    danaBrowser.activate();
    expect(failureOf(await invoke(accountActions.disableTwoFactor, { password: `${GOOD}!` }))).toMatchObject({
      code: 'INVALID',
      fields: { password: expect.any(String) },
    });
    expect((await prisma().user.findUniqueOrThrow({ where: { id: dana.userId } })).twoFactorEnabled).toBe(true);

    expect(await invoke(accountActions.disableTwoFactor, { password: GOOD })).toEqual({ ok: true, data: { enabled: false } });

    expect((await prisma().user.findUniqueOrThrow({ where: { id: dana.userId } })).twoFactorEnabled).toBe(false);
    expect(await prisma().twoFactor.count()).toBe(0);
    expect(await signInResult(address('dana'), GOOD)).toEqual({ ok: true, data: { next: '/studio' } });
    // This browser keeps working: its session was replaced.
    danaBrowser.activate();
    expect(await userIdOf(danaBrowser)).toBe(dana.userId);
    expect((await auditRows()).filter((r) => r.action === 'account.two_factor_disabled')).toHaveLength(1);
  });

  it('is refused for a Super Admin, who stays enrolled', async () => {
    await createPasswordUser(prisma(), { email: 'root@example.com', name: 'Root', password: GOOD, isSuperAdmin: true });
    const root = await signedIn('root@example.com');
    await enableTwoFactor(root);
    root.activate();

    expect(failureOf(await invoke(accountActions.disableTwoFactor, { password: GOOD }))).toMatchObject({ code: 'FORBIDDEN' });

    const user = await prisma().user.findUniqueOrThrow({ where: { email: 'root@example.com' } });
    expect(user.twoFactorEnabled).toBe(true);
    expect(await prisma().twoFactor.count({ where: { userId: user.id } })).toBe(1);
    expect((await auditRows()).filter((r) => r.action === 'account.two_factor_disabled')).toHaveLength(0);
  });
});

describe('changePassword', () => {
  it('refuses a common password with the reason on the next field, and changes nothing', async () => {
    const result = await invoke(accountActions.changePassword, { current: GOOD, next: 'password1234' });
    expect(failureOf(result)).toMatchObject({ code: 'INVALID', fields: { next: expect.any(String) } });
    expect(failureOf(result).fields).not.toHaveProperty('current');
    expect(codeOf(await signInResult(address('dana'), GOOD))).toBe('OK');
  });

  it.each([
    ['short', 'TOO_SHORT'],
    ['k'.repeat(129), 'TOO_LONG'],
  ])('refuses the password %j on the next field', async (next) => {
    expect(failureOf(await invoke(accountActions.changePassword, { current: GOOD, next }))).toMatchObject({
      code: 'INVALID',
      fields: { next: expect.any(String) },
    });
  });

  it('gives a different message for each reason the policy refuses', async () => {
    const messages = new Set<string>();
    for (const next of ['short', 'password1234', 'k'.repeat(129)]) {
      messages.add(failureOf(await invoke(accountActions.changePassword, { current: GOOD, next })).fields?.next ?? '');
    }
    expect(messages.size).toBe(3);
    expect(messages.has('')).toBe(false);
  });

  it('refuses a wrong current password on the current field', async () => {
    expect(failureOf(await invoke(accountActions.changePassword, { current: `${GOOD}!`, next: NEW }))).toMatchObject({
      code: 'INVALID',
      fields: { current: expect.any(String) },
    });
    expect(codeOf(await signInResult(address('dana'), GOOD))).toBe('OK');
  });

  it('changes the password, ends every other session, keeps this one, and tells the person by email', async () => {
    const other = await signedIn(address('dana'), GOOD, '203.0.113.5', 'Other device');
    expect(await prisma().session.count()).toBe(2);
    danaBrowser.activate();
    const before = danaBrowser.jar.get(SESSION_COOKIE);

    expect(await invoke(accountActions.changePassword, { current: GOOD, next: NEW })).toEqual({ ok: true, data: { changed: true } });

    // The other device is signed out; this browser carries a new session cookie and still works.
    expect(await userIdOf(other)).toBeNull();
    expect(danaBrowser.jar.get(SESSION_COOKIE)).not.toBe(before);
    expect(await userIdOf(danaBrowser)).toBe(dana.userId);
    expect(await prisma().session.count()).toBe(1);
    expect(codeOf(await signInResult(address('dana'), GOOD))).toBe('INVALID');
    expect(codeOf(await signInResult(address('dana'), NEW))).toBe('OK');

    const [mail] = await mailTo(address('dana'));
    expect(mail?.subject).toBe(renderEmail('passwordChanged', 'en', { name: 'Dana' }).subject);
  });

  it("sends the notice in the person's Studio language", async () => {
    await createPasswordUser(prisma(), { email: address('lina'), name: 'Lina', password: GOOD, locale: 'ar' });
    await signedIn(address('lina'));

    dataOf(await invoke(accountActions.changePassword, { current: GOOD, next: NEW }));

    const [mail] = await mailTo(address('lina'));
    expect(mail?.subject).toBe(renderEmail('passwordChanged', 'ar', { name: 'Lina' }).subject);
    expect(mail?.html).toContain('dir="rtl"');
  });

  it('sends nothing when the change is refused', async () => {
    await invoke(accountActions.changePassword, { current: `${GOOD}!`, next: NEW });
    await invoke(accountActions.changePassword, { current: GOOD, next: 'password1234' });
    await quiet();
    expect(await readDevMail(address('dana'))).toHaveLength(0);
  });

  it('audits the change without either password', async () => {
    dataOf(await invoke(accountActions.changePassword, { current: GOOD, next: NEW }));

    const rows = (await auditRows()).filter((r) => r.action === 'account.password_changed');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: dana.userId, entityType: 'User', entityId: dana.userId, changes: {} });
    expect(JSON.stringify(rows)).not.toContain(GOOD);
    expect(JSON.stringify(rows)).not.toContain(NEW);
  });

  it('counts every password check against a limit of ten in ten minutes', async () => {
    for (let i = 0; i < 10; i += 1) expect(codeOf(await invoke(accountActions.changePassword, { current: `${GOOD}${i}`, next: NEW }))).toBe('INVALID');

    expect(failureOf(await invoke(accountActions.changePassword, { current: GOOD, next: NEW }))).toMatchObject({ code: 'RATE_LIMITED' });
    // The limit is shared by every action that asks for the password.
    expect(codeOf(await invoke(accountActions.startTwoFactorSetup, { password: GOOD }))).toBe('RATE_LIMITED');
    expect(codeOf(await signInResult(address('dana'), GOOD))).toBe('OK');
  });
});

describe('requestEmailChange', () => {
  const NEW_ADDRESS = () => address('dana-new');

  it("asks the old address to confirm, in the person's language, and changes nothing yet", async () => {
    await createPasswordUser(prisma(), { email: address('sara'), name: 'Sara', password: GOOD, locale: 'ckb' });
    const sara = await signedIn(address('sara'));
    sara.activate();

    expect(await invoke(accountActions.requestEmailChange, { newEmail: `  ${NEW_ADDRESS().toUpperCase()} ` })).toEqual({
      ok: true,
      data: { sent: true },
    });

    const [confirm] = await mailTo(address('sara'));
    expect(confirm?.subject).toBe(
      renderEmail('changeEmailConfirm', 'ckb', { name: 'Sara', newEmail: NEW_ADDRESS(), url: 'http://127.0.0.1:3100' }).subject,
    );
    expect(confirm?.text).toContain(NEW_ADDRESS());
    await quiet();
    expect(await readDevMail(NEW_ADDRESS())).toHaveLength(0);
    expect((await prisma().user.findFirstOrThrow({ where: { name: 'Sara' } })).email).toBe(address('sara'));
  });

  it('audits the request with the address asked for', async () => {
    await invoke(accountActions.requestEmailChange, { newEmail: NEW_ADDRESS() });
    const rows = (await auditRows()).filter((r) => r.action === 'account.email_change_requested');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: dana.userId,
      entityId: dana.userId,
      changes: { requestedEmail: { before: null, after: NEW_ADDRESS() } },
    });
  });

  it('refuses an address that cannot be one, or is the current one, on the new email field', async () => {
    for (const newEmail of ['not an email', '', address('dana').toUpperCase()]) {
      expect(failureOf(await invoke(accountActions.requestEmailChange, { newEmail }))).toMatchObject({
        code: 'INVALID',
        fields: { newEmail: expect.any(String) },
      });
    }
    await quiet();
    expect(await readDevMail(address('dana'))).toHaveLength(0);
  });

  it('answers an address that belongs to someone else like any other, and sends nobody anything', async () => {
    await createPasswordUser(prisma(), { email: address('taken'), name: 'Taken', password: GOOD });

    expect(await invoke(accountActions.requestEmailChange, { newEmail: address('taken') })).toEqual({ ok: true, data: { sent: true } });

    await quiet();
    expect(await readDevMail(address('dana'))).toHaveLength(0);
    expect(await readDevMail(address('taken'))).toHaveLength(0);
    expect((await prisma().user.findUniqueOrThrow({ where: { id: dana.userId } })).email).toBe(address('dana'));
  });

  it('completes in the browser that has the session, and a link opened without one starts no session', async () => {
    dataOf(await invoke(accountActions.requestEmailChange, { newEmail: NEW_ADDRESS() }));
    const confirmToken = linkParam((await mailTo(address('dana')))[0]?.text ?? '', 'token');

    // Confirming from the old address needs no session, and starts none.
    const bare = new Headers({ 'user-agent': 'a mail client' });
    await getAuth().api.verifyEmail({ query: { token: confirmToken }, headers: bare });
    const verifyToken = linkParam((await mailTo(NEW_ADDRESS()))[0]?.text ?? '', 'token');
    expect(await prisma().session.count()).toBe(1);

    // The last link would start a session for whoever opens it, without a password and without two-factor. It does not.
    await expect(getAuth().api.verifyEmail({ query: { token: verifyToken }, headers: bare })).rejects.toMatchObject({ statusCode: 302 });
    const over = await getAuth().handler(
      new Request(`http://127.0.0.1:3100/api/auth/verify-email?token=${encodeURIComponent(verifyToken)}`, { headers: bare }),
    );
    expect(over.status).toBe(302);
    expect(over.headers.get('location')).toBe('/studio/sign-in');
    expect(over.headers.getSetCookie()).toEqual([]);
    expect(await prisma().session.count()).toBe(1);
    expect((await prisma().user.findUniqueOrThrow({ where: { id: dana.userId } })).email).toBe(address('dana'));

    // Opened in the browser that is signed in, the same link completes the change.
    danaBrowser.activate();
    await getAuth().api.verifyEmail({ query: { token: verifyToken }, headers: danaBrowser.requestHeaders() });
    expect((await prisma().user.findUniqueOrThrow({ where: { id: dana.userId } })).email).toBe(NEW_ADDRESS());
  });
});

describe('setStudioLanguage', () => {
  it('changes the language of the Studio and of the emails, and audits it', async () => {
    expect(await invoke(accountActions.setStudioLanguage, { locale: 'ckb' })).toEqual({ ok: true, data: { locale: 'ckb' } });

    expect((await prisma().user.findUniqueOrThrow({ where: { id: dana.userId } })).locale).toBe('ckb');
    const rows = (await auditRows()).filter((r) => r.action === 'account.language_changed');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: dana.userId, entityId: dana.userId, changes: { locale: { before: 'en', after: 'ckb' } } });
  });

  it('refuses a language the Studio does not have, and keys everything by the signed-in person', async () => {
    const other = await createPasswordUser(prisma(), { email: address('other'), name: 'Other', password: GOOD });
    expect(failureOf(await invoke(accountActions.setStudioLanguage, { locale: 'fr' }))).toMatchObject({
      code: 'INVALID',
      fields: { locale: expect.any(String) },
    });
    // A user id in the input is not read.
    await invoke(accountActions.setStudioLanguage, { locale: 'ar', userId: other.userId });
    expect((await prisma().user.findUniqueOrThrow({ where: { id: other.userId } })).locale).toBe('en');
    expect((await prisma().user.findUniqueOrThrow({ where: { id: dana.userId } })).locale).toBe('ar');
  });
});

describe('sessions', () => {
  it("lists the person's own live sessions, marks this one, and shows no token", async () => {
    await signedIn(address('dana'), GOOD, '203.0.113.5', 'Phone browser');
    const other = await createPasswordUser(prisma(), { email: address('other'), name: 'Other', password: GOOD });
    await signedIn(address('other'));
    await prisma().session.create({
      data: { id: 'expired', token: 'expired-token', userId: dana.userId, expiresAt: new Date(Date.now() - 1000), ipAddress: '1.1.1.1' },
    });
    danaBrowser.activate();

    const list = dataOf(await invokeQuery(accountQueries.listMySessions, undefined));

    expect(list).toHaveLength(2);
    expect(list.filter((s) => s.current)).toHaveLength(1);
    expect(list.find((s) => s.current)).toMatchObject({ ipAddress: '198.51.100.7', userAgent: 'Mozilla/5.0 (vitest browser)' });
    expect(list.find((s) => !s.current)).toMatchObject({ ipAddress: '203.0.113.5', userAgent: 'Phone browser' });
    const mine = await prisma().session.findMany({ where: { userId: dana.userId, expiresAt: { gt: new Date() } } });
    expect(list.map((s) => s.id).sort()).toEqual(mine.map((s) => s.id).sort());
    expect(list.map((s) => s.id)).not.toContain('expired');
    expect(list.map((s) => s.id)).not.toContain((await prisma().session.findFirstOrThrow({ where: { userId: other.userId } })).id);
    // Neither the token nor the cookie value leaves the server.
    const text = JSON.stringify(list);
    for (const row of mine) expect(text).not.toContain(row.token);
    expect(text).not.toContain(danaBrowser.jar.get(SESSION_COOKIE) as string);
    expect(list.every((s) => typeof s.createdAt === 'string' && typeof s.expiresAt === 'string')).toBe(true);
  });

  describe('endSession', () => {
    it("ends one of the person's other sessions", async () => {
      const phone = await signedIn(address('dana'), GOOD, '203.0.113.5', 'Phone browser');
      danaBrowser.activate();
      const target = dataOf(await invokeQuery(accountQueries.listMySessions, undefined)).find((s) => !s.current);

      expect(await invoke(accountActions.endSession, { sessionId: target?.id })).toEqual({ ok: true, data: { ended: true } });

      expect(await userIdOf(phone)).toBeNull();
      expect(await userIdOf(danaBrowser)).toBe(dana.userId);
      const rows = (await auditRows()).filter((r) => r.action === 'account.session_ended');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ actorId: dana.userId, entityType: 'Session', entityId: target?.id });
      expect(JSON.stringify(rows)).not.toMatch(/token/i);
    });

    it("does not end another person's session, and answers as for one that does not exist", async () => {
      await createPasswordUser(prisma(), { email: address('other'), name: 'Other', password: GOOD });
      const otherBrowser = await signedIn(address('other'));
      const theirs = await prisma().session.findFirstOrThrow({ where: { user: { email: address('other') } } });
      danaBrowser.activate();

      const result = await invoke(accountActions.endSession, { sessionId: theirs.id });
      const unknown = await invoke(accountActions.endSession, { sessionId: 'no-such-session' });

      expect(failureOf(result)).toMatchObject({ code: 'NOT_FOUND' });
      expect(unknown).toEqual(result);
      expect(await prisma().session.count({ where: { id: theirs.id } })).toBe(1);
      expect(await emailOf(otherBrowser)).toBe(address('other'));
      expect((await auditRows()).filter((r) => r.action === 'account.session_ended')).toHaveLength(0);
    });

    it('refuses input that is not a session id', async () => {
      for (const input of [{}, { sessionId: '' }, { sessionId: 7 }, { sessionId: 'x'.repeat(300) }, null]) {
        expect(codeOf(await invoke(accountActions.endSession, input))).toBe('INVALID');
      }
    });

    it('can end the session it is called from, which signs that browser out', async () => {
      const mine = dataOf(await invokeQuery(accountQueries.listMySessions, undefined)).find((s) => s.current);
      expect(codeOf(await invoke(accountActions.endSession, { sessionId: mine?.id }))).toBe('OK');
      expect(codeOf(await invoke(accountActions.setStudioLanguage, { locale: 'ar' }))).toBe('UNAUTHENTICATED');
    });
  });

  describe('endOtherSessions', () => {
    it('ends the others, keeps this one, and leaves other people alone', async () => {
      const phone = await signedIn(address('dana'), GOOD, '203.0.113.5', 'Phone browser');
      const laptop = await signedIn(address('dana'), GOOD, '203.0.113.6', 'Laptop browser');
      await createPasswordUser(prisma(), { email: address('other'), name: 'Other', password: GOOD });
      const otherBrowser = await signedIn(address('other'));
      danaBrowser.activate();

      expect(await invoke(accountActions.endOtherSessions, undefined)).toEqual({ ok: true, data: { ended: 2 } });

      expect(await userIdOf(phone)).toBeNull();
      expect(await userIdOf(laptop)).toBeNull();
      expect(await userIdOf(danaBrowser)).toBe(dana.userId);
      expect(await emailOf(otherBrowser)).toBe(address('other'));
      const rows = (await auditRows()).filter((r) => r.action === 'account.other_sessions_ended');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ actorId: dana.userId, entityId: dana.userId, changes: { ended: { before: null, after: 2 } } });
    });

    it('accepts whatever a form sends along, and does nothing when there is nothing to end', async () => {
      expect(await invoke(accountActions.endOtherSessions, new FormData())).toEqual({ ok: true, data: { ended: 0 } });
    });
  });
});
