import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPrisma } from '@/server/data/prisma';
import * as people from '@/server/studio/actions/people';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { createPasswordUser } from '@/server/studio/auth/users';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import type { ActionResult } from '@/server/studio/framework/result';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData } from '../helpers/db';

const prisma = createPrisma(databaseUrl(TEST_DB));
const GOOD = 'correct horse battery staple';
const META = { ip: '203.0.113.7', userAgent: 'vitest' };

const failureOf = (result: ActionResult<unknown>) => {
  if (result.ok) throw new Error(`expected a failure, got ${JSON.stringify(result.data)}`);
  return result.error;
};

/** A Super Admin with two-factor on, as the Studio requires before they act. */
async function superAdmin(email: string, isPlatformOwner = false): Promise<Actor> {
  const { userId } = await createPasswordUser(prisma, { email, name: email.split('@')[0]!, password: GOOD, isSuperAdmin: true, isPlatformOwner });
  await prisma.user.update({ where: { id: userId }, data: { twoFactorEnabled: true } });
  return (await loadActor(prisma, userId))!;
}

const runAs = <I, O>(actor: Actor, def: ActionDef<I, O>, input: unknown) => runAction(prisma, actor, def, input, META);

describe('the platform owner', () => {
  beforeAll(() => requireTestDb());
  beforeEach(() => resetTestData(prisma));
  afterAll(async () => {
    await resetTestData(prisma);
    await prisma.$disconnect();
  });

  it('is marked on the actor, and only for a Super Admin', async () => {
    const owner = await superAdmin('owner@example.test', true);
    expect(owner.isPlatformOwner).toBe(true);
    expect((await superAdmin('other@example.test')).isPlatformOwner).toBe(false);
    const { userId } = await createPasswordUser(prisma, { email: 'staff@example.test', name: 'Staff', password: GOOD });
    await prisma.user.update({ where: { id: userId }, data: { isPlatformOwner: false } });
    await prisma.user.update({ where: { id: owner.userId }, data: { isSuperAdmin: false } });
    expect((await loadActor(prisma, owner.userId))!.isPlatformOwner).toBe(false);
  });

  it('is one account at most', async () => {
    await superAdmin('owner@example.test', true);
    await expect(superAdmin('second@example.test', true)).rejects.toThrow();
  });

  it('is, after the migration, the first Super Admin created who is still active', async () => {
    const gone = await superAdmin('gone@example.test');
    const first = await superAdmin('first@example.test');
    const later = await superAdmin('later@example.test');
    await prisma.user.update({ where: { id: gone.userId }, data: { createdAt: new Date('2026-01-01'), deactivatedAt: new Date('2026-02-01') } });
    await prisma.user.update({ where: { id: first.userId }, data: { createdAt: new Date('2026-03-01') } });
    await prisma.user.update({ where: { id: later.userId }, data: { createdAt: new Date('2026-04-01') } });
    const folder = readdirSync('prisma/migrations').find((name) => name.endsWith('_plans_and_platform_owner'))!;
    const sql = readFileSync(join('prisma/migrations', folder, 'migration.sql'), 'utf8');
    const update = sql.slice(sql.indexOf('UPDATE "user"'), sql.indexOf(');', sql.indexOf('UPDATE "user"')) + 2);
    // eslint-disable-next-line no-restricted-properties -- runs the migration's own statement, which is the thing tested
    await prisma.$executeRawUnsafe(update);
    const owners = await prisma.user.findMany({ where: { isPlatformOwner: true }, select: { email: true } });
    expect(owners).toEqual([{ email: 'first@example.test' }]);
  });

  it('cannot be deactivated or re-addressed by another Super Admin', async () => {
    const owner = await superAdmin('owner@example.test', true);
    const other = await superAdmin('other@example.test');
    for (const [def, input] of [
      [people.deactivateUser, { userId: owner.userId }],
      [people.changeUserEmail, { userId: owner.userId, email: 'taken-over@example.test' }],
    ] as const) {
      expect(failureOf(await runAs(other, def as ActionDef<unknown, unknown>, input))).toMatchObject({
        code: 'FORBIDDEN',
        message: 'Only the platform owner can change this account',
      });
    }
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: owner.userId } });
    expect(stored).toMatchObject({ email: 'owner@example.test', deactivatedAt: null });
  });

  it('still lets Super Admins manage everyone else', async () => {
    await superAdmin('owner@example.test', true);
    const other = await superAdmin('other@example.test');
    const third = await superAdmin('third@example.test');
    expect((await runAs(other, people.changeUserEmail, { userId: third.userId, email: 'third-new@example.test' })).ok).toBe(true);
  });
});
