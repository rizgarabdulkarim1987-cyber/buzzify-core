import { createHash, randomBytes } from 'node:crypto';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { isLocale } from '@/lib/locale';
import { delegates, type AnyDb, type ScopedDb } from '@/server/data/tenant-db';
import type { MemberRole } from '@/server/domain/permissions';
import type { InvitedRole } from '@/server/email/templates';
import { authEnv } from '@/server/env';
import { bumpRetailState, kickAfterCommit } from '@/server/retail/outbox';
import { sendAfterResponse } from '@/server/studio/auth/auth';
import { checkPasswordPolicy, PasswordPolicyError, passwordProblemMessage } from '@/server/studio/auth/password-policy';
import { createPasswordUser, EmailTakenError, normalizeEmail } from '@/server/studio/auth/users';
import { StudioError } from '@/server/studio/framework/result';
import { TILL_ACCOUNT } from '@/server/studio/services/people';

/**
 * Invitations: the only way to get an account. An invitation is a row and a link. The link carries a token of 32 random
 * bytes; only its SHA-256 is stored, so a copy of the table opens nothing, and the token is never logged, audited or
 * handed back to the person who sent it (they could accept it themselves). It lives for seven days and is used once.
 */

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const MAX_NAME_LENGTH = 120;

export type InvitationStatus = 'valid' | 'expired' | 'used' | 'revoked' | 'unknown';

/**
 * What accepting grants: a role in a restaurant, Super Admin, or an account with no restaurants (staff to assign later).
 * The mail names it in its own language (`renderEmail`).
 */
export type InvitationRole = InvitedRole;

function roleOf(row: { asSuperAdmin: boolean; role: MemberRole | null }): InvitationRole {
  if (row.asSuperAdmin) return 'SUPER_ADMIN';
  return row.role ?? 'DESIGNER_STAFF';
}

/** The token's SHA-256 in hex: what the table stores, and what a token is looked up by. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const newToken = (): string => randomBytes(32).toString('base64url');

/** The link in the mail: the Studio's own origin, as configured for sign-in. */
function invitationUrl(token: string): string {
  return `${authEnv().baseUrl}/studio/invite/${token}`;
}

function invalidEmail(message: string): StudioError {
  return new StudioError('INVALID', message, { email: message });
}

// Creating ------------------------------------------------------------------------------------------------------------

export interface NewInvitation {
  email: string;
  /** The restaurant an owner or designer invitation is for; null for staff. */
  restaurantId: string | null;
  /** The role it creates there: set exactly when `restaurantId` is. */
  role: MemberRole | null;
  /** A staff invitation that makes the person a Super Admin. */
  asSuperAdmin: boolean;
  invitedById: string;
  now: Date;
}

export interface InvitationOptions {
  /**
   * Where the mail is queued. An action passes `ctx.afterCommit`, so a rolled-back invitation sends nothing and a link is
   * never mailed before the row it opens exists. Without it the mail goes at once, for callers with no transaction.
   */
  afterCommit?: (fn: () => void) => void;
}

/** The mail for one invitation, in the language of the person who sent it (the invited person has no account to ask). */
function queueMail(
  options: InvitationOptions,
  mail: { email: string; url: string; inviter: { name: string; locale: string }; restaurantName: string | null; role: InvitationRole },
): void {
  const send = () =>
    sendAfterResponse({ email: mail.email, name: '', locale: mail.inviter.locale }, 'invite', {
      url: mail.url,
      inviter: mail.inviter.name,
      ...(mail.restaurantName ? { restaurant: mail.restaurantName } : {}),
      role: mail.role,
    });
  (options.afterCommit ?? ((fn) => fn()))(send);
}

/**
 * Makes an invitation and mails its link. Run it on the transaction of the action that sends it. Refuses what could
 * never work or would do nothing: a restaurant without a role, a Super Admin of a restaurant, a restaurant that does not
 * exist (in a restaurant's client, any other), an inviter who is deactivated, a person who already has this access, and
 * a second invitation for something that is still pending.
 */
