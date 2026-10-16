import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pendingTwoFactor } from '@/server/studio/auth/two-factor';
import { requireTestDb, resetTestData, testPrisma } from '../helpers/db';

const prisma = testPrisma();
const NAME = 'studio.two_factor';
const future = () => new Date(Date.now() + 600_000);
let next = 0;

/** A row of the verification table, which has no default id. */
const row = (identifier: string, value: string, expiresAt: Date) => ({ id: `row-${(next += 1)}`, identifier, value, expiresAt });

/** The headers of a request that carries these cookies as a browser would send them. */
const withCookie = (cookie: string) => new Headers({ cookie, 'x-forwarded-for': '198.51.100.7', 'user-agent': 'vitest' });

describe('pendingTwoFactor', () => {
  beforeAll(() => requireTestDb());
  beforeEach(async () => {
    await resetTestData(prisma);
    await prisma.user.create({ data: { id: 'user-1', name: 'Una', email: 'una@example.com' } });
  });
  afterAll(async () => {
    await resetTestData(prisma);
    await prisma.$disconnect();
  });

  // Better Auth makes a challenge's id from letters, digits, `-` and `_`: all of them have to be found.
  it.each(['2fa-abcDEF123', '2fa-ab-cd_ef', '2fa-_-_-_', '2fa--leading'])('finds the challenge %s', async (identifier) => {
    await prisma.verification.create({ data: row(identifier, 'user-1', future()) });

    const found = await pendingTwoFactor(prisma, withCookie(`${NAME}=${encodeURIComponent(`${identifier}.c2lnbmF0dXJl+/=`)}`));

    expect(found?.userId).toBe('user-1');
  });

  it('reads a quoted cookie value as a browser may send it', async () => {
    await prisma.verification.create({ data: row('2fa-quoted', 'user-1', future()) });
    expect((await pendingTwoFactor(prisma, withCookie(`${NAME}="2fa-quoted.sig"`)))?.userId).toBe('user-1');
  });

  it('hands back headers with the challenge cookie alone, and the rest of the request as it was', async () => {
    await prisma.verification.create({ data: row('2fa-alone', 'user-1', future()) });
    const request = withCookie(`studio.session_token=abc.def; other=1; ${NAME}="2fa-alone.sig%3D"; studio.session_data=xyz`);

    const found = await pendingTwoFactor(prisma, request);

    expect(found?.headers.get('cookie')).toBe(`${NAME}=${encodeURIComponent('2fa-alone.sig=')}`);
    expect(found?.headers.get('x-forwarded-for')).toBe('198.51.100.7');
    expect(found?.headers.get('user-agent')).toBe('vitest');
    // The request itself is not changed.
    expect(request.get('cookie')).toContain('studio.session_token');
  });

  it('finds nothing without a challenge cookie, however signed in the request is', async () => {
    await prisma.verification.create({ data: row('2fa-there', 'user-1', future()) });
    expect(await pendingTwoFactor(prisma, new Headers())).toBeNull();
    expect(await pendingTwoFactor(prisma, withCookie('studio.session_token=abc.def'))).toBeNull();
    expect(await pendingTwoFactor(prisma, withCookie(`${NAME}=`))).toBeNull();
  });

  it('finds nothing for a challenge that has run out or does not exist', async () => {
    await prisma.verification.create({ data: row('2fa-old', 'user-1', new Date(Date.now() - 1000)) });
    expect(await pendingTwoFactor(prisma, withCookie(`${NAME}=2fa-old.sig`))).toBeNull();
    expect(await pendingTwoFactor(prisma, withCookie(`${NAME}=2fa-never.sig`))).toBeNull();
  });

  it('finds nothing for other rows of the verification table, which a made-up cookie might cite', async () => {
    await prisma.verification.createMany({
      data: [
        row('reset-password:abc', 'user-1', future()),
        row('2fa-attempts-2fa-abc', '0', future()),
        row('trust-device-abc', 'user-1', future()),
      ],
    });
    for (const cited of ['reset-password:abc', '2fa-attempts-2fa-abc', 'trust-device-abc']) {
      expect(await pendingTwoFactor(prisma, withCookie(`${NAME}=${encodeURIComponent(`${cited}.sig`)}`))).toBeNull();
    }
  });
});
