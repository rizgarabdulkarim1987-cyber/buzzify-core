import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuth } from '@/server/studio/auth/auth';
import { createPasswordUser } from '@/server/studio/auth/users';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { cookieHeader, totpFromUri } from '../helpers/auth';
import { resetTestData, testPrisma } from '../helpers/db';

/**
 * What changing `BETTER_AUTH_SECRET` does to people who have two-factor on, and the recovery that
 * `docs/deploy/production.md` gives. Better Auth locks each person's two-factor secret and recovery codes with the secret,
 * and the Studio has no way to reset another person's two-factor, so these facts decide what the guide may promise:
 * a new secret cannot read what the old one locked, and clearing the stored two-factor lets the person enrol again.
 */

const prisma = testPrisma();
const BASE = 'http://127.0.0.1:3100';
const OLD_SECRET = 'old-secret-0123456789-abcdefghijklmnopqrstuvwxyz';
const NEW_SECRET = 'new-secret-9876543210-zyxwvutsrqponmlkjihgfedcba';
const PASSWORD = 'correct horse battery staple';

/** Two Better Auth instances on one database, as the app is before and after the variable changes. */
const before = createAuth(prisma, { secret: OLD_SECRET, baseUrl: BASE, production: false });
const after = createAuth(prisma, { secret: NEW_SECRET, baseUrl: BASE, production: false });

/** The statements the guide tells the person to run in Neon's SQL editor. */
/** What the cipher says when the key is not the one that locked the data: not a wrong code, an unreadable record. */
const CANNOT_OPEN = 'invalid tag';

const RECOVERY_SQL = ['DELETE FROM "twoFactor";', 'UPDATE "user" SET "twoFactorEnabled" = false;'];

type Auth = typeof before;

async function signIn(auth: Auth, email: string) {
  const result = await auth.api.signInEmail({ body: { email, password: PASSWORD }, returnHeaders: true });
  return { response: result.response as { twoFactorRedirect?: boolean }, headers: cookieHeader(result.headers.getSetCookie()) };
}

/** Turns two-factor on for a signed-in person, the way the Studio's setup does, and returns what the app showed. */
async function enrol(auth: Auth, email: string) {
  const { headers } = await signIn(auth, email);
  const enabled = await auth.api.enableTwoFactor({ body: { password: PASSWORD }, headers });
  if (enabled.method !== 'totp') throw new Error('unexpected two-factor method');
  await auth.api.verifyTOTP({ body: { code: totpFromUri(enabled.totpURI) }, headers });
  return { uri: enabled.totpURI, backupCodes: enabled.backupCodes };
}

async function runSql(statements: string[]) {
  const client = new pg.Client({ connectionString: databaseUrl(TEST_DB) });
  await client.connect();
  try {
    for (const statement of statements) await client.query(statement);
  } finally {
    await client.end();
  }
}

