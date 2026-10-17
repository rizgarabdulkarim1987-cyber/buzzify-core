import { createHash } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import { readDevMail } from '@/server/email/send';
import { renderEmail } from '@/server/email/templates';
import * as people from '@/server/studio/actions/people';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { getAuth } from '@/server/studio/auth/auth';
import { createPasswordUser } from '@/server/studio/auth/users';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import { invokePublic } from '@/server/studio/framework/invoke';
import type { ActionResult } from '@/server/studio/framework/result';
import * as invitationActions from '@/server/studio/public-actions/invitations';
import * as session from '@/server/studio/public-actions/session';
import { createInvitation, inspectInvitation, acceptInvitation, INVITATION_TTL_MS } from '@/server/studio/services/invitations';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { Browser, SESSION_COOKIE } from '../helpers/browser';
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

const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  return result.data;
};
const failureOf = (result: ActionResult<unknown>) => {
  if (result.ok) throw new Error(`expected a failure, got ${JSON.stringify(result.data)}`);
  return result.error;
};
const codeOf = (result: ActionResult<unknown>) => (result.ok ? 'OK' : result.error.code);

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const tokenOf = (url: string) => url.slice(url.lastIndexOf('/') + 1);

interface Person {
  userId: string;
  email: string;
}

async function person(label: string, flags: { superAdmin?: boolean; memberships?: Array<[string, 'DESIGNER' | 'OWNER']> } = {}): Promise<Person> {
  const email = address(label);
  const { userId } = await createPasswordUser(prisma(), { email, name: `${label} person`, password: GOOD, isSuperAdmin: flags.superAdmin });
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

let admin: Person;
let atelier: { id: string; name: string };
let bistro: { id: string; name: string };

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
  atelier = await prisma().restaurant.create({ data: { name: 'Atelier' }, select: { id: true, name: true } });
  bistro = await prisma().restaurant.create({ data: { name: 'Bistro' }, select: { id: true, name: true } });
  admin = await person('admin', { superAdmin: true });
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

/** Invites `email` as an owner of `restaurant` through the action and returns the link from the mail that was sent. */
async function inviteOwnerByMail(email: string, restaurant = atelier) {
  dataOf(await run(admin, people.inviteOwner, { restaurantId: restaurant.id, email }));
  const [mail] = await mailTo(email);
  const url = linkIn((mail as { text: string }).text);
  return { url, token: tokenOf(url) };
}

/** An invitation made by the service, so a test chooses the clock. */
async function invite(
  email: string,
  args: { restaurantId?: string | null; role?: 'OWNER' | 'DESIGNER' | null; asSuperAdmin?: boolean; now?: Date } = {},
) {
  const restaurantId = args.restaurantId === undefined ? atelier.id : args.restaurantId;
  const created = await createInvitation(prisma(), {
    email,
    restaurantId,
    role: args.role === undefined ? (restaurantId === null ? null : 'OWNER') : args.role,
    asSuperAdmin: args.asSuperAdmin ?? false,
    invitedById: admin.userId,
    now: args.now ?? new Date(),
  });
  return { ...created, token: tokenOf(created.url) };
}

describe('creating an invitation', () => {
  it('invites an owner, accepts with a new account and lands a membership', async () => {
    const email = address('olive');
    const { url, token } = await inviteOwnerByMail(`  ${email.toUpperCase()} `);

    // Built on the Studio's origin, with 32 random bytes as the token.
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:3100\/studio\/invite\/[A-Za-z0-9_-]{43}$/);
    const [mail] = await mailTo(email);
    expect(mail?.subject).toBe(renderEmail('invite', 'en', { url }).subject);
    expect(mail?.text).toContain('admin person has invited you');
    expect(mail?.text).toContain('Restaurant: Atelier');
    expect(mail?.text).toContain('Your role: Owner');

    const now = new Date();
    expect(await inspectInvitation(prisma(), token, now)).toEqual({
      status: 'valid',
      email,
      restaurantName: 'Atelier',
      role: 'OWNER',
      accountExists: false,
    });

    const accepted = await acceptInvitation(prisma(), { token, signedInUserId: null, name: ' Olive Owner ', password: GOOD, now });
    const user = await prisma().user.findUniqueOrThrow({ where: { id: accepted.userId } });
    expect(user).toMatchObject({ email, name: 'Olive Owner', isSuperAdmin: false, emailVerified: true });
    expect(await prisma().membership.findMany({ where: { userId: user.id } })).toMatchObject([{ restaurantId: atelier.id, role: 'OWNER' }]);
    expect(await prisma().invitation.findFirstOrThrow()).toMatchObject({ acceptedAt: now, revokedAt: null });

    // The inviter is the actor of the acceptance, and the audit row names the invitation and the restaurant.
    const row = await prisma().auditLog.findFirstOrThrow({ where: { action: 'invitation.accepted' } });
    expect(row).toMatchObject({ actorId: admin.userId, restaurantId: atelier.id, entityType: 'Invitation' });

    // The password works.
    new Browser().activate();
    expect(await invokePublic(session.signIn, { email, password: GOOD })).toMatchObject({ ok: true });
  });

  it('stores only the token hash', async () => {
    const { url, token, invitationId } = await invite(address('olive'));
    const row = await prisma().invitation.findUniqueOrThrow({ where: { id: invitationId } });
    expect(row.tokenHash).toBe(sha256(token));
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    // Nothing in the row, or in anything the Studio wrote about it, is the token.
    expect(JSON.stringify(row)).not.toContain(token);
    expect(JSON.stringify(await prisma().auditLog.findMany())).not.toContain(token);
    expect(url.endsWith(token)).toBe(true);
    // The link is the only copy: the same token, hashed, finds the invitation.
    expect(await prisma().invitation.count({ where: { tokenHash: sha256(token) } })).toBe(1);
  });

  it('expires seven days after it is made, to the second', async () => {
    const created = new Date('2027-03-01T10:00:00.000Z');
    const { token, invitationId } = await invite(address('olive'), { now: created });
    const row = await prisma().invitation.findUniqueOrThrow({ where: { id: invitationId } });
    expect(INVITATION_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(row.expiresAt.toISOString()).toBe('2027-03-08T10:00:00.000Z');
    expect((await inspectInvitation(prisma(), token, new Date('2027-03-08T09:59:59.999Z'))).status).toBe('valid');
    expect((await inspectInvitation(prisma(), token, new Date('2027-03-08T10:00:00.000Z'))).status).toBe('expired');
  });

  it("writes the mail in the inviter's Studio language", async () => {
    await prisma().user.update({ where: { id: admin.userId }, data: { locale: 'ar' } });
    const email = address('olive');
    const { url } = await inviteOwnerByMail(email);
    const [mail] = await mailTo(email);
    const expected = renderEmail('invite', 'ar', { url, inviter: 'admin person', restaurant: 'Atelier', role: 'OWNER' });
    expect(mail?.subject).toBe(expected.subject);
    expect(mail?.html).toContain('lang="ar"');
    // The role too: in Arabic, not in English.
    expect(mail?.text).toBe(expected.text);
    expect(mail?.text).toContain('دورك: ⁨مالك⁩');
    expect(mail?.text).not.toMatch(/Owner/);

    // The new account starts in the same language, so the Studio matches the mail that brought the person to it.
    const { userId } = await acceptInvitation(prisma(), { token: tokenOf(url), signedInUserId: null, name: 'Olive', password: GOOD, now: new Date() });
    expect((await prisma().user.findUniqueOrThrow({ where: { id: userId } })).locale).toBe('ar');
  });

  it('names the role in Sorani in a Sorani mail, for a Super Admin invitation too', async () => {
    await prisma().user.update({ where: { id: admin.userId }, data: { locale: 'ckb' } });
    const email = address('root');
    dataOf(await run(admin, people.inviteStaff, { email, asSuperAdmin: true }));
    const [mail] = await mailTo(email);
    expect(mail?.html).toContain('lang="ckb"');
    expect(mail?.text).toContain('بەڕێوەبەری باڵا');
    expect(mail?.text).not.toMatch(/Super Admin|Owner|Designer/);
  });

  it('treats invitation emails case-insensitively', async () => {
    const existing = await person('olive');
    const { token, invitationId } = await invite(` ${existing.email.toUpperCase()} `);
    expect((await prisma().invitation.findUniqueOrThrow({ where: { id: invitationId } })).email).toBe(existing.email);
    expect(await inspectInvitation(prisma(), token, new Date())).toMatchObject({ status: 'valid', email: existing.email, accountExists: true });
    await acceptInvitation(prisma(), { token, signedInUserId: existing.userId, now: new Date() });
    expect(await prisma().membership.count({ where: { userId: existing.userId, restaurantId: atelier.id } })).toBe(1);
  });

  it('refuses an invitation that names a restaurant without a role, or a Super Admin of a restaurant', async () => {
    const base = { email: address('olive'), invitedById: admin.userId, now: new Date() };
    await expect(createInvitation(prisma(), { ...base, restaurantId: atelier.id, role: null, asSuperAdmin: false })).rejects.toThrow();
    await expect(createInvitation(prisma(), { ...base, restaurantId: null, role: 'OWNER', asSuperAdmin: false })).rejects.toThrow();
    await expect(createInvitation(prisma(), { ...base, restaurantId: atelier.id, role: 'OWNER', asSuperAdmin: true })).rejects.toThrow();
    expect(await prisma().invitation.count()).toBe(0);
  });

  it('refuses a restaurant that does not exist, and an inviter who is deactivated', async () => {
    const base = { email: address('olive'), role: 'OWNER' as const, asSuperAdmin: false, invitedById: admin.userId, now: new Date() };
    await expect(createInvitation(prisma(), { ...base, restaurantId: 'no-such-restaurant' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const gone = await person('gone', { superAdmin: true });
    await prisma().user.update({ where: { id: gone.userId }, data: { deactivatedAt: new Date() } });
    await expect(createInvitation(prisma(), { ...base, restaurantId: atelier.id, invitedById: gone.userId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('leaves the mail to afterCommit when it is given one, so a rolled-back invitation sends nothing', async () => {
    const email = address('olive');
    const later: Array<() => void> = [];
    await createInvitation(
      prisma(),
      { email, restaurantId: atelier.id, role: 'OWNER', asSuperAdmin: false, invitedById: admin.userId, now: new Date() },
      { afterCommit: (fn) => later.push(fn) },
    );
    await quiet();
    expect(later).toHaveLength(1);
    await expect(readDevMail(email)).resolves.toHaveLength(0);
    later[0]?.();
    await mailTo(email);
  });
});

describe('inspecting an invitation', () => {
  it('describes a staff invitation and a Super Admin invitation', async () => {
    const designer = await invite(address('dee'), { restaurantId: null, role: null });
    const owner = await invite(address('sam'), { restaurantId: null, role: null, asSuperAdmin: true });
    expect(await inspectInvitation(prisma(), designer.token, new Date())).toMatchObject({ status: 'valid', role: 'DESIGNER_STAFF', accountExists: false });
    const inspected = await inspectInvitation(prisma(), owner.token, new Date());
    expect(inspected).toMatchObject({ status: 'valid', role: 'SUPER_ADMIN' });
    expect(inspected.restaurantName).toBeUndefined();
  });

  it('says only the status for a token that cannot be used', async () => {
    const { token } = await invite(address('olive'), { now: new Date('2020-01-01T00:00:00Z') });
    expect(await inspectInvitation(prisma(), token, new Date())).toEqual({ status: 'expired' });
    expect(await inspectInvitation(prisma(), 'no-such-token', new Date())).toEqual({ status: 'unknown' });
    expect(await inspectInvitation(prisma(), '', new Date())).toEqual({ status: 'unknown' });
  });

  it('reads an invitation as revoked when its inviter or its addressee has been deactivated', async () => {
    const owner = await person('olive');
    const toOwner = await invite(owner.email);
    await prisma().user.update({ where: { id: owner.userId }, data: { deactivatedAt: new Date() } });
    expect(await inspectInvitation(prisma(), toOwner.token, new Date())).toEqual({ status: 'revoked' });

    const other = await person('other', { superAdmin: true });
    const byOther = await createInvitation(prisma(), {
      email: address('fresh'),
      restaurantId: atelier.id,
      role: 'OWNER',
      asSuperAdmin: false,
      invitedById: other.userId,
      now: new Date(),
    });
    await prisma().user.update({ where: { id: other.userId }, data: { deactivatedAt: new Date() } });
    expect(await inspectInvitation(prisma(), tokenOf(byOther.url), new Date())).toEqual({ status: 'revoked' });
  });
});

describe('accepting an invitation', () => {
  it('refuses an expired, revoked or already used token', async () => {
    const t0 = new Date('2027-03-01T10:00:00.000Z');
    const expired = await invite(address('a'), { now: t0 });
    const revoked = await invite(address('b'));
    const used = await invite(address('c'));
    dataOf(await run(admin, people.revokeInvitation, { invitationId: revoked.invitationId, restaurantId: atelier.id }));
    await acceptInvitation(prisma(), { token: used.token, signedInUserId: null, name: 'Cee', password: GOOD, now: new Date() });

    const attempt = (token: string, now = new Date()) => acceptInvitation(prisma(), { token, signedInUserId: null, name: 'Zed', password: GOOD, now });
    await expect(attempt(expired.token, new Date(t0.getTime() + INVITATION_TTL_MS))).rejects.toMatchObject({ code: 'INVALID', fields: { token: expect.stringContaining('expired') } });
    await expect(attempt(revoked.token)).rejects.toMatchObject({ code: 'INVALID' });
    await expect(attempt(used.token)).rejects.toMatchObject({ code: 'INVALID', fields: { token: expect.stringContaining('already used') } });
    await expect(attempt('no-such-token')).rejects.toMatchObject({ code: 'INVALID' });

    // None of them made an account or a membership.
    expect(await prisma().user.count({ where: { email: { in: [address('a'), address('b')] } } })).toBe(0);
    expect(await prisma().membership.count()).toBe(1);
  });

  it('refuses to attach the invitation to a different signed-in account', async () => {
    const owner = await person('olive');
    const otherUser = await person('other');
    const { token } = await invite(owner.email);
    const now = new Date();

    await expect(acceptInvitation(prisma(), { token, signedInUserId: otherUser.userId, now })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'This invitation is for another account. Sign out and open the link again.',
    });
    expect(await prisma().membership.count({ where: { userId: otherUser.userId } })).toBe(0);
    expect(await prisma().membership.count({ where: { userId: owner.userId } })).toBe(0);

    // Not signed in at all is no better: the account exists, so the person has to sign in as it.
    await expect(acceptInvitation(prisma(), { token, signedInUserId: null, now })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await prisma().invitation.findFirstOrThrow()).toMatchObject({ acceptedAt: null });
  });

  it('adds a second restaurant to an existing owner who is signed in', async () => {
    const owner = await person('olive', { memberships: [[atelier.id, 'OWNER']] });
    const { token } = await invite(owner.email, { restaurantId: bistro.id });
    const accepted = await acceptInvitation(prisma(), { token, signedInUserId: owner.userId, now: new Date() });
    expect(accepted.userId).toBe(owner.userId);
    const memberships = await prisma().membership.findMany({ where: { userId: owner.userId }, orderBy: { createdAt: 'asc' } });
    expect(memberships.map((m) => [m.restaurantId, m.role])).toEqual([
      [atelier.id, 'OWNER'],
      [bistro.id, 'OWNER'],
    ]);
    // Still one account, with its own password untouched.
    expect(await prisma().user.count({ where: { email: owner.email } })).toBe(1);
  });

  it('makes a designer an owner of the restaurant, and never makes an owner a designer', async () => {
    const designer = await person('dee', { memberships: [[atelier.id, 'DESIGNER']] });
    const upgrade = await invite(designer.email);
    await acceptInvitation(prisma(), { token: upgrade.token, signedInUserId: designer.userId, now: new Date() });
    expect(await prisma().membership.findFirstOrThrow({ where: { userId: designer.userId } })).toMatchObject({ role: 'OWNER' });

    // Made an owner after the designer invitation went out: accepting it does not take that away.
    const owner = await person('olive');
    const stale = await invite(owner.email, { role: 'DESIGNER' });
    await prisma().membership.create({ data: { userId: owner.userId, restaurantId: atelier.id, role: 'OWNER' } });
    await acceptInvitation(prisma(), { token: stale.token, signedInUserId: owner.userId, now: new Date() });
    expect(await prisma().membership.findFirstOrThrow({ where: { userId: owner.userId } })).toMatchObject({ role: 'OWNER' });
    expect(await prisma().membership.count({ where: { restaurantId: atelier.id } })).toBe(2);
  });

  it('turns a staff invitation into a Super Admin, or into an account with no restaurants', async () => {
    const asAdmin = await invite(address('sam'), { restaurantId: null, role: null, asSuperAdmin: true });
    const asStaff = await invite(address('dee'), { restaurantId: null, role: null, asSuperAdmin: false });
    const sam = await acceptInvitation(prisma(), { token: asAdmin.token, signedInUserId: null, name: 'Sam', password: GOOD, now: new Date() });
    const dee = await acceptInvitation(prisma(), { token: asStaff.token, signedInUserId: null, name: 'Dee', password: GOOD, now: new Date() });
    expect(await prisma().user.findUniqueOrThrow({ where: { id: sam.userId } })).toMatchObject({ isSuperAdmin: true, twoFactorEnabled: false });
    expect(await prisma().user.findUniqueOrThrow({ where: { id: dee.userId } })).toMatchObject({ isSuperAdmin: false });
    expect(await prisma().membership.count()).toBe(0);
  });

  it('makes an existing account a Super Admin only when it is signed in as that account', async () => {
    const dee = await person('dee');
    const { token } = await invite(dee.email, { restaurantId: null, role: null, asSuperAdmin: true });
    await expect(acceptInvitation(prisma(), { token, signedInUserId: admin.userId, now: new Date() })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await prisma().user.findUniqueOrThrow({ where: { id: dee.userId } })).isSuperAdmin).toBe(false);
    await acceptInvitation(prisma(), { token, signedInUserId: dee.userId, now: new Date() });
    expect((await prisma().user.findUniqueOrThrow({ where: { id: dee.userId } })).isSuperAdmin).toBe(true);
  });

  it('refuses a deactivated account with the answer every unusable invitation gets', async () => {
    const owner = await person('olive');
    const { token } = await invite(owner.email);
    await prisma().user.update({ where: { id: owner.userId }, data: { deactivatedAt: new Date() } });
    const refused = await acceptInvitation(prisma(), { token, signedInUserId: owner.userId, now: new Date() }).catch((e: unknown) => e);
    expect(refused).toMatchObject({ code: 'INVALID', fields: { token: expect.any(String) } });
    expect((refused as Error).message).not.toMatch(/deactivat|disabled|account/i);
    expect(await prisma().membership.count()).toBe(0);
  });

  it('refuses an invitation whose inviter has been deactivated since', async () => {
    const { token } = await invite(address('olive'));
    await prisma().user.update({ where: { id: admin.userId }, data: { deactivatedAt: new Date() } });
    await expect(acceptInvitation(prisma(), { token, signedInUserId: null, name: 'Olive', password: GOOD, now: new Date() })).rejects.toMatchObject({
      code: 'INVALID',
    });
    expect(await prisma().user.count({ where: { email: address('olive') } })).toBe(0);
  });

  it('asks a new person for a name and an acceptable password without using up the token', async () => {
    const { token } = await invite(address('olive'));
    const now = new Date();
    await expect(acceptInvitation(prisma(), { token, signedInUserId: null, now })).rejects.toMatchObject({
      code: 'INVALID',
      fields: { name: expect.any(String), password: expect.any(String) },
    });
    await expect(acceptInvitation(prisma(), { token, signedInUserId: null, name: '   ', password: GOOD, now })).rejects.toMatchObject({
      fields: { name: expect.any(String) },
    });
    await expect(acceptInvitation(prisma(), { token, signedInUserId: null, name: 'Olive', password: 'short', now })).rejects.toMatchObject({
      code: 'INVALID',
      fields: { password: 'Use at least 12 characters' },
    });
    await expect(acceptInvitation(prisma(), { token, signedInUserId: null, name: 'Olive', password: 'password1234', now })).rejects.toMatchObject({
      fields: { password: expect.stringContaining('too common') },
    });
    expect(await prisma().user.count({ where: { email: address('olive') } })).toBe(0);
    expect(await prisma().invitation.findFirstOrThrow()).toMatchObject({ acceptedAt: null });
    await expect(acceptInvitation(prisma(), { token, signedInUserId: null, name: 'Olive', password: GOOD, now })).resolves.toMatchObject({ userId: expect.any(String) });
  });

  it('lets exactly one of two simultaneous acceptances through', async () => {
    const { token } = await invite(address('olive'));
    const attempt = (name: string) => acceptInvitation(prisma(), { token, signedInUserId: null, name, password: GOOD, now: new Date() });
    const settled = await Promise.allSettled([attempt('First'), attempt('Second')]);
    expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
    expect(settled.filter((s) => s.status === 'rejected')).toHaveLength(1);
    expect(await prisma().user.count({ where: { email: address('olive') } })).toBe(1);
    expect(await prisma().membership.count({ where: { restaurantId: atelier.id } })).toBe(1);
    expect(await prisma().auditLog.count({ where: { action: 'invitation.accepted' } })).toBe(1);
  });

  it('does not leave an account behind when the acceptance itself fails', async () => {
    const { token, invitationId } = await invite(address('olive'));
    // The account is made first and the claim second, so a failure of the second has to take the first back.
    const spy = vi.spyOn(prisma(), '$transaction').mockImplementationOnce((async () => {
      expect(await prisma().user.count({ where: { email: address('olive') } })).toBe(1);
      throw new Error('boom');
    }) as never);
    await expect(acceptInvitation(prisma(), { token, signedInUserId: null, name: 'Olive', password: GOOD, now: new Date() })).rejects.toThrow('boom');
    spy.mockRestore();
    expect(await prisma().user.count({ where: { email: address('olive') } })).toBe(0);
    expect(await prisma().invitation.findUniqueOrThrow({ where: { id: invitationId } })).toMatchObject({ acceptedAt: null });
  });

  it('records the request on the audit row, and nothing secret', async () => {
    const { token } = await invite(address('olive'));
    await acceptInvitation(prisma(), {
      token,
      signedInUserId: null,
      name: 'Olive',
      password: GOOD,
      now: new Date(),
      meta: { ip: '198.51.100.9', userAgent: 'Mozilla/5.0 (accept test)' },
    });
    const row = await prisma().auditLog.findFirstOrThrow({ where: { action: 'invitation.accepted' } });
    expect(row).toMatchObject({ ip: '198.51.100.9', userAgent: 'Mozilla/5.0 (accept test)' });
    const json = JSON.stringify(row);
    expect(json).not.toContain(token);
    expect(json).not.toContain(sha256(token));
    expect(json).not.toContain(GOOD);
  });
});

describe('the public actions', () => {
  it('shows an invitation to someone who is not signed in', async () => {
    const email = address('olive');
    const { token } = await inviteOwnerByMail(email);
    expect(await invokePublic(invitationActions.getInvitation, { token })).toEqual({
      ok: true,
      data: { status: 'valid', email, restaurantName: 'Atelier', role: 'OWNER', accountExists: false },
    });
    expect(await invokePublic(invitationActions.getInvitation, { token: 'no-such-token' })).toEqual({ ok: true, data: { status: 'unknown' } });
    expect(codeOf(await invokePublic(invitationActions.getInvitation, { token: '' }))).toBe('INVALID');
    expect(codeOf(await invokePublic(invitationActions.getInvitation, {}))).toBe('INVALID');
  });

  it('accepts as a new person, signs them in and says where to go', async () => {
    const email = address('olive');
    const { token } = await inviteOwnerByMail(email);
    const browser = new Browser().activate();
    const result = await invokePublic(invitationActions.acceptInvitationAction, { token, name: 'Olive Owner', password: GOOD });
    expect(result).toEqual({ ok: true, data: { next: '/studio' } });
    expect(browser.has(SESSION_COOKIE)).toBe(true);
    expect((await getAuth().api.getSession({ headers: browser.requestHeaders() }))?.user.email).toBe(email);
    expect(await prisma().membership.count({ where: { restaurantId: atelier.id } })).toBe(1);
    // The link is spent.
    expect(failureOf(await invokePublic(invitationActions.acceptInvitationAction, { token, name: 'Olive Owner', password: GOOD })).code).toBe('INVALID');
  });

  it('accepts as the signed-in owner of an existing account, and refuses anyone else', async () => {
    const owner = await person('olive', { memberships: [[atelier.id, 'OWNER']] });
    const stranger = await person('stranger');
    const { token } = await inviteOwnerByMail(owner.email, bistro);

    const strangerBrowser = new Browser('198.51.100.20', 'stranger').activate();
    expect(await invokePublic(session.signIn, { email: stranger.email, password: GOOD })).toMatchObject({ ok: true });
    const refused = failureOf(await invokePublic(invitationActions.acceptInvitationAction, { token }));
    expect(refused).toMatchObject({ code: 'FORBIDDEN', message: 'This invitation is for another account. Sign out and open the link again.' });
    expect(strangerBrowser.has(SESSION_COOKIE)).toBe(true);

    const ownerBrowser = new Browser('198.51.100.21', 'owner').activate();
    expect(await invokePublic(session.signIn, { email: owner.email, password: GOOD })).toMatchObject({ ok: true });
    expect(await invokePublic(invitationActions.acceptInvitationAction, { token })).toEqual({ ok: true, data: { next: '/studio' } });
    expect(ownerBrowser.has(SESSION_COOKIE)).toBe(true);
    expect(await prisma().membership.count({ where: { userId: owner.userId } })).toBe(2);
  });

  it('reports a weak password as a problem with the password field', async () => {
    const { token } = await inviteOwnerByMail(address('olive'));
    const result = failureOf(await invokePublic(invitationActions.acceptInvitationAction, { token, name: 'Olive', password: 'short' }));
    expect(result).toMatchObject({ code: 'INVALID', fields: { password: 'Use at least 12 characters' } });
    expect(await prisma().user.count({ where: { email: address('olive') } })).toBe(0);
  });

  it('counts both against the invitation limit of the address', async () => {
    const browser = new Browser('198.51.100.30', 'prober').activate();
    for (let i = 0; i < 10; i += 1) expect(codeOf(await invokePublic(invitationActions.getInvitation, { token: `guess-${i}` }))).toBe('OK');
    for (let i = 0; i < 10; i += 1) {
      expect(codeOf(await invokePublic(invitationActions.acceptInvitationAction, { token: `guess-${i}`, name: 'X', password: GOOD }))).toBe('INVALID');
    }
    expect(await prisma().authRateLimit.findUniqueOrThrow({ where: { key: 'invite:ip:198.51.100.30' } })).toMatchObject({ count: 20 });
    const refused = failureOf(await invokePublic(invitationActions.getInvitation, { token: 'guess-last' }));
    expect(refused.code).toBe('RATE_LIMITED');
    expect(browser.has(SESSION_COOKIE)).toBe(false);
    // Another address is not affected.
    new Browser('198.51.100.31', 'someone else').activate();
    expect(codeOf(await invokePublic(invitationActions.getInvitation, { token: 'guess-0' }))).toBe('OK');
  });

  it('also limits the attempts to accept one invitation, from whatever address they come, and stores no token', async () => {
    const { token } = await inviteOwnerByMail(address('olive'));
    // Ten refused attempts, each from its own address, so no address limit is reached.
    for (let i = 0; i < 10; i += 1) {
      new Browser(`198.51.100.${100 + i}`, 'prober').activate();
      expect(codeOf(await invokePublic(invitationActions.acceptInvitationAction, { token, name: 'Olive', password: 'short' }))).toBe('INVALID');
    }
    new Browser('198.51.100.120', 'prober').activate();
    const refused = failureOf(await invokePublic(invitationActions.acceptInvitationAction, { token, name: 'Olive', password: GOOD }));
    expect(refused).toMatchObject({ code: 'RATE_LIMITED', fields: { retryAfterSec: expect.stringMatching(/^\d+$/) } });
    expect(await prisma().user.count({ where: { email: address('olive') } })).toBe(0);

    // The counter is keyed by the token's hash; neither the token nor anything that opens the invitation is stored.
    const keys = (await prisma().authRateLimit.findMany({ select: { key: true } })).map((row) => row.key);
    expect(keys).toContain(`invite:token:${sha256(token)}`);
    expect(JSON.stringify(keys)).not.toContain(token);
    // Another invitation is not affected, and opening the link is not limited by it.
    const other = await inviteOwnerByMail(address('bea'));
    expect(codeOf(await invokePublic(invitationActions.acceptInvitationAction, { token: other.token, name: 'Bea', password: GOOD }))).toBe('OK');
    expect(codeOf(await invokePublic(invitationActions.getInvitation, { token }))).toBe('OK');
  });

  it('falls back to the sign-in page when the new person cannot be signed in', async () => {
    const email = address('olive');
    const { token } = await inviteOwnerByMail(email);
    const signIn = vi.spyOn(getAuth().api, 'signInEmail').mockRejectedValueOnce(new Error('down'));
    const result = await invokePublic(invitationActions.acceptInvitationAction, { token, name: 'Olive', password: GOOD });
    signIn.mockRestore();
    expect(result).toEqual({ ok: true, data: { next: '/studio/sign-in' } });
    expect(await prisma().membership.count({ where: { restaurantId: atelier.id } })).toBe(1);
  });
});
