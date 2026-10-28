import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { getPrisma } from '@/server/data/prisma';
import { globalDb } from '@/server/data/tenant-db';
import { effectivePermissions, parsePolicy } from '@/server/domain/permissions';
import * as accountActions from '@/server/studio/actions/account';
import * as people from '@/server/studio/actions/people';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { createPasswordUser } from '@/server/studio/auth/users';
import { defineAction, runAction, type ActionDef } from '@/server/studio/framework/action';
import { invoke, invokePublic } from '@/server/studio/framework/invoke';
import { runQuery, type QueryDef } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import * as session from '@/server/studio/public-actions/session';
import * as peopleQueries from '@/server/studio/queries/people';
import { deactivatePerson } from '@/server/studio/services/people';
import { acceptInvitation, inspectInvitation } from '@/server/studio/services/invitations';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { Browser } from '../helpers/browser';
import { requireTestDb, resetTestData } from '../helpers/db';
import { devMail, linkIn } from '../helpers/mail';

// Server Actions read the request through `headers()` and write cookies through `cookies()`, which only exist inside
// Next. `Browser` stands in for both, with a cookie jar.
vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const GOOD = 'correct horse battery staple';
const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const { address, mailTo, nextTest, quiet, clean } = devMail();
const prisma = () => getPrisma();
const META = { ip: '203.0.113.7', userAgent: 'vitest' };

const codeOf = (result: ActionResult<unknown>) => (result.ok ? 'OK' : result.error.code);
const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  return result.data;
};
const failureOf = (result: ActionResult<unknown>) => {
  if (result.ok) throw new Error(`expected a failure, got ${JSON.stringify(result.data)}`);
  return result.error;
};
const tokenOf = (url: string) => url.slice(url.lastIndexOf('/') + 1);
const LINK = /^http:\/\/127\.0\.0\.1:3100\/studio\/invite\/[A-Za-z0-9_-]{43}$/;

interface Person {
  userId: string;
  email: string;
}

async function person(
  label: string,
  flags: { superAdmin?: boolean; memberships?: Array<[string, 'DESIGNER' | 'OWNER']>; name?: string } = {},
): Promise<Person> {
  const email = address(label);
  const { userId } = await createPasswordUser(prisma(), {
    email,
    name: flags.name ?? `${label} person`,
    password: GOOD,
    isSuperAdmin: flags.superAdmin,
  });
  // A Super Admin needs two-factor to run actions at all.
  if (flags.superAdmin) await prisma().user.update({ where: { id: userId }, data: { twoFactorEnabled: true } });
  for (const [restaurantId, role] of flags.memberships ?? []) {
    await prisma().membership.create({ data: { userId, restaurantId, role } });
  }
  return { userId, email };
}

const actorOf = async (who: Person) => (await loadActor(prisma(), who.userId)) as Actor;
const run = async <I, O>(who: Person, def: ActionDef<I, O>, input: unknown) =>
  runAction(prisma(), await actorOf(who), def, input, META);
const ask = async <I, O>(who: Person, def: QueryDef<I, O>, input: unknown) =>
  runQuery(prisma(), await actorOf(who), def, input);

const audit = (action: string) => prisma().auditLog.findMany({ where: { action }, orderBy: { occurredAt: 'asc' } });

let admin: Person;
let olive: Person; // owner of Atelier
let dee: Person; // designer at Atelier
let bea: Person; // owner of Bistro
let atelier: { id: string };
let bistro: { id: string };

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
  new Browser().activate();
  atelier = await prisma().restaurant.create({ data: { name: 'Atelier' }, select: { id: true } });
  bistro = await prisma().restaurant.create({ data: { name: 'Bistro' }, select: { id: true } });
  admin = await person('admin', { superAdmin: true });
  olive = await person('olive', { memberships: [[atelier.id, 'OWNER']] });
  dee = await person('dee', { memberships: [[atelier.id, 'DESIGNER']] });
  bea = await person('bea', { memberships: [[bistro.id, 'OWNER']] });
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

/** Lets the owners of a restaurant invite, as a Super Admin would through the client's policy. */
async function grantOwnersInvite(restaurantId: string) {
  const restaurant = await prisma().restaurant.findUniqueOrThrow({ where: { id: restaurantId }, select: { version: true } });
  dataOf(
    await run(admin, people.setPermissionPolicy, {
      restaurantId,
      version: restaurant.version,
      policy: { OWNER: { grant: ['people.invite'], revoke: [] } },
    }),
  );
}

describe('who may use the people actions', () => {
  it('lets only a Super Admin with two-factor on use the platform-wide ones', async () => {
    const staff = { email: address('new'), asSuperAdmin: false };
    expect(codeOf(await runAction(prisma(), null, people.inviteStaff, staff, META))).toBe('UNAUTHENTICATED');
    expect(codeOf(await run(olive, people.inviteStaff, staff))).toBe('FORBIDDEN');
    expect(codeOf(await run(dee, people.inviteStaff, staff))).toBe('FORBIDDEN');
    await prisma().user.update({ where: { id: admin.userId }, data: { twoFactorEnabled: false } });
    expect(codeOf(await run(admin, people.inviteStaff, staff))).toBe('TWO_FACTOR_REQUIRED');
    await prisma().user.update({ where: { id: admin.userId }, data: { twoFactorEnabled: true } });
    expect(codeOf(await run(admin, people.inviteStaff, staff))).toBe('OK');
  });

  it('keeps every people.manage and permissions.manage action from owners and designers, in their own restaurant too', async () => {
    const mine = atelier.id;
    const calls: Array<[string, (who: Person) => Promise<ActionResult<unknown>>]> = [
      ['assignDesigner', (who) => run(who, people.assignDesigner, { userId: bea.userId, restaurantId: mine })],
      ['unassignMember', (who) => run(who, people.unassignMember, { userId: dee.userId, restaurantId: mine })],
      ['deactivateUser', (who) => run(who, people.deactivateUser, { userId: dee.userId })],
      ['reactivateUser', (who) => run(who, people.reactivateUser, { userId: dee.userId })],
      ['changeUserEmail', (who) => run(who, people.changeUserEmail, { userId: dee.userId, email: address('else') })],
      ['setPermissionPolicy', (who) => run(who, people.setPermissionPolicy, { restaurantId: mine, version: 1, policy: {} })],
    ];
    for (const who of [olive, dee]) {
      for (const [name, call] of calls) expect(codeOf(await call(who)), name).toBe('FORBIDDEN');
    }
    // Nothing changed.
    expect(await prisma().membership.count()).toBe(3);
    expect(await prisma().user.count({ where: { deactivatedAt: { not: null } } })).toBe(0);
    expect(await prisma().auditLog.count()).toBe(0);
  });

  it('hides another restaurant from an owner who would otherwise be allowed', async () => {
    await grantOwnersInvite(bistro.id);
    expect(codeOf(await run(bea, people.inviteOwner, { restaurantId: atelier.id, email: address('x') }))).toBe('NOT_FOUND');
    expect(codeOf(await run(bea, people.inviteOwner, { restaurantId: 'no-such-restaurant', email: address('x') }))).toBe('NOT_FOUND');
  });
});

