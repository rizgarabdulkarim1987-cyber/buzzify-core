import type { ScopedTx } from '@/server/data/tenant-db';
import type { MemberRole } from '@/server/domain/permissions';
import type { Actor } from '@/server/studio/auth/actor';
import { normalizeEmail } from '@/server/studio/auth/users';
import { StudioError } from '@/server/studio/framework/result';

/**
 * Changes to people and what they hold, for Super Admins. Each takes the transaction of the action that calls it and
 * throws a `StudioError` for what it refuses; the action writes the audit row from what is returned. The user table is
 * global, so these key what they change by the ids the action was given, which only a Super Admin (`people.manage`)
 * can supply: nobody else reaches this code.
 */

/** One person as the People screen lists them: who they are, whether they are on and what they can open. */
export interface PersonRow {
  userId: string;
  name: string;
  email: string;
  isSuperAdmin: boolean;
  twoFactorEnabled: boolean;
  deactivated: boolean;
  createdAt: string;
  memberships: Array<{ restaurantId: string; restaurantName: string; role: MemberRole }>;
}

/** An invitation as the People screen lists it (never its link or token). */
export interface InvitationRow {
  id: string;
  email: string;
  restaurantId: string | null;
  restaurantName: string | null;
  role: MemberRole | null;
  asSuperAdmin: boolean;
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  expiresAt: string;
  createdAt: string;
  invitedBy: string;
}

function problem(field: string, message: string, code: 'INVALID' | 'CONFLICT' = 'INVALID'): StudioError {
  return new StudioError(code, message, { [field]: message });
}

/** Prisma's unique-constraint violation, however many layers wrapped it on the way up. */
function isUniqueViolation(error: unknown): boolean {
  for (let e = error, depth = 0; e && typeof e === 'object' && depth < 5; e = (e as { cause?: unknown }).cause, depth += 1) {
    if ((e as { code?: unknown }).code === 'P2002') return true;
  }
  return false;
}

// Memberships ---------------------------------------------------------------------------------------------------------

/** Adds a person to a restaurant as a designer. Run it on the restaurant's own client. Someone who is a member already is refused, whatever their role. */
export async function assignDesigner(tx: ScopedTx, args: { restaurantId: string; userId: string }): Promise<void> {
  const user = await tx.user.findUnique({ where: { id: args.userId }, select: { id: true } });
  if (!user) throw new StudioError('NOT_FOUND');
  const held = await tx.membership.findFirst({ where: { userId: user.id, restaurantId: args.restaurantId }, select: { id: true } });
  if (held) throw problem('userId', 'This person already has access to this restaurant', 'CONFLICT');
  await tx.membership.create({ data: { userId: user.id, restaurantId: args.restaurantId, role: 'DESIGNER' } });
}

/**
 * Takes a person out of a restaurant, whatever their role there (the last owner too), and says which role it was. The
 * invitations they sent into that restaurant that nobody has used yet are withdrawn with it: they were their word,
 * given as a member, and would otherwise let them back in through an address they control. Their invitations to other
 * restaurants, where they still hold the role, are left alone. The invitation table is not scoped to a restaurant, so
 * the restaurant is named here.
 */
export async function unassignMember(
  tx: ScopedTx,
  args: { restaurantId: string; userId: string; now: Date },
): Promise<{ role: MemberRole; revokedInvitations: number }> {
  const held = await tx.membership.findFirst({ where: { userId: args.userId, restaurantId: args.restaurantId }, select: { id: true, role: true } });
  if (!held) throw new StudioError('NOT_FOUND');
  await tx.membership.deleteMany({ where: { id: held.id } });
  const revoked = await tx.invitation.updateMany({
    where: { invitedById: args.userId, restaurantId: args.restaurantId, acceptedAt: null, revokedAt: null },
    data: { revokedAt: args.now },
  });
  return { role: held.role, revokedInvitations: revoked.count };
}

// Accounts ------------------------------------------------------------------------------------------------------------

/** The refusal when someone else reaches for the platform owner's account: nobody but its holder may change it. */
const PLATFORM_OWNER_ONLY = 'Only the platform owner can change this account';