export function createInvitation(db: AnyDb, args: NewInvitation, options?: InvitationOptions): Promise<{ invitationId: string; url: string }>;
export function createInvitation(db: ScopedDb, args: NewInvitation, options?: InvitationOptions): Promise<{ invitationId: string; url: string }>;
export async function createInvitation(
  db: AnyDb | ScopedDb,
  args: NewInvitation,
  options: InvitationOptions = {},
): Promise<{ invitationId: string; url: string }> {
  const d = delegates(db);
  const email = normalizeEmail(args.email);
  const { restaurantId, role, asSuperAdmin } = args;
  if ((restaurantId === null) !== (role === null)) throw new Error('An invitation names a restaurant and a role together, or neither');
  if (asSuperAdmin && restaurantId !== null) throw new Error('A Super Admin invitation is not for a restaurant');

  const inviter = await d.user.findUnique({ where: { id: args.invitedById }, select: { name: true, locale: true, deactivatedAt: true } });
  if (!inviter || inviter.deactivatedAt) throw new StudioError('FORBIDDEN');
  let restaurantName: string | null = null;
  if (restaurantId !== null) {
    const restaurant = await d.restaurant.findUnique({ where: { id: restaurantId }, select: { name: true } });
    if (!restaurant) throw new StudioError('NOT_FOUND');
    restaurantName = restaurant.name;
  }

  // What the address already has. These answers are about the restaurant the inviter manages, or reach Super Admins only,
  // who see every account anyway: they say nothing about an account elsewhere.
  const existing = await d.user.findUnique({ where: { email }, select: { id: true, isSuperAdmin: true } });
  if (existing) {
    if (asSuperAdmin && existing.isSuperAdmin) throw invalidEmail('This person is already a Super Admin');
    if (restaurantId === null && !asSuperAdmin) {
      throw invalidEmail('This person already has an account. Assign them to a client instead');
    }
    if (restaurantId !== null) {
      if (await d.posStaff.findFirst({ where: { userId: existing.id }, select: { id: true } })) throw invalidEmail(TILL_ACCOUNT);
      const membership = await d.membership.findUnique({
        where: { userId_restaurantId: { userId: existing.id, restaurantId } },
        select: { role: true },
      });
      // A designer can be made an owner; nobody is invited to what they have, or to less.
      if (membership && (membership.role === 'OWNER' || membership.role === role)) {
        throw invalidEmail('This person already has access to this restaurant');
      }
    }
  }
  const pending = await d.invitation.findFirst({
    where: { email, restaurantId, asSuperAdmin, acceptedAt: null, revokedAt: null, expiresAt: { gt: args.now } },
    select: { id: true },
  });
  if (pending) {
    throw new StudioError('CONFLICT', 'This address already has a pending invitation. Resend it instead', {
      email: 'This address already has a pending invitation. Resend it instead',
    });
  }

  const token = newToken();
  const created = await d.invitation.create({
    data: {
      email,
      restaurantId,
      role,
      asSuperAdmin,
      tokenHash: hashToken(token),
      expiresAt: new Date(args.now.getTime() + INVITATION_TTL_MS),
      invitedById: args.invitedById,
    },
    select: { id: true },
  });
  const url = invitationUrl(token);
  queueMail(options, { email, url, inviter, restaurantName, role: roleOf({ asSuperAdmin, role }) });
  return { invitationId: created.id, url };
}

// Changing a pending one ----------------------------------------------------------------------------------------------

/** What can be done to an invitation that has not been used or withdrawn: nothing else is open to change. */
const OPEN = { acceptedAt: null, revokedAt: null } as const;

function changedUnderfoot(): StudioError {
  return new StudioError('CONFLICT', 'This invitation was used or withdrawn in the meantime');
}

/** Withdraws an invitation that has not been used. An expired one may be withdrawn too: it only makes the state plain. */
export function revokeInvitation(db: AnyDb, args: { invitationId: string; now: Date }): Promise<void>;
export function revokeInvitation(db: ScopedDb, args: { invitationId: string; now: Date }): Promise<void>;
export async function revokeInvitation(db: AnyDb | ScopedDb, args: { invitationId: string; now: Date }): Promise<void> {
  const { count } = await delegates(db).invitation.updateMany({ where: { id: args.invitationId, ...OPEN }, data: { revokedAt: args.now } });
  if (count === 0) throw changedUnderfoot();
}

interface ReissuedInvitation {
  invitationId: string;
  url: string;
  expiresAt: Date;
  previousExpiresAt: Date;
}

/**
 * Gives an invitation that has not been used a new token and a new seven days, and mails the new link. The old link stops
 * working at once. An expired invitation is the usual case; a used or withdrawn one is refused. Returns the new link for
 * the person who asked for it (it is not stored anywhere, so this is the only time it can be shown).
 */
export function reissueInvitation(
  db: AnyDb,
  args: { invitationId: string; now: Date },
  options?: InvitationOptions,
): Promise<ReissuedInvitation>;
export function reissueInvitation(
  db: ScopedDb,
  args: { invitationId: string; now: Date },
  options?: InvitationOptions,
): Promise<ReissuedInvitation>;
export async function reissueInvitation(
  db: AnyDb | ScopedDb,
  args: { invitationId: string; now: Date },
  options: InvitationOptions = {},
): Promise<ReissuedInvitation> {
  const d = delegates(db);
  const row = await d.invitation.findUnique({
    where: { id: args.invitationId },
    include: { restaurant: { select: { name: true } }, invitedBy: { select: { name: true, locale: true } } },
  });
  if (!row || row.acceptedAt || row.revokedAt) throw changedUnderfoot();

  const token = newToken();
  const expiresAt = new Date(args.now.getTime() + INVITATION_TTL_MS);
  // Only while it is still open: a use or a withdrawal that came in between wins.
  const { count } = await d.invitation.updateMany({ where: { id: row.id, ...OPEN }, data: { tokenHash: hashToken(token), expiresAt } });
  if (count === 0) throw changedUnderfoot();
  const url = invitationUrl(token);
  queueMail(options, { email: row.email, url, inviter: row.invitedBy, restaurantName: row.restaurant?.name ?? null, role: roleOf(row) });
  return { invitationId: row.id, url, expiresAt, previousExpiresAt: row.expiresAt };
}