describe('inviting', () => {
  it('invites staff, mails the link, and shows it to the inviter to send another way', async () => {
    const email = address('newbie');
    const result = dataOf(await run(admin, people.inviteStaff, { email: ` ${email.toUpperCase()} `, asSuperAdmin: true }));
    expect(Object.keys(result).sort()).toEqual(['invitationId', 'url']);
    expect(result.url).toMatch(LINK);
    // The link shown is the link mailed, and a token the invitation page accepts.
    expect(await inspectInvitation(prisma(), tokenOf(result.url), new Date())).toMatchObject({ status: 'valid', role: 'SUPER_ADMIN', email });
    expect(linkIn((await mailTo(email))[0]?.text as string)).toBe(result.url);
    // It is kept nowhere: not in the audit log.
    const audited = JSON.stringify(await prisma().auditLog.findMany());
    expect(audited).not.toContain(tokenOf(result.url));
    expect(audited).not.toContain('/studio/invite/');
    const row = await prisma().invitation.findUniqueOrThrow({ where: { id: result.invitationId } });
    expect(row).toMatchObject({ email, restaurantId: null, role: null, asSuperAdmin: true, invitedById: admin.userId, acceptedAt: null, revokedAt: null });
    const [mail] = await mailTo(email);
    expect(mail?.text).toContain('Your role: Super Admin');
    expect(mail?.text).not.toContain('Restaurant:');
    expect(await inspectInvitation(prisma(), tokenOf(linkIn(mail?.text as string)), new Date())).toMatchObject({ status: 'valid', role: 'SUPER_ADMIN' });
  });

  it('invites an owner of a restaurant', async () => {
    const email = address('newbie');
    const { invitationId, url } = dataOf(await run(admin, people.inviteOwner, { restaurantId: atelier.id, email }));
    expect(await prisma().invitation.findUniqueOrThrow({ where: { id: invitationId } })).toMatchObject({
      email,
      restaurantId: atelier.id,
      role: 'OWNER',
      asSuperAdmin: false,
      invitedById: admin.userId,
    });
    expect(url).toMatch(LINK);
    expect(await inspectInvitation(prisma(), tokenOf(url), new Date())).toMatchObject({ status: 'valid', role: 'OWNER', restaurantName: 'Atelier' });
    const audited = JSON.stringify(await prisma().auditLog.findMany());
    expect(audited).not.toContain(tokenOf(url));
    expect(audited).not.toContain('/studio/invite/');
    const [mail] = await mailTo(email);
    expect(linkIn(mail?.text as string)).toBe(url);
    expect(mail?.text).toContain('Restaurant: Atelier');
    expect(mail?.text).toContain('Your role: Owner');
  });

  it('lets an owner invite a co-owner only when the client policy grants people.invite', async () => {
    const co = { restaurantId: atelier.id, email: address('co-owner') };
    expect(codeOf(await run(olive, people.inviteOwner, co))).toBe('FORBIDDEN');
    expect(await prisma().invitation.count()).toBe(0);

    await grantOwnersInvite(atelier.id);
    const { invitationId } = dataOf(await run(olive, people.inviteOwner, co));
    expect(await prisma().invitation.findUniqueOrThrow({ where: { id: invitationId } })).toMatchObject({
      restaurantId: atelier.id,
      role: 'OWNER',
      invitedById: olive.userId,
    });
    await mailTo(co.email);
    // The row of the audit log names the restaurant and the owner who invited.
    expect(await audit('invitation.created')).toMatchObject([{ actorId: olive.userId, restaurantId: atelier.id, entityId: invitationId }]);

    // The grant is for owners: the designer still cannot, and the other restaurant's owners are not helped.
    expect(codeOf(await run(dee, people.inviteOwner, co))).toBe('FORBIDDEN');
    expect(codeOf(await run(bea, people.inviteOwner, co))).toBe('NOT_FOUND');
  });

  it('refuses a person who already has this access, a pending duplicate, and a staff invitation that would do nothing', async () => {
    const member = await run(admin, people.inviteOwner, { restaurantId: atelier.id, email: olive.email });
    expect(failureOf(member)).toMatchObject({ code: 'INVALID', fields: { email: expect.any(String) } });

    const email = address('newbie');
    dataOf(await run(admin, people.inviteOwner, { restaurantId: atelier.id, email }));
    expect(failureOf(await run(admin, people.inviteOwner, { restaurantId: atelier.id, email: email.toUpperCase() }))).toMatchObject({
      code: 'CONFLICT',
      fields: { email: expect.any(String) },
    });
    // The same address for another restaurant is a different invitation.
    expect(codeOf(await run(admin, people.inviteOwner, { restaurantId: bistro.id, email }))).toBe('OK');

    expect(failureOf(await run(admin, people.inviteStaff, { email: admin.email, asSuperAdmin: true }))).toMatchObject({
      code: 'INVALID',
      fields: { email: expect.any(String) },
    });
    expect(failureOf(await run(admin, people.inviteStaff, { email: dee.email, asSuperAdmin: false }))).toMatchObject({ code: 'INVALID', fields: { email: expect.any(String) } });
    // Staff invitations are pending duplicates of each other too, and a different kind is not one.
    const staff = address('staff');
    expect(codeOf(await run(admin, people.inviteStaff, { email: staff, asSuperAdmin: false }))).toBe('OK');
    expect(failureOf(await run(admin, people.inviteStaff, { email: staff, asSuperAdmin: false }))).toMatchObject({ code: 'CONFLICT', fields: { email: expect.any(String) } });
    expect(codeOf(await run(admin, people.inviteStaff, { email: staff, asSuperAdmin: true }))).toBe('OK');
    // A person who has an account can still be made a Super Admin, or an owner of another restaurant.
    expect(codeOf(await run(admin, people.inviteStaff, { email: dee.email, asSuperAdmin: true }))).toBe('OK');
    expect(codeOf(await run(admin, people.inviteOwner, { restaurantId: bistro.id, email: dee.email }))).toBe('OK');
  });

  it('allows a new invitation once the earlier one has expired, been revoked, or been used', async () => {
    const email = address('newbie');
    const first = dataOf(await run(admin, people.inviteOwner, { restaurantId: atelier.id, email }));
    await prisma().invitation.update({ where: { id: first.invitationId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const second = dataOf(await run(admin, people.inviteOwner, { restaurantId: atelier.id, email }));
    dataOf(await run(admin, people.revokeInvitation, { invitationId: second.invitationId, restaurantId: atelier.id }));
    expect(codeOf(await run(admin, people.inviteOwner, { restaurantId: atelier.id, email }))).toBe('OK');
  });

  it('checks the input', async () => {
    expect(failureOf(await run(admin, people.inviteStaff, { email: 'not an email', asSuperAdmin: false }))).toMatchObject({
      code: 'INVALID',
      fields: { email: expect.any(String) },
    });
    expect(codeOf(await run(admin, people.inviteStaff, { email: address('x') }))).toBe('INVALID');
    expect(codeOf(await run(admin, people.inviteStaff, { email: address('x'), asSuperAdmin: 'yes' }))).toBe('INVALID');
    expect(codeOf(await run(admin, people.inviteOwner, { email: address('x') }))).toBe('INVALID');
    expect(await prisma().invitation.count()).toBe(0);
  });
});

describe('revoking and resending an invitation', () => {
  it('revokes an invitation, and its link stops working', async () => {
    const email = address('newbie');
    const { invitationId } = dataOf(await run(admin, people.inviteOwner, { restaurantId: atelier.id, email }));
    const token = tokenOf(linkIn((await mailTo(email))[0]?.text as string));

    expect(dataOf(await run(admin, people.revokeInvitation, { invitationId, restaurantId: atelier.id }))).toEqual({ revoked: true });
    expect(await inspectInvitation(prisma(), token, new Date())).toEqual({ status: 'revoked' });
    expect(await audit('invitation.revoked')).toMatchObject([{ actorId: admin.userId, restaurantId: atelier.id, entityId: invitationId }]);
    // Once is enough.
    expect(codeOf(await run(admin, people.revokeInvitation, { invitationId, restaurantId: atelier.id }))).toBe('CONFLICT');
  });

  it('lets a Super Admin act on an invitation without naming its restaurant', async () => {
    const { invitationId } = dataOf(await run(admin, people.inviteOwner, { restaurantId: atelier.id, email: address('newbie') }));
    expect(codeOf(await run(admin, people.resendInvitation, { invitationId }))).toBe('OK');
    expect(codeOf(await run(admin, people.revokeInvitation, { invitationId }))).toBe('OK');
  });

  it('refuses to revoke an invitation that was used', async () => {
    const email = address('newbie');
    const { invitationId } = dataOf(await run(admin, people.inviteOwner, { restaurantId: atelier.id, email }));
    await prisma().invitation.update({ where: { id: invitationId }, data: { acceptedAt: new Date() } });
    expect(codeOf(await run(admin, people.revokeInvitation, { invitationId, restaurantId: atelier.id }))).toBe('CONFLICT');
    expect(codeOf(await run(admin, people.resendInvitation, { invitationId, restaurantId: atelier.id }))).toBe('CONFLICT');
  });

  it('lets an owner with people.invite handle the invitations of their own restaurant only', async () => {
    await grantOwnersInvite(atelier.id);
    const mine = dataOf(await run(olive, people.inviteOwner, { restaurantId: atelier.id, email: address('mine') }));
    const theirs = dataOf(await run(admin, people.inviteOwner, { restaurantId: bistro.id, email: address('theirs') }));
    const staff = dataOf(await run(admin, people.inviteStaff, { email: address('staff'), asSuperAdmin: false }));

    // Another restaurant's invitation, named through one's own restaurant, and through the other one.
    expect(codeOf(await run(olive, people.revokeInvitation, { invitationId: theirs.invitationId, restaurantId: atelier.id }))).toBe('NOT_FOUND');
    expect(codeOf(await run(olive, people.revokeInvitation, { invitationId: theirs.invitationId, restaurantId: bistro.id }))).toBe('NOT_FOUND');
    expect(codeOf(await run(olive, people.resendInvitation, { invitationId: theirs.invitationId, restaurantId: atelier.id }))).toBe('NOT_FOUND');
    // A staff invitation is not any restaurant's.
    expect(codeOf(await run(olive, people.revokeInvitation, { invitationId: staff.invitationId, restaurantId: atelier.id }))).toBe('NOT_FOUND');
    // Without a restaurant, the action is the platform's.
    expect(codeOf(await run(olive, people.revokeInvitation, { invitationId: mine.invitationId }))).toBe('FORBIDDEN');
    expect(await prisma().invitation.count({ where: { revokedAt: { not: null } } })).toBe(0);

    expect(codeOf(await run(olive, people.resendInvitation, { invitationId: mine.invitationId, restaurantId: atelier.id }))).toBe('OK');
    expect(codeOf(await run(olive, people.revokeInvitation, { invitationId: mine.invitationId, restaurantId: atelier.id }))).toBe('OK');
  });

  it('keeps the staff invitations for Super Admins', async () => {
    await grantOwnersInvite(atelier.id);
    const staff = dataOf(await run(admin, people.inviteStaff, { email: address('staff'), asSuperAdmin: false }));
    expect(codeOf(await run(olive, people.revokeInvitation, { invitationId: staff.invitationId }))).toBe('FORBIDDEN');
    expect(codeOf(await run(admin, people.revokeInvitation, { invitationId: staff.invitationId }))).toBe('OK');
  });

  it('resends with a new token and a new expiry, and the old link stops working', async () => {
    const email = address('newbie');
    const { invitationId } = dataOf(await run(admin, people.inviteOwner, { restaurantId: atelier.id, email }));
    const oldToken = tokenOf(linkIn((await mailTo(email))[0]?.text as string));
    // Expired by now.
    await prisma().invitation.update({ where: { id: invitationId }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    expect((await inspectInvitation(prisma(), oldToken, new Date())).status).toBe('expired');

    const before = Date.now();
    const resent = dataOf(await run(admin, people.resendInvitation, { invitationId, restaurantId: atelier.id }));
    expect(Object.keys(resent).sort()).toEqual(['invitationId', 'url']);
    expect(resent.invitationId).toBe(invitationId);
    expect(resent.url).toMatch(LINK);

    const mails = await mailTo(email, 2);
    const newToken = tokenOf(linkIn(mails[0]?.text as string));
    // The link shown to the one who resent it is the new link, not the old one.
    expect(tokenOf(resent.url)).toBe(newToken);
    expect(newToken).not.toBe(oldToken);
    expect((await inspectInvitation(prisma(), oldToken, new Date())).status).toBe('unknown');
    expect(await inspectInvitation(prisma(), newToken, new Date())).toMatchObject({ status: 'valid', email });
    const row = await prisma().invitation.findUniqueOrThrow({ where: { id: invitationId } });
    expect(row.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 7 * 24 * 3600 * 1000);
    expect(await prisma().invitation.count()).toBe(1);
    expect(await audit('invitation.resent')).toMatchObject([{ actorId: admin.userId, restaurantId: atelier.id, entityId: invitationId }]);
  });

  it('writes no token, hash or link in any audit row', async () => {
    const email = address('newbie');
    const { invitationId, url } = dataOf(await run(admin, people.inviteOwner, { restaurantId: atelier.id, email }));
    const first = tokenOf(url);
    const { url: again } = dataOf(await run(admin, people.resendInvitation, { invitationId, restaurantId: atelier.id }));
    const second = tokenOf(again);
    dataOf(await run(admin, people.revokeInvitation, { invitationId, restaurantId: atelier.id }));

    const hashes = (await prisma().invitation.findMany()).map((row) => row.tokenHash);
    const json = JSON.stringify(await prisma().auditLog.findMany());
    for (const secret of [first, second, ...hashes, '/studio/invite/']) expect(json).not.toContain(secret);
    expect((await prisma().auditLog.findMany()).map((row) => row.action).sort()).toEqual(['invitation.created', 'invitation.resent', 'invitation.revoked']);
  });
});

describe('memberships', () => {
  it('assigns a designer to a restaurant, and the designer can then act there', async () => {
    const other = await person('other');
    expect(dataOf(await run(admin, people.assignDesigner, { userId: other.userId, restaurantId: bistro.id }))).toEqual({ assigned: true });
    expect(await prisma().membership.findFirstOrThrow({ where: { userId: other.userId } })).toMatchObject({ restaurantId: bistro.id, role: 'DESIGNER' });
    expect(await audit('membership.assigned')).toMatchObject([
      { actorId: admin.userId, restaurantId: bistro.id, entityType: 'User', entityId: other.userId, changes: { role: { before: null, after: 'DESIGNER' } } },
    ]);
    // Designers hold menu.create by default.
    const needsCreate = defineAction({
      name: 'test.createMenu',
      permission: 'menu.create',
      input: z.object({ restaurantId: z.string() }),
      target: (i) => ({ kind: 'restaurant', restaurantId: i.restaurantId }),
      run: async () => 'created',
    });
    expect(codeOf(await run(other, needsCreate, { restaurantId: bistro.id }))).toBe('OK');
  });

  it('refuses to assign someone who is already a member, a missing user and a missing restaurant', async () => {
    expect(codeOf(await run(admin, people.assignDesigner, { userId: dee.userId, restaurantId: atelier.id }))).toBe('CONFLICT');
    // An owner is not turned into a designer by it either.
    expect(codeOf(await run(admin, people.assignDesigner, { userId: olive.userId, restaurantId: atelier.id }))).toBe('CONFLICT');
    expect(await prisma().membership.findFirstOrThrow({ where: { userId: olive.userId } })).toMatchObject({ role: 'OWNER' });
    expect(codeOf(await run(admin, people.assignDesigner, { userId: 'nobody', restaurantId: atelier.id }))).toBe('NOT_FOUND');
    expect(codeOf(await run(admin, people.assignDesigner, { userId: dee.userId, restaurantId: 'nowhere' }))).toBe('NOT_FOUND');
  });

  it('refuses to make a till account a designer: a person is either till staff or a Studio member', async () => {
    const till = await person('till');
    await prisma().posStaff.create({ data: { restaurantId: atelier.id, userId: till.userId, role: 'CASHIER' } });
    expect(codeOf(await run(admin, people.assignDesigner, { userId: till.userId, restaurantId: atelier.id }))).toBe('CONFLICT');
    expect(await prisma().membership.count({ where: { userId: till.userId } })).toBe(0);
  });

  it('refuses to invite a till account into the Studio, and gives no membership on an older invitation', async () => {
    const till = await person('till');
    await prisma().posStaff.create({ data: { restaurantId: atelier.id, userId: till.userId, role: 'CASHIER' } });
    expect(codeOf(await run(admin, people.inviteOwner, { restaurantId: atelier.id, email: till.email }))).toBe('INVALID');

    // An invitation sent before the person became till staff is refused when it is accepted.
    const other = await person('other');
    const { url } = dataOf(await run(admin, people.inviteOwner, { restaurantId: atelier.id, email: other.email }));
    await prisma().posStaff.create({ data: { restaurantId: atelier.id, userId: other.userId, role: 'CASHIER' } });
    await expect(acceptInvitation(prisma(), { token: tokenOf(url), signedInUserId: other.userId, now: new Date() })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await prisma().membership.count({ where: { userId: other.userId } })).toBe(0);
  });

  it('removes a member from one restaurant and leaves their others alone', async () => {
    await run(admin, people.assignDesigner, { userId: dee.userId, restaurantId: bistro.id });
    expect(dataOf(await run(admin, people.unassignMember, { userId: dee.userId, restaurantId: atelier.id }))).toEqual({ unassigned: true });
    expect((await prisma().membership.findMany({ where: { userId: dee.userId } })).map((m) => m.restaurantId)).toEqual([bistro.id]);
    expect(await audit('membership.removed')).toMatchObject([
      { restaurantId: atelier.id, entityId: dee.userId, changes: { role: { before: 'DESIGNER', after: null } } },
    ]);
    expect(codeOf(await run(admin, people.unassignMember, { userId: dee.userId, restaurantId: atelier.id }))).toBe('NOT_FOUND');
    // Someone else's membership of the other restaurant is not reachable through this one.
    expect(codeOf(await run(admin, people.unassignMember, { userId: bea.userId, restaurantId: atelier.id }))).toBe('NOT_FOUND');
    expect(await prisma().membership.count({ where: { userId: bea.userId } })).toBe(1);
  });

  it('withdraws the invitations a removed member sent into the restaurant, so they cannot come back through another address', async () => {
    // Olive owns both restaurants, and both clients let owners invite.
    await prisma().membership.create({ data: { userId: olive.userId, restaurantId: bistro.id, role: 'OWNER' } });
    await grantOwnersInvite(atelier.id);
    await grantOwnersInvite(bistro.id);
    const mine = address('olive-other-address');
    const toAtelier = dataOf(await run(olive, people.inviteOwner, { restaurantId: atelier.id, email: mine }));
    const toBistro = dataOf(await run(olive, people.inviteOwner, { restaurantId: bistro.id, email: address('for-bistro') }));
    const used = dataOf(await run(olive, people.inviteOwner, { restaurantId: atelier.id, email: address('used') }));
    await prisma().invitation.update({ where: { id: used.invitationId }, data: { acceptedAt: new Date() } });
    const byAdmin = dataOf(await run(admin, people.inviteOwner, { restaurantId: atelier.id, email: address('by-admin') }));
    expect((await inspectInvitation(prisma(), tokenOf(toAtelier.url), new Date())).status).toBe('valid');

    expect(dataOf(await run(admin, people.unassignMember, { userId: olive.userId, restaurantId: atelier.id }))).toEqual({ unassigned: true });

    // The invitation to the address Olive controls is dead, and accepting it makes neither an account nor a membership.
    expect(await inspectInvitation(prisma(), tokenOf(toAtelier.url), new Date())).toEqual({ status: 'revoked' });
    await expect(
      acceptInvitation(prisma(), { token: tokenOf(toAtelier.url), signedInUserId: null, name: 'Olive Again', password: GOOD, now: new Date() }),
    ).rejects.toMatchObject({ code: 'INVALID', fields: { token: expect.any(String) } });
    expect(await prisma().user.count({ where: { email: mine } })).toBe(0);
    expect(await prisma().membership.count({ where: { restaurantId: atelier.id, role: 'OWNER' } })).toBe(0);

    // Only what she sent into Atelier that nobody had used: Bistro's (where she is still an owner), the used one and the admin's stand.
    const byId = new Map((await prisma().invitation.findMany()).map((row) => [row.id, row]));
    expect(byId.get(toAtelier.invitationId)?.revokedAt).toBeInstanceOf(Date);
    expect(byId.get(toBistro.invitationId)?.revokedAt).toBeNull();
    expect(byId.get(used.invitationId)?.revokedAt).toBeNull();
    expect(byId.get(byAdmin.invitationId)?.revokedAt).toBeNull();
    expect((await inspectInvitation(prisma(), tokenOf(toBistro.url), new Date())).status).toBe('valid');

    // The count is in the audit row.
    expect(await audit('membership.removed')).toMatchObject([
      { restaurantId: atelier.id, entityId: olive.userId, changes: { role: { before: 'OWNER', after: null }, invitationsRevoked: { before: 0, after: 1 } } },
    ]);
  });

  it('lets a Super Admin remove the last owner of a restaurant', async () => {
    expect(codeOf(await run(admin, people.unassignMember, { userId: olive.userId, restaurantId: atelier.id }))).toBe('OK');
    expect(await prisma().membership.count({ where: { restaurantId: atelier.id, role: 'OWNER' } })).toBe(0);
  });
});

describe('deactivating and reactivating', () => {
  it('ends the sessions of a deactivated user and blocks their actions', async () => {
    const browser = new Browser('198.51.100.40', 'dee browser').activate();
    expect(await invokePublic(session.signIn, { email: dee.email, password: GOOD })).toMatchObject({ ok: true });
    expect(await prisma().session.count({ where: { userId: dee.userId } })).toBe(1);
    expect(await invoke(accountActions.setStudioLanguage, { locale: 'ar' })).toMatchObject({ ok: true });

    expect(dataOf(await run(admin, people.deactivateUser, { userId: dee.userId }))).toEqual({ deactivated: true });

    expect(await prisma().session.count({ where: { userId: dee.userId } })).toBe(0);
    expect((await prisma().user.findUniqueOrThrow({ where: { id: dee.userId } })).deactivatedAt).toBeInstanceOf(Date);
    expect(await loadActor(prisma(), dee.userId)).toBeNull();
    browser.activate();
    expect(codeOf(await invoke(accountActions.setStudioLanguage, { locale: 'en' }))).toBe('UNAUTHENTICATED');
    expect(codeOf(await invokePublic(session.signIn, { email: dee.email, password: GOOD }))).toBe('INVALID');
    // Their history and their memberships stay.
    expect(await prisma().membership.count({ where: { userId: dee.userId } })).toBe(1);
    expect(await audit('user.deactivated')).toMatchObject([{ actorId: admin.userId, entityType: 'User', entityId: dee.userId }]);
  });

  it('refuses to deactivate yourself, a missing user, and someone already deactivated', async () => {
    const other = await person('other-admin', { superAdmin: true });
    expect(failureOf(await run(admin, people.deactivateUser, { userId: admin.userId }))).toMatchObject({ code: 'INVALID', fields: { userId: expect.any(String) } });
    expect(await loadActor(prisma(), admin.userId)).not.toBeNull();
    expect(codeOf(await run(admin, people.deactivateUser, { userId: 'nobody' }))).toBe('NOT_FOUND');
    dataOf(await run(admin, people.deactivateUser, { userId: other.userId }));
    expect(codeOf(await run(admin, people.deactivateUser, { userId: other.userId }))).toBe('CONFLICT');
  });

  it('revokes the invitations a deactivated person sent that nobody has used yet', async () => {
    await grantOwnersInvite(atelier.id);
    const pending = dataOf(await run(olive, people.inviteOwner, { restaurantId: atelier.id, email: address('pending') }));
    const used = dataOf(await run(olive, people.inviteOwner, { restaurantId: atelier.id, email: address('used') }));
    await prisma().invitation.update({ where: { id: used.invitationId }, data: { acceptedAt: new Date() } });
    const adminsOwn = dataOf(await run(admin, people.inviteOwner, { restaurantId: atelier.id, email: address('admins') }));

    dataOf(await run(admin, people.deactivateUser, { userId: olive.userId }));

    const rows = await prisma().invitation.findMany();
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(pending.invitationId)?.revokedAt).toBeInstanceOf(Date);
    expect(byId.get(used.invitationId)?.revokedAt).toBeNull();
    expect(byId.get(adminsOwn.invitationId)?.revokedAt).toBeNull();
  });

  it('refuses to deactivate a Super Admin for anyone who is not one', async () => {
    const second = await person('second-admin', { superAdmin: true });
    const owner = await actorOf(olive);
    await expect(globalDb(prisma()).$transaction((tx) => deactivatePerson(tx, { actor: owner, userId: second.userId, now: new Date() }))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect((await prisma().user.findUniqueOrThrow({ where: { id: second.userId } })).deactivatedAt).toBeNull();
  });

  it('keeps at least one active Super Admin', async () => {
    const other = await person('other-admin', { superAdmin: true });
    // A different person is acting, so the self rule does not apply: only the last-Super-Admin rule can refuse.
    const stranger = await actorOf(other);
    await prisma().user.update({ where: { id: other.userId }, data: { deactivatedAt: new Date() } });
    await expect(globalDb(prisma()).$transaction((tx) => deactivatePerson(tx, { actor: stranger, userId: admin.userId, now: new Date() }))).rejects.toMatchObject({
      code: 'INVALID',
    });
    expect((await prisma().user.findUniqueOrThrow({ where: { id: admin.userId } })).deactivatedAt).toBeNull();
  });

  it('lets only one of two Super Admins deactivate the other when they try at the same moment', async () => {
    const other = await person('other-admin', { superAdmin: true });
    const [mine, theirs] = [await actorOf(admin), await actorOf(other)];

    // The first deactivation has made its change and has not committed yet when the second one starts.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let changed!: () => void;
    const hasChanged = new Promise<void>((resolve) => (changed = resolve));
    const first = globalDb(prisma()).$transaction(async (tx) => {
      await deactivatePerson(tx, { actor: mine, userId: other.userId, now: new Date() });
      changed();
      await held;
    });
    await hasChanged;
    const second = runAction(prisma(), theirs, people.deactivateUser, { userId: admin.userId }, META);
    // Long enough for the second to finish, if nothing made it wait.
    await new Promise((resolve) => setTimeout(resolve, 400));
    release();
    await first;

    // It waited, then saw that its target was the last one.
    expect(failureOf(await second)).toMatchObject({ code: 'INVALID', fields: { userId: expect.any(String) } });
    expect(await prisma().user.count({ where: { isSuperAdmin: true, deactivatedAt: null } })).toBe(1);
    expect((await prisma().user.findUniqueOrThrow({ where: { id: admin.userId } })).deactivatedAt).toBeNull();
  });

  it('reactivates a person, who can then sign in again', async () => {
    dataOf(await run(admin, people.deactivateUser, { userId: dee.userId }));
    expect(codeOf(await run(admin, people.reactivateUser, { userId: admin.userId }))).toBe('CONFLICT');
    expect(dataOf(await run(admin, people.reactivateUser, { userId: dee.userId }))).toEqual({ reactivated: true });
    expect((await prisma().user.findUniqueOrThrow({ where: { id: dee.userId } })).deactivatedAt).toBeNull();
    expect(await loadActor(prisma(), dee.userId)).not.toBeNull();
    new Browser('198.51.100.41', 'dee again').activate();
    expect(await invokePublic(session.signIn, { email: dee.email, password: GOOD })).toMatchObject({ ok: true });
    expect(await audit('user.reactivated')).toMatchObject([{ actorId: admin.userId, entityId: dee.userId }]);
    expect(codeOf(await run(admin, people.reactivateUser, { userId: 'nobody' }))).toBe('NOT_FOUND');
  });
});

describe('deleting an account', () => {
  it('deletes a deactivated account for good, with its memberships and till rows, and records it', async () => {
    const till = await person('till', { memberships: [[atelier.id, 'DESIGNER']] });
    await prisma().posStaff.create({ data: { restaurantId: atelier.id, userId: till.userId, role: 'CASHIER' } });
    dataOf(await run(admin, people.deactivateUser, { userId: till.userId }));
    expect(dataOf(await run(admin, people.deleteUser, { userId: till.userId }))).toEqual({ deleted: true });
    expect(await prisma().user.count({ where: { id: till.userId } })).toBe(0);
    expect(await prisma().membership.count({ where: { userId: till.userId } })).toBe(0);
    expect(await prisma().posStaff.count({ where: { userId: till.userId } })).toBe(0);
    expect(await audit('user.deleted')).toMatchObject([{ actorId: admin.userId, entityType: 'User', entityId: till.userId }]);
  });

  it('refuses an active account, oneself, a Super Admin, an unknown account, and one with a till shift', async () => {
    expect(codeOf(await run(admin, people.deleteUser, { userId: dee.userId }))).toBe('CONFLICT');
    expect(codeOf(await run(admin, people.deleteUser, { userId: admin.userId }))).toBe('INVALID');
    const other = await person('other-admin', { superAdmin: true });
    dataOf(await run(admin, people.deactivateUser, { userId: other.userId }));
    expect(codeOf(await run(admin, people.deleteUser, { userId: other.userId }))).toBe('FORBIDDEN');
    expect(codeOf(await run(admin, people.deleteUser, { userId: 'nobody' }))).toBe('NOT_FOUND');

    const cashier = await person('cashier');
    await prisma().posShift.create({ data: { restaurantId: atelier.id, userId: cashier.userId, openingFloat: 0 } });
    dataOf(await run(admin, people.deactivateUser, { userId: cashier.userId }));
    expect(codeOf(await run(admin, people.deleteUser, { userId: cashier.userId }))).toBe('CONFLICT');
    expect(await prisma().user.count({ where: { id: cashier.userId } })).toBe(1);
  });

  it('is for Super Admins only', async () => {
    dataOf(await run(admin, people.deactivateUser, { userId: dee.userId }));
    expect(codeOf(await run(olive, people.deleteUser, { userId: dee.userId }))).not.toBe('OK');
  });
});

describe('changing a user email', () => {
  it('changes it, tells the old address, and leaves the person signed in', async () => {
    const browser = new Browser('198.51.100.42', 'dee browser').activate();
    expect(await invokePublic(session.signIn, { email: dee.email, password: GOOD })).toMatchObject({ ok: true });
    const next = address('dee-new');

    expect(dataOf(await run(admin, people.changeUserEmail, { userId: dee.userId, email: ` ${next.toUpperCase()} ` }))).toEqual({ email: next });

    expect((await prisma().user.findUniqueOrThrow({ where: { id: dee.userId } })).email).toBe(next);
    expect(await audit('user.email_changed')).toMatchObject([
      { actorId: admin.userId, entityId: dee.userId, changes: { email: { before: dee.email, after: next } } },
    ]);
    const [notice] = await mailTo(dee.email);
    expect(notice?.text).toContain(next);
    expect(notice?.subject).toBe('Your Buzzify Core email was changed');
    expect(await prisma().session.count({ where: { userId: dee.userId } })).toBe(1);
    expect(browser.has('studio.session_token')).toBe(true);
    // Signs in with the new address now, not the old one.
    new Browser('198.51.100.43', 'fresh').activate();
    expect(await invokePublic(session.signIn, { email: next, password: GOOD })).toMatchObject({ ok: true });
    expect(codeOf(await invokePublic(session.signIn, { email: dee.email, password: GOOD }))).toBe('INVALID');
  });

  it('refuses an address another account has, the same address, your own account, and a missing user', async () => {
    expect(failureOf(await run(admin, people.changeUserEmail, { userId: dee.userId, email: olive.email.toUpperCase() }))).toMatchObject({
      code: 'INVALID',
      fields: { email: expect.any(String) },
    });
    expect(failureOf(await run(admin, people.changeUserEmail, { userId: dee.userId, email: dee.email }))).toMatchObject({ code: 'INVALID', fields: { email: expect.any(String) } });
    expect(failureOf(await run(admin, people.changeUserEmail, { userId: admin.userId, email: address('mine') }))).toMatchObject({ code: 'INVALID', fields: { userId: expect.any(String) } });
    expect(codeOf(await run(admin, people.changeUserEmail, { userId: 'nobody', email: address('x') }))).toBe('NOT_FOUND');
    expect(codeOf(await run(admin, people.changeUserEmail, { userId: dee.userId, email: 'nope' }))).toBe('INVALID');
    expect((await prisma().user.findUniqueOrThrow({ where: { id: dee.userId } })).email).toBe(dee.email);
    await quiet();
    expect(await prisma().auditLog.count()).toBe(0);
  });
});

describe('permission policies', () => {
  it('saves what parsePolicy makes of the policy, and moves the version on', async () => {
    const result = dataOf(
      await run(admin, people.setPermissionPolicy, {
        restaurantId: atelier.id,
        version: 1,
        policy: {
          DESIGNER: { grant: ['menu.delete', 'people.invite', 'people.invite', 'no.such.key', 'audit.view'], revoke: ['publish.schedule'] },
          OWNER: { grant: ['people.invite', 'prices.bulk'], revoke: [] },
          MANAGER: { grant: ['content.edit'], revoke: [] },
        },
      }),
    );
    const expected = { DESIGNER: { grant: ['people.invite'], revoke: ['publish.schedule'] }, OWNER: { grant: ['people.invite', 'prices.bulk'], revoke: [] } };
    expect(result).toEqual({ policy: expected, version: 2 });
    const row = await prisma().restaurant.findUniqueOrThrow({ where: { id: atelier.id } });
    expect(row).toMatchObject({ permissionPolicy: expected, version: 2 });
    expect(parsePolicy(row.permissionPolicy)).toEqual(expected);
    expect(await audit('restaurant.permission_policy_changed')).toMatchObject([
      { actorId: admin.userId, restaurantId: atelier.id, entityType: 'Restaurant', entityId: atelier.id, changes: { permissionPolicy: { before: {}, after: expected } } },
    ]);
  });

  it('answers a stale version with CONFLICT and says who changed it', async () => {
    dataOf(await run(admin, people.setPermissionPolicy, { restaurantId: atelier.id, version: 1, policy: { OWNER: { grant: ['people.invite'], revoke: [] } } }));
    const stale = failureOf(await run(admin, people.setPermissionPolicy, { restaurantId: atelier.id, version: 1, policy: {} }));
    expect(stale).toMatchObject({ code: 'CONFLICT', fields: { changedBy: 'admin person' } });
    expect((await prisma().restaurant.findUniqueOrThrow({ where: { id: atelier.id } })).permissionPolicy).toEqual({ OWNER: { grant: ['people.invite'], revoke: [] } });
  });

  it('refuses a designer granting itself menu.delete through a policy', async () => {
    const policy = { DESIGNER: { grant: ['menu.delete', 'permissions.manage', 'people.manage'], revoke: [] } };
    // Neither a designer nor an owner can edit a policy at all: permissions.manage is never granted.
    for (const who of [dee, olive]) {
      expect(codeOf(await run(who, people.setPermissionPolicy, { restaurantId: atelier.id, version: 1, policy }))).toBe('FORBIDDEN');
    }
    expect((await prisma().restaurant.findUniqueOrThrow({ where: { id: atelier.id } })).permissionPolicy).toEqual({});

    // Even a Super Admin cannot hand those keys out: they are dropped when the policy is saved.
    dataOf(await run(admin, people.setPermissionPolicy, { restaurantId: atelier.id, version: 1, policy }));
    const stored = (await prisma().restaurant.findUniqueOrThrow({ where: { id: atelier.id } })).permissionPolicy;
    expect(stored).toEqual({ DESIGNER: { grant: [], revoke: [] } });
    const held = effectivePermissions({ isSuperAdmin: false, role: 'DESIGNER', policy: parsePolicy(stored) });
    expect(held.has('menu.delete')).toBe(false);
    const deleteMenu = defineAction({
      name: 'test.deleteMenu',
      permission: 'menu.delete',
      input: z.object({ restaurantId: z.string() }),
      target: (i) => ({ kind: 'restaurant', restaurantId: i.restaurantId }),
      run: async () => 'deleted',
    });
    expect(codeOf(await run(dee, deleteMenu, { restaurantId: atelier.id }))).toBe('FORBIDDEN');
  });

  it('takes effect for the restaurant at once, and revoking undoes it', async () => {
    const invite = { restaurantId: atelier.id, email: address('co-owner') };
    expect(codeOf(await run(olive, people.inviteOwner, invite))).toBe('FORBIDDEN');
    await grantOwnersInvite(atelier.id);
    expect(codeOf(await run(olive, people.inviteOwner, invite))).toBe('OK');
    dataOf(await run(admin, people.setPermissionPolicy, { restaurantId: atelier.id, version: 2, policy: {} }));
    expect(codeOf(await run(olive, people.inviteOwner, { ...invite, email: address('second') }))).toBe('FORBIDDEN');
  });

  it('refuses a policy that is not shaped like one, and a missing restaurant', async () => {
    const save = (policy: unknown, restaurantId = atelier.id) => run(admin, people.setPermissionPolicy, { restaurantId, version: 1, policy });
    for (const policy of ['everything', 7, null, [], { OWNER: 'all' }, { OWNER: { grant: 'people.invite', revoke: [] } }, { OWNER: { grant: [1], revoke: [] } }]) {
      expect(codeOf(await save(policy)), JSON.stringify(policy)).toBe('INVALID');
    }
    expect(codeOf(await save({}, 'nowhere'))).toBe('NOT_FOUND');
    expect(codeOf(await run(admin, people.setPermissionPolicy, { restaurantId: atelier.id, policy: {} }))).toBe('INVALID');
    expect((await prisma().restaurant.findUniqueOrThrow({ where: { id: atelier.id } })).version).toBe(1);
  });
});

describe('restaurantPolicy', () => {
  it('gives a Super Admin the stored policy (parsed) and the version to save it against', async () => {
    expect(dataOf(await ask(admin, peopleQueries.restaurantPolicy, { restaurantId: atelier.id }))).toEqual({ policy: {}, version: 1 });
    await prisma().restaurant.update({
      where: { id: atelier.id },
      data: { permissionPolicy: { OWNER: { grant: ['people.invite', 'menu.delete', 'no.such.key'], revoke: ['publish.now'] }, MANAGER: { grant: [] } } },
    });
    const read = dataOf(await ask(admin, peopleQueries.restaurantPolicy, { restaurantId: atelier.id }));
    expect(read.policy).toEqual({ OWNER: { grant: ['people.invite'], revoke: ['publish.now'] } });
    // What it returns is what the next save names: saving it back moves the version on.
    expect(dataOf(await run(admin, people.setPermissionPolicy, { restaurantId: atelier.id, version: read.version, policy: read.policy })).version).toBe(read.version + 1);
  });

  it('is for those who may change permissions: not a designer, not an owner, not another restaurant', async () => {
    for (const who of [dee, olive]) expect(codeOf(await ask(who, peopleQueries.restaurantPolicy, { restaurantId: atelier.id }))).toBe('FORBIDDEN');
    expect(codeOf(await ask(bea, peopleQueries.restaurantPolicy, { restaurantId: atelier.id }))).toBe('NOT_FOUND');
    expect(codeOf(await ask(admin, peopleQueries.restaurantPolicy, { restaurantId: 'nowhere' }))).toBe('NOT_FOUND');
  });
});

describe('the people queries', () => {
  async function many(count: number) {
    for (let i = 0; i < count; i += 1) await person(`bulk${String(i).padStart(2, '0')}`, { name: `Bulk ${String(i).padStart(2, '0')}` });
  }

  it('shows a Super Admin everyone, with their restaurants', async () => {
    await prisma().user.update({ where: { id: bea.userId }, data: { deactivatedAt: new Date() } });
    const { rows, total, page } = dataOf(await ask(admin, peopleQueries.listPeople, { page: 1 }));
    expect([total, page]).toEqual([4, 1]);
    expect(rows.map((r) => r.email).sort()).toEqual([admin.email, bea.email, dee.email, olive.email].sort());
    expect(rows.find((r) => r.email === admin.email)).toMatchObject({ isSuperAdmin: true, deactivated: false, memberships: [] });
    expect(rows.find((r) => r.email === bea.email)).toMatchObject({ deactivated: true, memberships: [{ restaurantId: bistro.id, restaurantName: 'Bistro', role: 'OWNER' }] });
  });

  it('filters by restaurant and by search, and pages', async () => {
    await many(30);
    const atAtelier = dataOf(await ask(admin, peopleQueries.listPeople, { restaurantId: atelier.id, page: 1 }));
    expect(atAtelier.rows.map((r) => r.email).sort()).toEqual([dee.email, olive.email].sort());

    const found = dataOf(await ask(admin, peopleQueries.listPeople, { q: 'BULK 1', page: 1 }));
    expect(found.rows.map((r) => r.name)).toEqual(Array.from({ length: 10 }, (_, i) => `Bulk ${10 + i}`));
    expect(dataOf(await ask(admin, peopleQueries.listPeople, { q: olive.email.toUpperCase(), page: 1 })).rows).toHaveLength(1);

    const first = dataOf(await ask(admin, peopleQueries.listPeople, { page: 1 }));
    const second = dataOf(await ask(admin, peopleQueries.listPeople, { page: 2 }));
    expect([first.total, first.rows.length, first.pageSize]).toEqual([34, 25, 25]);
    expect([second.rows.length, second.page]).toEqual([9, 2]);
    expect(new Set([...first.rows, ...second.rows].map((r) => r.userId)).size).toBe(34);
    expect(dataOf(await ask(admin, peopleQueries.listPeople, { page: 3 })).rows).toEqual([]);
    expect(codeOf(await ask(admin, peopleQueries.listPeople, { page: 0 }))).toBe('INVALID');
    expect(dataOf(await ask(admin, peopleQueries.listPeople, {})).page).toBe(1);
  });

  it('searches for a typed % or _ as itself, as every other search does', async () => {
    await person('percent', { name: 'Fifty % Off' });
    for (const q of ['%', '_']) {
      const found = dataOf(await ask(admin, peopleQueries.listPeople, { q, page: 1 })).rows.map((r) => r.name);
      expect(found, q).toEqual(q === '%' ? ['Fifty % Off'] : []);
    }
    expect(dataOf(await ask(admin, peopleQueries.listPeople, { q: 'fifty _ off', page: 1 })).rows).toEqual([]);
  });

  it('shows an owner with people.invite the members of their restaurant, and no one else', async () => {
    // Dee also works at the other restaurant: the owner sees Dee, but not that.
    await run(admin, people.assignDesigner, { userId: dee.userId, restaurantId: bistro.id });
    expect(codeOf(await ask(olive, peopleQueries.listPeople, { restaurantId: atelier.id, page: 1 }))).toBe('FORBIDDEN');

    await grantOwnersInvite(atelier.id);
    const result = dataOf(await ask(olive, peopleQueries.listPeople, { restaurantId: atelier.id, page: 1 }));
    expect(result.rows.map((r) => r.email).sort()).toEqual([dee.email, olive.email].sort());
    expect(result.rows.find((r) => r.email === dee.email)?.memberships).toEqual([{ restaurantId: atelier.id, restaurantName: 'Atelier', role: 'DESIGNER' }]);
    const json = JSON.stringify(result);
    for (const outside of [admin.email, bea.email, 'Bistro', bistro.id]) expect(json).not.toContain(outside);

    // Search cannot reach beyond it either.
    expect(dataOf(await ask(olive, peopleQueries.listPeople, { restaurantId: atelier.id, q: bea.email, page: 1 })).rows).toEqual([]);
    // Nor can naming another restaurant, or none.
    expect(codeOf(await ask(olive, peopleQueries.listPeople, { restaurantId: bistro.id, page: 1 }))).toBe('NOT_FOUND');
    expect(codeOf(await ask(olive, peopleQueries.listPeople, { page: 1 }))).toBe('FORBIDDEN');
    expect(codeOf(await ask(dee, peopleQueries.listPeople, { restaurantId: atelier.id, page: 1 }))).toBe('FORBIDDEN');
    expect(codeOf(await runQuery(prisma(), null, peopleQueries.listPeople, { page: 1 }))).toBe('UNAUTHENTICATED');
  });

  it('lists the invitations by status, and never their tokens', async () => {
    const links: string[] = [];
    const make = async (label: string) => {
      const made = dataOf(await run(admin, people.inviteOwner, { restaurantId: atelier.id, email: address(label) }));
      links.push(made.url);
      return made.invitationId;
    };
    const pending = await make('pending');
    const expired = await make('expired');
    const revoked = await make('revoked');
    const accepted = await make('accepted');
    const madeStaff = dataOf(await run(admin, people.inviteStaff, { email: address('staff'), asSuperAdmin: true }));
    links.push(madeStaff.url);
    const staff = madeStaff.invitationId;
    await prisma().invitation.update({ where: { id: expired }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await prisma().invitation.update({ where: { id: revoked }, data: { revokedAt: new Date() } });
    await prisma().invitation.update({ where: { id: accepted }, data: { acceptedAt: new Date() } });

    const idsOf = async (status: string, who = admin, restaurantId?: string) =>
      dataOf(await ask(who, peopleQueries.listInvitations, { status, page: 1, ...(restaurantId ? { restaurantId } : {}) })).rows.map((r) => r.id).sort();
    expect(await idsOf('pending')).toEqual([pending, staff].sort());
    expect(await idsOf('expired')).toEqual([expired]);
    expect(await idsOf('revoked')).toEqual([revoked]);
    expect(await idsOf('accepted')).toEqual([accepted]);
    expect(await idsOf('all')).toEqual([pending, expired, revoked, accepted, staff].sort());
    expect(await idsOf('all', admin, atelier.id)).toEqual([pending, expired, revoked, accepted].sort());
    expect(await idsOf('all', admin, bistro.id)).toEqual([]);

    const { rows } = dataOf(await ask(admin, peopleQueries.listInvitations, { status: 'all', page: 1 }));
    const staffRow = rows.find((r) => r.id === staff);
    expect(staffRow).toMatchObject({ restaurantId: null, restaurantName: null, role: null, asSuperAdmin: true, status: 'pending', invitedBy: 'admin person' });
    expect(rows.find((r) => r.id === pending)).toMatchObject({ restaurantId: atelier.id, restaurantName: 'Atelier', role: 'OWNER', status: 'pending' });
    expect(rows.map((r) => r.status).sort()).toEqual(['accepted', 'expired', 'pending', 'pending', 'revoked']);
    const json = JSON.stringify(rows);
    for (const row of await prisma().invitation.findMany()) expect(json).not.toContain(row.tokenHash);
    expect(json).not.toMatch(/tokenHash/);
    // Nor the links that were handed out when the invitations were made: a list cannot show them again.
    expect(links).toHaveLength(5);
    for (const link of links) expect(json).not.toContain(tokenOf(link));
    expect(json).not.toContain('/studio/invite/');
  });

  it("limits an owner's invitation list to their restaurant, with no staff invitations", async () => {
    await grantOwnersInvite(atelier.id);
    const mine = dataOf(await run(admin, people.inviteOwner, { restaurantId: atelier.id, email: address('mine') })).invitationId;
    dataOf(await run(admin, people.inviteOwner, { restaurantId: bistro.id, email: address('theirs') }));
    dataOf(await run(admin, people.inviteStaff, { email: address('staff'), asSuperAdmin: false }));

    const ok = dataOf(await ask(olive, peopleQueries.listInvitations, { restaurantId: atelier.id, status: 'all', page: 1 }));
    expect(ok.rows.map((r) => r.id)).toEqual([mine]);
    expect(JSON.stringify(ok)).not.toContain(address('theirs'));
    expect(codeOf(await ask(olive, peopleQueries.listInvitations, { restaurantId: bistro.id, status: 'all', page: 1 }))).toBe('NOT_FOUND');
    expect(codeOf(await ask(olive, peopleQueries.listInvitations, { status: 'all', page: 1 }))).toBe('FORBIDDEN');
    expect(codeOf(await ask(dee, peopleQueries.listInvitations, { restaurantId: atelier.id, status: 'all', page: 1 }))).toBe('FORBIDDEN');
    expect(codeOf(await ask(admin, peopleQueries.listInvitations, { status: 'sometimes', page: 1 }))).toBe('INVALID');
  });

  it("lists a restaurant's members for those who may manage them", async () => {
    await grantOwnersInvite(atelier.id);
    expect(codeOf(await ask(dee, peopleQueries.restaurantMembers, { restaurantId: atelier.id }))).toBe('FORBIDDEN');
    await prisma().user.update({ where: { id: dee.userId }, data: { deactivatedAt: new Date() } });
    const members = dataOf(await ask(olive, peopleQueries.restaurantMembers, { restaurantId: atelier.id }));
    expect(members.map((m) => [m.email, m.role, m.deactivated])).toEqual([
      [olive.email, 'OWNER', false],
      [dee.email, 'DESIGNER', true],
    ]);
    expect(members[0]).toMatchObject({ userId: olive.userId, name: 'olive person' });
    expect(codeOf(await ask(olive, peopleQueries.restaurantMembers, { restaurantId: bistro.id }))).toBe('NOT_FOUND');
    expect(dataOf(await ask(admin, peopleQueries.restaurantMembers, { restaurantId: bistro.id }))).toHaveLength(1);
  });
});
