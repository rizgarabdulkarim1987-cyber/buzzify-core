import { afterEach, describe, expect, it, vi } from 'vitest';

/** Which database Prisma's commands (migrate, seed) connect to. */

const POOLED = 'postgresql://app:pw@ep-quiet-sun-123456-pooler.eu-central-1.aws.neon.tech/buzzify';
const DIRECT = 'postgresql://app:pw@ep-quiet-sun-123456.eu-central-1.aws.neon.tech/buzzify';
const EMBEDDED = 'postgresql://postgres:postgres@127.0.0.1:54329/buzzify';

/** The datasource URL the config resolves to with these variables set (`undefined` is not set, `''` is blank). */
async function urlWith(env: { DIRECT_DATABASE_URL?: string; DATABASE_URL?: string }): Promise<string | undefined> {
  vi.resetModules();
  // `dotenv/config` keeps a variable that exists, so every one is set here and a local .env file cannot change the answer.
  vi.stubEnv('DIRECT_DATABASE_URL', env.DIRECT_DATABASE_URL ?? '');
  vi.stubEnv('DATABASE_URL', env.DATABASE_URL ?? '');
  const { default: config } = await import('../../prisma.config');
  return config.datasource?.url;
}

describe('prisma.config.ts', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('migrates through the direct URL when there is one, ahead of the pooled one', async () => {
    expect(await urlWith({ DIRECT_DATABASE_URL: DIRECT, DATABASE_URL: POOLED })).toBe(DIRECT);
  });

  it('uses DATABASE_URL when there is no direct URL', async () => {
    expect(await urlWith({ DATABASE_URL: POOLED })).toBe(POOLED);
  });

  it('treats a blank direct URL as not set', async () => {
    expect(await urlWith({ DIRECT_DATABASE_URL: '   ', DATABASE_URL: POOLED })).toBe(POOLED);
  });

  it('falls back to the embedded development database when neither is set', async () => {
    expect(await urlWith({})).toBe(EMBEDDED);
  });
});
