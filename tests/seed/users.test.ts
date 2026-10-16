import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { authFor } from '@/server/studio/auth/auth';
import { seedDevUsers } from '../../prisma/seed/users';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { resetTestData, testPrisma } from '../helpers/db';

const PASSWORD = 'dev-only-change-me-2026';
const OTHER_PASSWORD = 'a different long passphrase 31';
const ADMIN = 'admin@buzzify.test';
const DESIGNER = 'designer@buzzify.test';
const OWNER = 'owner@buzzify.test';
const HOSTED = 'postgresql://neondb_owner:s3cret-pass@ep-xyz.eu-central-1.aws.neon.tech/neondb';

let prisma: PrismaClient;
let restaurantId: string;

beforeAll(() => {
  prisma = testPrisma();
});

beforeEach(async () => {
  await resetTestData(prisma);
  restaurantId = (await prisma.restaurant.create({ data: { name: 'ATELIER' } })).id;
  vi.stubEnv('DEV_SEED_PASSWORD', PASSWORD);
  // Where the seed thinks it is writing: this machine, whatever the developer's shell exports.
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
  vi.stubEnv('ALLOW_REMOTE_DEV_SEED', '');
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await resetTestData(prisma);
  await prisma.$disconnect();
});

const userByEmail = (email: string) => prisma.user.findUniqueOrThrow({ where: { email } });

/** Whether `password` opens the credential stored for `email`: the hash is checked the way sign-in checks it. */
async function opens(email: string, password: string): Promise<boolean> {
  const user = await userByEmail(email);
  const account = await prisma.account.findFirstOrThrow({ where: { userId: user.id, providerId: 'credential' } });
  const ctx = await authFor(prisma).$context;
  return ctx.password.verify({ hash: account.password as string, password });
}

describe('seedDevUsers', () => {
  it('creates a Super Admin without two-factor, a Designer and an Owner of the restaurant', async () => {
    await seedDevUsers(prisma, restaurantId);

    const admin = await userByEmail(ADMIN);
    expect(admin).toMatchObject({ isSuperAdmin: true, emailVerified: true, locale: 'en', deactivatedAt: null });
    expect(admin.twoFactorEnabled ?? false).toBe(false);
    expect(await prisma.membership.count({ where: { userId: admin.id } })).toBe(0);

    const designer = await userByEmail(DESIGNER);
    expect(designer.isSuperAdmin).toBe(false);
    expect(await prisma.membership.findMany({ where: { userId: designer.id } })).toEqual([
      expect.objectContaining({ restaurantId, role: 'DESIGNER' }),
    ]);

    const owner = await userByEmail(OWNER);
    expect(owner.isSuperAdmin).toBe(false);
    expect(await prisma.membership.findMany({ where: { userId: owner.id } })).toEqual([
      expect.objectContaining({ restaurantId, role: 'OWNER' }),
    ]);

    expect(await prisma.user.count()).toBe(3);
  });

  it('gives all three the development password, stored as a hash', async () => {
    await seedDevUsers(prisma, restaurantId);
    for (const email of [ADMIN, DESIGNER, OWNER]) {
      expect(await opens(email, PASSWORD)).toBe(true);
      expect(await opens(email, OTHER_PASSWORD)).toBe(false);
    }
    const accounts = await prisma.account.findMany();
    expect(accounts).toHaveLength(3);
    expect(accounts.every((account) => account.password !== PASSWORD)).toBe(true);
  });

  it('changes nothing when it runs again', async () => {
    await seedDevUsers(prisma, restaurantId);
    const state = async () => ({
      users: await prisma.user.findMany({ orderBy: { email: 'asc' } }),
      accounts: await prisma.account.findMany({ orderBy: { userId: 'asc' } }),
      memberships: await prisma.membership.findMany({ orderBy: { userId: 'asc' } }),
    });
    const before = await state();

    await seedDevUsers(prisma, restaurantId);

    expect(await state()).toEqual(before);
  });

  it('leaves the password of a user who exists, whatever the variable says now', async () => {
    await seedDevUsers(prisma, restaurantId);
    vi.stubEnv('DEV_SEED_PASSWORD', OTHER_PASSWORD);

    await seedDevUsers(prisma, restaurantId);

    expect(await opens(DESIGNER, PASSWORD)).toBe(true);
    expect(await opens(DESIGNER, OTHER_PASSWORD)).toBe(false);
  });

  it('puts back a membership that is missing, and does not touch a user who exists without one', async () => {
    await seedDevUsers(prisma, restaurantId);
    const designer = await userByEmail(DESIGNER);
    await prisma.membership.deleteMany({ where: { userId: designer.id } });
    const adminBefore = await userByEmail(ADMIN);

    await seedDevUsers(prisma, restaurantId);

    expect(await prisma.membership.findMany({ where: { userId: designer.id } })).toEqual([
      expect.objectContaining({ restaurantId, role: 'DESIGNER' }),
    ]);
    expect(await userByEmail(ADMIN)).toEqual(adminBefore);
    expect(await prisma.membership.count()).toBe(2);
  });

  it('does nothing, and says why, while DEV_SEED_PASSWORD is not set', async () => {
    vi.stubEnv('DEV_SEED_PASSWORD', '');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await seedDevUsers(prisma, restaurantId);

    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.membership.count()).toBe(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('DEV_SEED_PASSWORD'));
  });

  it('refuses to run in production, before it reads the password or touches the database', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await expect(seedDevUsers(prisma, restaurantId)).rejects.toThrow(/production/i);
    expect(await prisma.user.count()).toBe(0);

    vi.stubEnv('DEV_SEED_PASSWORD', '');
    await expect(seedDevUsers(prisma, restaurantId)).rejects.toThrow(/production/i);
  });

  it('refuses a database that is not on this machine, before it creates anyone, and names the host but not the credentials', async () => {
    vi.stubEnv('DATABASE_URL', HOSTED);

    const refusal = await seedDevUsers(prisma, restaurantId).then(
      () => '',
      (error: Error) => error.message,
    );

    expect(refusal).toContain('ep-xyz.eu-central-1.aws.neon.tech');
    expect(refusal).toContain('ALLOW_REMOTE_DEV_SEED=1');
    expect(refusal).not.toContain('s3cret-pass');
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.membership.count()).toBe(0);
  });

  it('creates the users on another host when ALLOW_REMOTE_DEV_SEED=1 says so', async () => {
    vi.stubEnv('DATABASE_URL', HOSTED);
    vi.stubEnv('ALLOW_REMOTE_DEV_SEED', '1');

    await seedDevUsers(prisma, restaurantId);

    expect(await prisma.user.count()).toBe(3);
  });

  it('has nothing to refuse while DEV_SEED_PASSWORD is not set, whatever the host', async () => {
    vi.stubEnv('DATABASE_URL', HOSTED);
    vi.stubEnv('DEV_SEED_PASSWORD', '');

    await expect(seedDevUsers(prisma, restaurantId)).resolves.toBeUndefined();
    expect(await prisma.user.count()).toBe(0);
  });

  it('names the variable when the password does not meet the password policy', async () => {
    vi.stubEnv('DEV_SEED_PASSWORD', 'short');
    await expect(seedDevUsers(prisma, restaurantId)).rejects.toThrow(/DEV_SEED_PASSWORD/);
    expect(await prisma.user.count()).toBe(0);
  });
});