// Reading -------------------------------------------------------------------------------------------------------------

interface Judged {
  acceptedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
  asSuperAdmin: boolean;
  invitedBy: { deactivatedAt: Date | null; isSuperAdmin: boolean };
}

/**
 * Whether an invitation can still be used. One that was not withdrawn is read as withdrawn when its sender has been
 * deactivated (or, for a Super Admin invitation, is no longer a Super Admin), or when the person it is for has: nobody
 * is let in on the word of someone who may no longer give it, and a deactivated account is turned away with the same
 * answer as any other invitation that is no longer valid.
 */
function statusOf(row: Judged, addressee: { deactivatedAt: Date | null } | null, now: Date): InvitationStatus {
  if (row.acceptedAt) return 'used';
  if (row.revokedAt || row.invitedBy.deactivatedAt || addressee?.deactivatedAt) return 'revoked';
  if (row.asSuperAdmin && !row.invitedBy.isSuperAdmin) return 'revoked';
  if (row.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'valid';
}

async function findByToken(prisma: PrismaClient, token: string) {
  return prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      restaurant: { select: { name: true } },
      invitedBy: { select: { deactivatedAt: true, isSuperAdmin: true, locale: true } },
    },
  });
}

const ADDRESSEE = { id: true, deactivatedAt: true, isSuperAdmin: true } as const;

export interface InvitationView {
  status: InvitationStatus;
  email?: string;
  restaurantName?: string;
  role?: InvitationRole;
  accountExists?: boolean;
}

/**
 * What the invitation page shows for a token. A token that cannot be used gets its status and nothing else; one that can
 * gets what the person needs to decide: the address, the restaurant, the role, and whether the address already has an
 * account (to sign in to, instead of making a password).
 */
export async function inspectInvitation(prisma: PrismaClient, token: string, now: Date): Promise<InvitationView> {
  const row = await findByToken(prisma, token);
  if (!row) return { status: 'unknown' };
  const addressee = await prisma.user.findUnique({ where: { email: row.email }, select: ADDRESSEE });
  const status = statusOf(row, addressee, now);
  if (status !== 'valid') return { status };
  return {
    status,
    email: row.email,
    ...(row.restaurant ? { restaurantName: row.restaurant.name } : {}),
    role: roleOf(row),
    accountExists: addressee !== null,
  };
}

// Accepting -----------------------------------------------------------------------------------------------------------

const REFUSALS: Record<Exclude<InvitationStatus, 'valid'>, string> = {
  expired: 'This invitation has expired. Ask for a new one',
  used: 'This invitation was already used',
  revoked: 'This invitation is no longer valid',
  unknown: 'This invitation link is not valid',
};

function refusal(status: Exclude<InvitationStatus, 'valid'>): StudioError {
  return new StudioError('INVALID', REFUSALS[status], { token: REFUSALS[status] });
}

export interface AcceptArgs {
  token: string;
  /** Who is signed in to the browser that opened the link, or null. */
  signedInUserId: string | null;
  /** For an address with no account: what to call the person, and the password they choose. */
  name?: string;
  password?: string;
  now: Date;
  /** The request, for the audit log. */
  meta?: { ip: string; userAgent: string };
}

/**
 * Uses an invitation.
 *
 * An address with no account gets one, from `name` and `password` (both required; the password must meet the policy,
 * checked before anything is changed so a weak one does not use up the invitation). This signs nobody in. An address
 * with an account needs `signedInUserId` to be that account: an invitation is never attached to whoever happens to be
 * signed in, and nothing is changed otherwise.
 *
 * The invitation is claimed with one conditional update inside the transaction that adds the membership (or the
 * Super Admin flag) and writes the audit row, with the inviter as the actor, so two requests cannot both use it. The
 * account of a new person is made before that and removed again if the transaction fails.
 */
