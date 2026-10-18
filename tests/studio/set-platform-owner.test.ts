import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPasswordUser } from '@/server/studio/auth/users';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData, testPrisma } from '../helpers/db';

const GOOD = 'correct horse battery staple';

describe('npm run studio:set-platform-owner', () => {
  const prisma = testPrisma();
  const TSX = 'node_modules/tsx/dist/cli.mjs';

  /** Runs the script as `tsx` does, against the test database, with these lines on its standard input. */
  function run(lines: string[]) {
    const result = spawnSync(process.execPath, [TSX, 'scripts/set-platform-owner.ts'], {
      cwd: process.cwd(),
      input: `${lines.join('\n')}\n`,
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, DATABASE_URL: databaseUrl(TEST_DB), RESEND_API_KEY: '' },
    });
    return { code: result.status, out: `${result.stdout}${result.stderr}` };
  }

  const owners = async () => (await prisma.user.findMany({ where: { isPlatformOwner: true }, select: { email: true } })).map((u) => u.email);

  beforeAll(() => requireTestDb());
  beforeEach(async () => {
    await resetTestData(prisma);
    await createPasswordUser(prisma, { email: 'owner@example.test', name: 'Owner', password: GOOD, isSuperAdmin: true, isPlatformOwner: true });
    await createPasswordUser(prisma, { email: 'next@example.test', name: 'Next', password: GOOD, isSuperAdmin: true });
    await createPasswordUser(prisma, { email: 'staff@example.test', name: 'Staff', password: GOOD });
  });
  afterAll(async () => {
    await resetTestData(prisma);
    await prisma.$disconnect();
  });

  it('moves the platform owner to another Super Admin once confirmed', async () => {
    const { code, out } = run(['Next@Example.test', 'yes']);
    expect(code).toBe(0);
    expect(out).toContain('owner@example.test');
    expect(await owners()).toEqual(['next@example.test']);
  }, 90_000);

  it('changes nothing without the confirmation', async () => {
    const { code } = run(['next@example.test', 'no']);
    expect(code).toBe(1);
    expect(await owners()).toEqual(['owner@example.test']);
  }, 90_000);

  it('refuses an account that is not an active Super Admin', async () => {
    const { code, out } = run(['staff@example.test']);
    expect(code).toBe(1);
    expect(out).toContain('not an active Super Admin');
    expect(await owners()).toEqual(['owner@example.test']);
  }, 90_000);
});
