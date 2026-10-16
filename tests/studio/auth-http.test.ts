import { randomUUID } from 'node:crypto';
import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from '@/app/api/auth/[...all]/route';
import { getPrisma } from '@/server/data/prisma';
import { getAuth } from '@/server/studio/auth/auth';
import { isPublicAuthRequest } from '@/server/studio/auth/http';
import { createPasswordUser } from '@/server/studio/auth/users';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData } from '../helpers/db';

const BASE = 'http://127.0.0.1:3100';
const GOOD = 'correct horse battery staple';
const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const MAIL_DIR = path.join(process.cwd(), '.data', 'mail');
const run = randomUUID().slice(0, 8);

/** A request as a browser or a script would send it to the route, with a same-origin header so only the route decides. */
function call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Response> {
  const request = new Request(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', origin: BASE, 'x-forwarded-for': '198.51.100.9' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return method === 'GET' ? GET(request) : POST(request);
}

describe('the HTTP surface of Better Auth', () => {
  // The route builds the application's auth on the application's client: point it at the test database, never development.
  beforeAll(() => {
    requireTestDb();
    vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
    vi.stubEnv('RESEND_API_KEY', '');
  });

  beforeEach(async () => {
    await resetTestData(getPrisma());
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterAll(async () => {
    await resetTestData(getPrisma());
    await getPrisma().$disconnect();
    delete globalForPrisma.__prisma;
    vi.unstubAllEnvs();
    // The reset test below sends a development mail; remove it from the shared folder.
    const files = await readdir(MAIL_DIR).catch(() => [] as string[]);
    await Promise.all(files.filter((name) => name.includes(run)).map((name) => rm(path.join(MAIL_DIR, name), { force: true })));
  });

  describe('routes the Studio does not serve over HTTP', () => {
    it.each([
      ['POST', '/api/auth/sign-in/email', { email: 'owner@example.com', password: GOOD }],
      ['POST', '/api/auth/request-password-reset', { email: 'owner@example.com' }],
      ['POST', '/api/auth/reset-password', { token: 'whatever', newPassword: 'password1234' }],
      ['POST', '/api/auth/change-password', { currentPassword: GOOD, newPassword: 'password1234' }],
      ['POST', '/api/auth/sign-up/email', { email: 'intruder@example.com', password: GOOD, name: 'X' }],
      ['POST', '/api/auth/change-email', { newEmail: 'moved@example.com' }],
      ['POST', '/api/auth/send-verification-email', { email: 'owner@example.com' }],
      ['POST', '/api/auth/update-user', { name: 'Else' }],
      ['POST', '/api/auth/two-factor/verify-totp', { code: '123456' }],
      ['POST', '/api/auth/two-factor/enable', { password: GOOD }],
      ['POST', '/api/auth/revoke-sessions', {}],
      ['GET', '/api/auth/get-session', undefined],
      ['GET', '/api/auth/list-sessions', undefined],
      ['GET', '/api/auth/reset-password/sometoken', undefined],
    ] as const)('%s %s answers 404', async (method, path, body) => {
      const res = await call(method, path, body);
      expect(res.status).toBe(404);
    });

    it('signs nobody in over HTTP, even with the right password', async () => {
      await createPasswordUser(getPrisma(), { email: 'owner@example.com', name: 'Owner', password: GOOD });
      const res = await call('POST', '/api/auth/sign-in/email', { email: 'owner@example.com', password: GOOD });
      expect(res.status).toBe(404);
      expect(res.headers.getSetCookie()).toEqual([]);
      expect(await getPrisma().session.count()).toBe(0);
    });

    it('changes no password over HTTP, however weak the new one is', async () => {
      const email = `reset-${run}@example.test`;
      const { userId } = await createPasswordUser(getPrisma(), { email, name: 'Owner', password: GOOD });
      await getAuth().api.requestPasswordReset({ body: { email } });
      const token = (await getPrisma().verification.findFirstOrThrow({ where: { identifier: { startsWith: 'reset-password:' } } }))
        .identifier.replace('reset-password:', '');
      const res = await call('POST', '/api/auth/reset-password', { token, newPassword: 'password1234' });
      expect(res.status).toBe(404);
      // The old password still signs in, and the reset token is still unused.
      await expect(getAuth().api.signInEmail({ body: { email, password: GOOD } })).resolves.toMatchObject({
        user: { id: userId },
      });
      expect(await getPrisma().verification.count({ where: { identifier: `reset-password:${token}` } })).toBe(1);
    });

    it('does not let a different spelling of the path reach a route that is not served', async () => {
      for (const path of [
        '/api/auth/sign-in/email/',
        '/api/auth//sign-in/email',
        '/api/auth/ok/../sign-in/email',
        '/api/auth/ok/%2e%2e/sign-in/email',
        '/api/auth/verify-email/../sign-in/email',
        '/api/auth/%73ign-in/email',
        '/api/auth/sign-in%2Femail',
        '/api/auth/Sign-In/Email',
        '/api/auth/ok/',
        '/api/auth/ok/extra',
        '/api/auth/verify-email/extra',
        '/api/auth/sign-out/extra',
      ]) {
        const res = await call('POST', path, { email: 'owner@example.com', password: GOOD });
        expect(res.status, `POST ${path}`).toBe(404);
      }
    });

    it('answers 404 to the wrong method on a served path', async () => {
      expect((await call('POST', '/api/auth/ok', {})).status).toBe(404);
      expect((await call('POST', '/api/auth/verify-email', {})).status).toBe(404);
      expect((await call('GET', '/api/auth/sign-out')).status).toBe(404);
    });
  });

  describe('routes it does serve', () => {
    it('answers /ok', async () => {
      const res = await call('GET', '/api/auth/ok');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    });

    it('hands /verify-email, /sign-out and /error to Better Auth', async () => {
      // The links in change-email mails land on /verify-email; what it answers for a bad token is Better Auth's business.
      const verify = await call('GET', '/api/auth/verify-email?token=not-a-token&callbackURL=%2F');
      expect(verify.status).not.toBe(404);
      const out = await call('POST', '/api/auth/sign-out', {});
      expect(out.status).not.toBe(404);
      const error = await call('GET', '/api/auth/error');
      expect(error.status).not.toBe(404);
    });
  });
});

describe('isPublicAuthRequest', () => {
  const url = (path: string) => `${BASE}${path}`;

  it('allows exactly the four served routes with their methods', () => {
    expect(isPublicAuthRequest('GET', url('/api/auth/verify-email?token=x'))).toBe(true);
    expect(isPublicAuthRequest('POST', url('/api/auth/sign-out'))).toBe(true);
    expect(isPublicAuthRequest('GET', url('/api/auth/ok'))).toBe(true);
    expect(isPublicAuthRequest('GET', url('/api/auth/error?error=x'))).toBe(true);
  });

  it('refuses everything else, including every route Better Auth has and any it adds later', () => {
    for (const path of ['/sign-in/email', '/get-session', '/some-route-added-in-a-later-version', '/verify-email/x', '/ok/', '']) {
      expect(isPublicAuthRequest('GET', url(`/api/auth${path}`))).toBe(false);
      expect(isPublicAuthRequest('POST', url(`/api/auth${path}`))).toBe(false);
    }
    expect(isPublicAuthRequest('POST', url('/api/auth/ok'))).toBe(false);
    expect(isPublicAuthRequest('GET', url('/api/auth/sign-out'))).toBe(false);
    expect(isPublicAuthRequest('DELETE', url('/api/auth/ok'))).toBe(false);
    expect(isPublicAuthRequest('GET', url('/elsewhere/ok'))).toBe(false);
  });
});
