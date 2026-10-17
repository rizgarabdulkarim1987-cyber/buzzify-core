import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { databaseUrl, DB_PORT, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData, testPrisma } from '../helpers/db';

/**
 * `npm run db:seed` and `npm run db:seed:load` as `tsx` runs them, against the test database. What matters here is what
 * they refuse to do and that they refuse before they write anything, which only the whole script can show.
 */

const TSX = 'node_modules/tsx/dist/cli.mjs';
const PASSWORD = 'dev-only-change-me-2026';
/** A name that can never resolve (RFC 6761), so a guard that fails would end in an error, not in a connection. */
const HOSTED = 'postgresql://neondb_owner:s3cret-pass@db.example.invalid/neondb';
/** Loopback in the URL, but `pg` takes the host from the query parameter: the bypass the guard must not fall for. */
const HOSTED_BY_PARAMETER = 'postgresql://neondb_owner:s3cret-pass@127.0.0.1:54329/neondb?host=db.example.invalid';

let prisma: PrismaClient;

/** Runs a script with this environment on top of the test database's. `DEV_SEED_PASSWORD: ''` is "not set" (dotenv keeps a variable that exists). */
function run(script: string, env: Record<string, string>, args: string[] = []) {
  const result = spawnSync(process.execPath, [TSX, script, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 90_000,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      DATABASE_URL: databaseUrl(TEST_DB),
      DEV_SEED_PASSWORD: '',
      ALLOW_REMOTE_DEV_SEED: '',
      RESEND_API_KEY: '',
      ...env,
    },
  });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

const atelier = () => prisma.menu.findUnique({ where: { slug: 'atelier' }, select: { id: true, liveRevisionId: true, version: true } });

beforeAll(() => {
  requireTestDb();
  prisma = testPrisma();
});

beforeEach(async () => {
  await resetTestData(prisma);
});

afterAll(async () => {
  await resetTestData(prisma);
  await prisma.$disconnect();
});

describe('npm run db:seed', () => {
  it('seeds the three demo menus and the development users on this machine', async () => {
    const { code, out } = run('prisma/seed.ts', { DEV_SEED_PASSWORD: PASSWORD });

    expect(code, out).toBe(0);
    expect(out).toContain('Development users: created');
    expect(out).not.toContain(PASSWORD);
    expect((await atelier())?.liveRevisionId).toEqual(expect.any(String));
    // Each under its own restaurant, published.
    const demos = await prisma.menu.findMany({ where: { slug: { in: ['riverlight', 'hot-brick'] } }, select: { slug: true, liveRevisionId: true, restaurant: { select: { name: true } } }, orderBy: { slug: 'asc' } });
    expect(demos).toEqual([
      { slug: 'hot-brick', liveRevisionId: expect.any(String), restaurant: { name: 'Hot Brick Burgers' } },
      { slug: 'riverlight', liveRevisionId: expect.any(String), restaurant: { name: 'Riverlight Coffee' } },
    ]);
    expect(await prisma.user.count()).toBe(3);
  });

  it('refuses in production while DEV_SEED_PASSWORD is set, before it writes anything', async () => {
    expect(run('prisma/seed.ts', {}).code).toBe(0);
    const before = await atelier();
    expect(before).not.toBeNull();

    const { code, out } = run('prisma/seed.ts', { NODE_ENV: 'production', DEV_SEED_PASSWORD: PASSWORD });

    expect(code).toBe(1);
    expect(out).toContain('DEV_SEED_PASSWORD');
    expect(out).toMatch(/production/);
    expect(out).not.toContain(PASSWORD);
    // A reseed replaces the menu (a new id, a new revision); this one left it as it was.
    expect(await atelier()).toEqual(before);
    expect(await prisma.user.count()).toBe(0);
  });

  it('seeds ATELIER in production without the development users when DEV_SEED_PASSWORD is not set', async () => {
    const { code, out } = run('prisma/seed.ts', { NODE_ENV: 'production' });

    expect(code, out).toBe(0);
    expect(out).toContain('Development users skipped (production)');
    expect((await atelier())?.liveRevisionId).toEqual(expect.any(String));
    expect(await prisma.user.count()).toBe(0);
  });

  it('refuses to bring back the atelier address once its menu was deleted, before it writes anything', async () => {
    expect(run('prisma/seed.ts', {}).code).toBe(0);
    // Deleted in the Studio: the address stays reserved as a tombstone, and the restaurant may stay too.
    const menu = await atelier();
    await prisma.menuSlug.updateMany({ where: { menuId: menu!.id }, data: { menuId: null } });
    await prisma.menu.delete({ where: { id: menu!.id } });
    const restaurants = await prisma.restaurant.count();

    const { code, out } = run('prisma/seed.ts', {});

    expect(code).toBe(1);
    expect(out).toContain('atelier');
    expect(out).toMatch(/reserved/);
    expect(await atelier()).toBeNull();
    expect(await prisma.menuSlug.findUniqueOrThrow({ where: { slug: 'atelier' } })).toMatchObject({ menuId: null });
    expect(await prisma.restaurant.count()).toBe(restaurants);
  });

  it('refuses to take the atelier address from a menu that now goes by another one', async () => {
    expect(run('prisma/seed.ts', {}).code).toBe(0);
    // The demo menu moved to a new address in the Studio; /atelier redirects to it for good.
    const menu = await atelier();
    await prisma.menu.update({ where: { id: menu!.id }, data: { slug: 'atelier-cafe' } });
    await prisma.menuSlug.create({ data: { slug: 'atelier-cafe', menuId: menu!.id } });
    const before = await prisma.menu.findMany({ select: { id: true }, orderBy: { id: 'asc' } });

    const { code, out } = run('prisma/seed.ts', {});

    expect(code).toBe(1);
    expect(out).toContain('atelier-cafe');
    expect(await prisma.menuSlug.findUniqueOrThrow({ where: { slug: 'atelier' } })).toMatchObject({ menuId: menu!.id });
    // Refused before anything was written: the other demo menus were not replaced either.
    expect(await prisma.menu.findMany({ select: { id: true }, orderBy: { id: 'asc' } })).toEqual(before);
  });

  it('replaces the demo menu when it is run again while the menu exists', async () => {
    expect(run('prisma/seed.ts', {}).code).toBe(0);
    const first = await atelier();
    const { code, out } = run('prisma/seed.ts', {});
    expect(code, out).toBe(0);
    const second = await atelier();
    expect(second?.id).not.toBe(first?.id);
    expect(await prisma.menuSlug.findUniqueOrThrow({ where: { slug: 'atelier' } })).toMatchObject({ menuId: second?.id });
  });

  it('refuses a database on another host while DEV_SEED_PASSWORD is set, before it writes or connects, naming the host only', async () => {
    const { code, out } = run('prisma/seed.ts', { DATABASE_URL: HOSTED, DEV_SEED_PASSWORD: PASSWORD });

    expect(code).toBe(1);
    expect(out).toContain('db.example.invalid');
    expect(out).toContain('ALLOW_REMOTE_DEV_SEED=1');
    expect(out).toContain('unset DEV_SEED_PASSWORD');
    expect(out).not.toContain('s3cret-pass');
    expect(out).not.toContain(PASSWORD);
    expect(await atelier()).toBeNull();
    expect(await prisma.user.count()).toBe(0);
  });
});