export async function acceptInvitation(
  prisma: PrismaClient,
  args: AcceptArgs,
): Promise<{ userId: string; email: string; createdAccount: boolean }> {
  const row = await findByToken(prisma, args.token);
  if (!row) throw refusal('unknown');
  const addressee = await prisma.user.findUnique({ where: { email: row.email }, select: ADDRESSEE });
  const status = statusOf(row, addressee, args.now);
  if (status !== 'valid') throw refusal(status);

  let userId: string;
  let createdAccount = false;
  if (addressee) {
    if (args.signedInUserId === null) {
      throw new StudioError('FORBIDDEN', 'Sign in with the invited account to accept this invitation');
    }
    if (args.signedInUserId !== addressee.id) {
      throw new StudioError('FORBIDDEN', 'This invitation is for another account. Sign out and open the link again.');
    }
    userId = addressee.id;
  } else {
    const name = args.name?.trim() ?? '';
    const fields: Record<string, string> = {};
    if (name === '') fields.name = 'Enter your name';
    else if (name.length > MAX_NAME_LENGTH) fields.name = `Use at most ${MAX_NAME_LENGTH} characters`;
    if (!args.password) fields.password = 'Choose a password';
    else {
      const problem = checkPasswordPolicy(args.password);
      if (problem) fields.password = passwordProblemMessage(problem);
    }
    if (Object.keys(fields).length > 0) throw new StudioError('INVALID', undefined, fields);

    try {
      ({ userId } = await createPasswordUser(prisma, {
        email: row.email,
        name,
        password: args.password as string,
        locale: isLocale(row.invitedBy.locale) ? row.invitedBy.locale : 'en',
      }));
    } catch (error) {
      if (error instanceof PasswordPolicyError) throw new StudioError('INVALID', undefined, { password: passwordProblemMessage(error.reason) });
      // Someone else made the account between the check above and now (another invitation, most likely).
      if (error instanceof EmailTakenError) throw new StudioError('CONFLICT', 'An account with this address was just created. Sign in and open the link again');
      throw error;
    }
    createdAccount = true;
  }

  /** The retail shop whose snapshot this acceptance queued (it now has its owner), to deliver once it has committed. */
  let queuedRetail: string | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.invitation.updateMany({
        where: { id: row.id, ...OPEN, expiresAt: { gt: args.now } },
        data: { acceptedAt: args.now },
      });
      if (claimed.count !== 1) throw refusal('used');

      const changes: Record<string, { before: unknown; after: unknown }> = {
        accepted: { before: false, after: true },
        userId: { before: null, after: userId },
      };
      if (row.restaurantId !== null && row.role !== null) {
        const restaurantId = row.restaurantId;
        // The person may have become till staff after the invitation was sent.
        if (await tx.posStaff.findFirst({ where: { userId }, select: { id: true } })) throw new StudioError('CONFLICT', TILL_ACCOUNT);
        const held = await tx.membership.findUnique({ where: { userId_restaurantId: { userId, restaurantId } }, select: { id: true, role: true } });
        if (!held) {
          await tx.membership.create({ data: { userId, restaurantId, role: row.role } });
          changes.role = { before: null, after: row.role };
          // A new owner of a retail shop is its snapshot's owner (or may be): a no-op for other businesses and roles.
          if (row.role === 'OWNER' && (await bumpRetailState(tx, restaurantId)) !== null) queuedRetail = restaurantId;
        } else if (held.role !== 'OWNER' && row.role === 'OWNER') {
          // A designer becomes an owner. Nothing here ever takes a role away.
          await tx.membership.update({ where: { id: held.id }, data: { role: 'OWNER' } });
          changes.role = { before: held.role, after: 'OWNER' };
          if ((await bumpRetailState(tx, restaurantId)) !== null) queuedRetail = restaurantId;
        }
      }
      // An account Buzzify Retail asked for becomes an ordinary Studio account once its person accepts a Studio role.
      if (addressee && (await tx.user.updateMany({ where: { id: userId, identityOnly: true }, data: { identityOnly: false } })).count === 1) {
        changes.identityOnly = { before: true, after: false };
      }
      if (row.asSuperAdmin) {
        await tx.user.update({ where: { id: userId }, data: { isSuperAdmin: true } });
        changes.isSuperAdmin = { before: addressee?.isSuperAdmin ?? false, after: true };
      }
      await tx.auditLog.create({
        data: {
          actorId: row.invitedById,
          restaurantId: row.restaurantId,
          menuId: null,
          action: 'invitation.accepted',
          entityType: 'Invitation',
          entityId: row.id,
          changes: changes as Prisma.InputJsonObject,
          ip: args.meta?.ip ?? '',
          userAgent: args.meta?.userAgent ?? '',
        },
      });
    });
  } catch (error) {
    // The account was made for this invitation alone, and nothing else refers to it yet.
    if (createdAccount) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    throw error;
  }
  // The transaction has committed: the first delivery can go now.
  if (queuedRetail !== null) kickAfterCommit((fn) => fn(), queuedRetail);
  return { userId, email: row.email, createdAccount };
}