describe('changing BETTER_AUTH_SECRET', () => {
  beforeAll(() => vi.stubEnv('BETTER_AUTH_SECRETS', ''));
  beforeEach(async () => {
    await resetTestData(prisma);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await resetTestData(prisma);
    await prisma.$disconnect();
    vi.unstubAllEnvs();
  });

  it('control: with the secret unchanged, the code and a recovery code both complete a sign-in', async () => {
    await createPasswordUser(prisma, { email: 'boss@example.com', name: 'Boss', password: PASSWORD, isSuperAdmin: true }, before);
    const { uri, backupCodes } = await enrol(before, 'boss@example.com');

    const byCode = await signIn(before, 'boss@example.com');
    expect(byCode.response.twoFactorRedirect).toBe(true);
    await expect(before.api.verifyTOTP({ body: { code: totpFromUri(uri) }, headers: byCode.headers })).resolves.toBeDefined();

    const byRecovery = await signIn(before, 'boss@example.com');
    await expect(before.api.verifyBackupCode({ body: { code: backupCodes[0]! }, headers: byRecovery.headers })).resolves.toBeDefined();
  });

  it('signs everyone out: a session cookie made under the old secret is not accepted under the new one', async () => {
    await createPasswordUser(prisma, { email: 'owner@example.com', name: 'Owner', password: PASSWORD }, before);
    const { headers } = await signIn(before, 'owner@example.com');
    expect(await before.api.getSession({ headers })).not.toBeNull();
    expect(await after.api.getSession({ headers })).toBeNull();
  });

  it('locks out everyone who had two-factor: the password step passes, the code and every recovery code fail', async () => {
    await createPasswordUser(prisma, { email: 'boss@example.com', name: 'Boss', password: PASSWORD, isSuperAdmin: true }, before);
    const { uri, backupCodes } = await enrol(before, 'boss@example.com');

    const attempt = await signIn(after, 'boss@example.com');
    expect(attempt.response.twoFactorRedirect).toBe(true);
    await expect(after.api.verifyTOTP({ body: { code: totpFromUri(uri) }, headers: attempt.headers })).rejects.toThrow(CANNOT_OPEN);

    const recovery = await signIn(after, 'boss@example.com');
    for (const code of backupCodes.slice(0, 3)) {
      await expect(after.api.verifyBackupCode({ body: { code }, headers: recovery.headers })).rejects.toThrow(CANNOT_OPEN);
    }
  });

  it('leaves a person who never turned two-factor on signing in with their password alone', async () => {
    await createPasswordUser(prisma, { email: 'owner@example.com', name: 'Owner', password: PASSWORD }, before);
    const result = await signIn(after, 'owner@example.com');
    expect(result.response.twoFactorRedirect).toBeFalsy();
  });

  it('is not undone by only switching the flag off: the stored two-factor must be removed as well', async () => {
    await createPasswordUser(prisma, { email: 'boss@example.com', name: 'Boss', password: PASSWORD, isSuperAdmin: true }, before);
    await enrol(before, 'boss@example.com');

    await runSql(['UPDATE "user" SET "twoFactorEnabled" = false;']);

    const { headers } = await signIn(after, 'boss@example.com');
    await expect(after.api.enableTwoFactor({ body: { password: PASSWORD }, headers })).rejects.toMatchObject({
      body: { code: 'TOTP_ALREADY_ENABLED' },
    });
  });

  it('is recovered by the guide’s two statements: everyone signs in again and enrols under the new secret', async () => {
    await createPasswordUser(prisma, { email: 'boss@example.com', name: 'Boss', password: PASSWORD, isSuperAdmin: true }, before);
    await createPasswordUser(prisma, { email: 'designer@example.com', name: 'Designer', password: PASSWORD }, before);
    await enrol(before, 'boss@example.com');
    await enrol(before, 'designer@example.com');
    expect(await prisma.twoFactor.count()).toBe(2);

    await runSql(RECOVERY_SQL);

    expect(await prisma.twoFactor.count()).toBe(0);
    expect(await prisma.user.count({ where: { twoFactorEnabled: true } })).toBe(0);
    // Passwords, accounts and everything else are as they were.
    expect(await prisma.user.count()).toBe(2);
    expect(await prisma.account.count()).toBe(2);

    for (const email of ['boss@example.com', 'designer@example.com']) {
      const fresh = await signIn(after, email);
      expect(fresh.response.twoFactorRedirect).toBeFalsy();
      const { uri } = await enrolSession(after, fresh.headers);

      // From now on the new secret is the one that works.
      const again = await signIn(after, email);
      expect(again.response.twoFactorRedirect).toBe(true);
      await expect(after.api.verifyTOTP({ body: { code: totpFromUri(uri) }, headers: again.headers })).resolves.toBeDefined();
    }
  });

  it('gives a second Super Admin, created after the change, working two-factor of their own', async () => {
    await createPasswordUser(prisma, { email: 'boss@example.com', name: 'Boss', password: PASSWORD, isSuperAdmin: true }, before);
    await enrol(before, 'boss@example.com');

    // What `npm run studio:create-admin -- --force` does against the live database, then the live app (the new secret) takes over.
    await createPasswordUser(prisma, { email: 'second@example.com', name: 'Second', password: PASSWORD, isSuperAdmin: true }, after);

    const signedIn = await signIn(after, 'second@example.com');
    expect(signedIn.response.twoFactorRedirect).toBeFalsy();
    const { uri } = await enrolSession(after, signedIn.headers);
    const again = await signIn(after, 'second@example.com');
    await expect(after.api.verifyTOTP({ body: { code: totpFromUri(uri) }, headers: again.headers })).resolves.toBeDefined();

    // The first Super Admin is still stuck: nothing here reset them.
    const stuck = await signIn(after, 'boss@example.com');
    expect(stuck.response.twoFactorRedirect).toBe(true);
  });
});

/** Turns two-factor on for a person who is already signed in (their session headers). */
async function enrolSession(auth: Auth, headers: Headers) {
  const enabled = await auth.api.enableTwoFactor({ body: { password: PASSWORD }, headers });
  if (enabled.method !== 'totp') throw new Error('unexpected two-factor method');
  await auth.api.verifyTOTP({ body: { code: totpFromUri(enabled.totpURI) }, headers });
  return { uri: enabled.totpURI };
}

describe('the deployment guide', () => {
  const guide = readFileSync('docs/deploy/production.md', 'utf8');

  it('tells the person to run exactly the statements verified above', () => {
    for (const statement of RECOVERY_SQL) expect(guide).toContain(statement);
  });

  it('passes --force to the script after a double dash, because npm keeps a bare --force for itself', () => {
    expect(guide).toContain('npm run studio:create-admin -- --force');
    expect(guide).not.toMatch(/studio:create-admin --force/);
  });
});
