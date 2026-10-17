import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { resetTestData, testPrisma } from '../helpers/db';

process.env.DATABASE_URL = databaseUrl(TEST_DB);
const prisma = testPrisma();
const SECRET = 'a-cron-secret-of-more-than-thirty-two-characters';

const call = async (authorization?: string) => {
  const { GET } = await import('@/app/api/cron/publish/route');
  return GET(new Request('http://localhost/api/cron/publish', { headers: authorization ? { authorization } : {} }));
};

beforeAll(async () => {
  await resetTestData(prisma);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await prisma.$disconnect();
});

describe('the publishing cron', () => {
  it('answers 503 when no secret is configured', async () => {
    vi.stubEnv('CRON_SECRET', '');
    expect((await call(`Bearer ${SECRET}`)).status).toBe(503);
  });

  it('answers 401 without the secret or with a wrong one', async () => {
    vi.stubEnv('CRON_SECRET', SECRET);
    expect((await call()).status).toBe(401);
    expect((await call('Bearer a-wrong-secret-of-more-than-thirty-two-characters')).status).toBe(401);
    expect((await call(SECRET)).status).toBe(401);
  });

  it('activates due revisions with the right secret, and is never cached', async () => {
    vi.stubEnv('CRON_SECRET', SECRET);
    const response = await call(`Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ activated: 0, cancelled: 0 });
  });

  it('gives itself a minute', async () => {
    expect((await import('@/app/api/cron/publish/route')).maxDuration).toBe(60);
  });
});