/**
 * Switches an account off: it keeps its history and memberships, every session it holds ends now, and the invitations it
 * sent that nobody has used are withdrawn (a deactivated person's word is no longer good). Better Auth refuses it a new
 * session, and the Studio no longer finds an actor for it.
 *
 * Refused: your own account; the platform owner's, to anyone else; one that is deactivated already; a Super Admin's,
 * unless the actor is a Super Admin too; and the last active Super Admin's. The last rule has to hold when two Super
 * Admins deactivate each other at the same moment, which a count taken before the update cannot promise. So a Super
 * Admin's deactivation first takes a row lock on every active Super Admin (a write that changes nothing but the time), and
 * the count after its own update is then the truth: a second deactivation waits for the first to commit, finds its target
 * changed, and counts one fewer.
 */
export async function deactivatePerson(
  tx: ScopedTx,
  args: { actor: Pick<Actor, 'userId' | 'isSuperAdmin' | 'isPlatformOwner'>; userId: string; now: Date },
): Promise<{ revokedInvitations: number }> {
  if (args.userId === args.actor.userId) throw problem('userId', 'You cannot deactivate your own account');
  const target = await tx.user.findUnique({
    where: { id: args.userId },
    select: { id: true, isSuperAdmin: true, isPlatformOwner: true, deactivatedAt: true },
  });
  if (!target) throw new StudioError('NOT_FOUND');
  if (target.isPlatformOwner && !args.actor.isPlatformOwner) throw new StudioError('FORBIDDEN', PLATFORM_OWNER_ONLY);
  if (target.deactivatedAt) throw problem('userId', 'This account is already deactivated', 'CONFLICT');
  if (target.isSuperAdmin) {
    if (!args.actor.isSuperAdmin) throw new StudioError('FORBIDDEN');
    await tx.user.updateMany({ where: { isSuperAdmin: true, deactivatedAt: null }, data: { updatedAt: args.now } });
  }

  const { count } = await tx.user.updateMany({ where: { id: target.id, deactivatedAt: null }, data: { deactivatedAt: args.now } });
  if (count === 0) throw problem('userId', 'This account is already deactivated', 'CONFLICT');
  if (target.isSuperAdmin && (await tx.user.count({ where: { isSuperAdmin: true, deactivatedAt: null } })) === 0) {
    throw problem('userId', 'There must always be one active Super Admin');
  }

  await tx.session.deleteMany({ where: { userId: target.id } });
  const revoked = await tx.invitation.updateMany({
    where: { invitedById: target.id, acceptedAt: null, revokedAt: null },
    data: { revokedAt: args.now },
  });
  return { revokedInvitations: revoked.count };
}

/** Switches a deactivated account back on. It signs in as before; the sessions and invitations that ended stay ended. */
export async function reactivatePerson(tx: ScopedTx, args: { userId: string }): Promise<void> {
  const { count } = await tx.user.updateMany({ where: { id: args.userId, deactivatedAt: { not: null } }, data: { deactivatedAt: null } });
  if (count > 0) return;
  const exists = await tx.user.findUnique({ where: { id: args.userId }, select: { id: true } });
  if (!exists) throw new StudioError('NOT_FOUND');
  throw problem('userId', 'This account is not deactivated', 'CONFLICT');
}

/**
 * Sets the address a person signs in with. The new address is normalized, must not belong to anyone, and is taken as
 * given: the person has not confirmed it, which is why nobody does this to their own account (they use the account page,
 * where the old address and the new one each confirm). Returns what the notice to the old address needs. Sessions stay.
 */
export async function changeEmail(
  tx: ScopedTx,
  args: { actor: Pick<Actor, 'userId' | 'isPlatformOwner'>; userId: string; email: string },
): Promise<{ before: string; name: string; locale: string; after: string }> {
  if (args.userId === args.actor.userId) {
    throw problem('userId', 'Change your own address on your account page, where both addresses confirm it');
  }
  const after = normalizeEmail(args.email);
  const user = await tx.user.findUnique({ where: { id: args.userId }, select: { email: true, name: true, locale: true, isPlatformOwner: true } });
  if (!user) throw new StudioError('NOT_FOUND');
  // A changed address can be used to reset the password: only the owner may move theirs, on their account page.
  if (user.isPlatformOwner && !args.actor.isPlatformOwner) throw new StudioError('FORBIDDEN', PLATFORM_OWNER_ONLY);
  if (user.email === after) throw problem('email', 'This is already their email address');
  if (await tx.user.findUnique({ where: { email: after }, select: { id: true } })) {
    throw problem('email', 'An account with this email already exists');
  }
  try {
    await tx.user.update({ where: { id: args.userId }, data: { email: after } });
  } catch (error) {
    if (isUniqueViolation(error)) throw problem('email', 'An account with this email already exists');
    throw error;
  }
  return { before: user.email, name: user.name, locale: user.locale, after };
}