describe('a loopback address with a host parameter', () => {
  it('does not get db:seed past the guard: pg would connect to the host in the parameter', async () => {
    const { code, out } = run('prisma/seed.ts', { DATABASE_URL: HOSTED_BY_PARAMETER, DEV_SEED_PASSWORD: PASSWORD });

    expect(code).toBe(1);
    expect(out).toContain('db.example.invalid');
    expect(out).toContain('ALLOW_REMOTE_DEV_SEED=1');
    expect(out).not.toContain('s3cret-pass');
    expect(out).not.toContain(PASSWORD);
    expect(await atelier()).toBeNull();
    expect(await prisma.user.count()).toBe(0);
  });

  it('does not get db:seed:load past it either', async () => {
    const { code, out } = run('prisma/seed-load.ts', { DATABASE_URL: HOSTED_BY_PARAMETER }, ['5']);

    expect(code).toBe(1);
    expect(out).toContain('db.example.invalid');
    expect(out).toContain('ALLOW_REMOTE_DEV_SEED=1');
    expect(out).not.toContain('Database:');
    expect(out).not.toContain('s3cret-pass');
    expect(await prisma.restaurant.count()).toBe(0);
  });
});

describe('npm run db:seed:load', () => {
  it('refuses a database on another host before it connects, naming the host only', async () => {
    const { code, out } = run('prisma/seed-load.ts', { DATABASE_URL: HOSTED }, ['5']);

    expect(code).toBe(1);
    expect(out).toContain('db.example.invalid');
    expect(out).toContain('ALLOW_REMOTE_DEV_SEED=1');
    expect(out).not.toContain('s3cret-pass');
    expect(await prisma.restaurant.count()).toBe(0);
  });

  it('seeds on this machine', async () => {
    const { code, out } = run('prisma/seed-load.ts', {}, ['5']);

    expect(code, out).toBe(0);
    expect(out).toContain(`Database: 127.0.0.1:${DB_PORT}/${TEST_DB}`);
    expect(out).toContain('Seeded 5 restaurants');
    expect(await prisma.menu.count()).toBe(5);
  });
});
