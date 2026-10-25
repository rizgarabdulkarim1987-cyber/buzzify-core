import type { PrismaClient } from '@/generated/prisma/client';
import type { ScopedTx } from '@/server/data/tenant-db';
import type { PosRole } from '@/server/domain/pos/permissions';
import { StudioError } from '@/server/studio/framework/result';

/** One person at a restaurant's till, as the staff page lists them. An OWNER member has no row of their own. */
export interface PosStaffView {
  /** The `PosStaff` id; for an OWNER member without a row, `owner:<userId>`. */
  id: string;
  userId: string;
  name: string;
  email: string;
  role: PosRole;
  viaMembership: boolean;
  active: boolean;
  /** Whether the person has set a quick sign-in PIN (never the PIN itself). */
  hasPin: boolean;
  createdAt: string;
}

const NOT_SELF = 'You cannot change your own role or access';
const LAST_OWNER = 'The restaurant needs at least one active owner';
const ROLE_LIMIT = 'Your role cannot give or change this role';
const ALREADY_STAFF = 'This person already works at this till';

/** Everyone who works the restaurant's till: the OWNER members first, then the staff rows in the order they joined. */
export async function listPosStaff(db: PrismaClient, restaurantId: string): Promise<PosStaffView[]> {
  const [members, rows] = await Promise.all([
    db.membership.findMany({
      where: { restaurantId, role: 'OWNER' },
      include: { user: { select: { id: true, name: true, email: true, deactivatedAt: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    db.posStaff.findMany({
      where: { restaurantId },
      include: { user: { select: { id: true, name: true, email: true, deactivatedAt: true } } },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  const owners = new Set(members.map((member) => member.userId));
  return [
    ...members.map((member) => ({
      id: `owner:${member.userId}`,
      userId: member.userId,
      name: member.user.name,
      email: member.user.email,
      role: 'OWNER' as const,
      viaMembership: true,
      active: member.user.deactivatedAt === null,
      hasPin: false,
      createdAt: member.createdAt.toISOString(),
    })),
    // A staff row of someone who is also an OWNER member is hidden: the membership is what counts.
    ...rows
      .filter((row) => !owners.has(row.userId))
      .map((row) => ({
        id: row.id,
        userId: row.userId,
        name: row.user.name,
        email: row.user.email,
        role: row.role,
        viaMembership: false,
        active: row.deactivatedAt === null && row.user.deactivatedAt === null,
        hasPin: row.pinHash !== null,
        createdAt: row.createdAt.toISOString(),
      })),
  ];
}

/**
 * Whether someone in `actor` role may give `role` to a person who now holds `current` (null: a new person). Only an OWNER
 * touches the OWNER and MANAGER roles; a MANAGER hands out and changes the floor roles.
 */
export function mayAssign(actor: PosRole, role: PosRole, current: PosRole | null): boolean {
  if (actor === 'OWNER') return true;
  if (actor !== 'MANAGER') return false;
  const floor = (r: PosRole | null) => r === null || r === 'CASHIER' || r === 'KITCHEN';
  return floor(role) && floor(current);
}

export const refuseRole = (): StudioError => new StudioError('FORBIDDEN', ROLE_LIMIT);

/** Adds a person to the restaurant's till. */
export async function addPosStaff(
  tx: ScopedTx,
  args: { restaurantId: string; userId: string; role: PosRole },
): Promise<{ id: string }> {
  const isOwner = await tx.membership.findFirst({ where: { userId: args.userId, role: 'OWNER' } });
  if (isOwner) throw new StudioError('CONFLICT', ALREADY_STAFF);
  try {
    const row = await tx.posStaff.create({ data: { restaurantId: args.restaurantId, userId: args.userId, role: args.role } });
    return { id: row.id };
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === 'P2002') throw new StudioError('CONFLICT', ALREADY_STAFF);
    throw error;
  }
}

/** The active owners other than `exceptStaffId`: OWNER staff rows and OWNER members whose accounts are on. */
async function otherActiveOwners(tx: ScopedTx, exceptStaffId: string): Promise<number> {
  const [rows, members] = await Promise.all([
    tx.posStaff.count({ where: { role: 'OWNER', deactivatedAt: null, id: { not: exceptStaffId }, user: { deactivatedAt: null } } }),
    tx.membership.count({ where: { role: 'OWNER', user: { deactivatedAt: null } } }),
  ]);
  return rows + members;
}

async function target(tx: ScopedTx, args: { actingUserId: string; staffId: string }) {
  const row = await tx.posStaff.findFirst({ where: { id: args.staffId } });
  if (!row) throw new StudioError('NOT_FOUND');
  if (row.userId === args.actingUserId) throw new StudioError('FORBIDDEN', NOT_SELF);
  return row;
}

/** Gives a staff row another role. Never one's own, and never away from the last active owner. */
export async function changePosStaffRole(
  tx: ScopedTx,
  args: { restaurantId: string; actingUserId: string; staffId: string; role: PosRole },
): Promise<{ id: string; before: PosRole; after: PosRole; userId: string }> {
  const row = await target(tx, args);
  if (row.role === 'OWNER' && args.role !== 'OWNER' && row.deactivatedAt === null && (await otherActiveOwners(tx, row.id)) === 0) {
    throw new StudioError('CONFLICT', LAST_OWNER);
  }
  await tx.posStaff.update({ where: { id: row.id }, data: { role: args.role } });
  return { id: row.id, before: row.role, after: args.role, userId: row.userId };
}

/** Switches a staff row off. Never one's own, and never the last active owner's. */
export async function deactivateIn(
  tx: ScopedTx,
  args: { restaurantId: string; actingUserId: string; staffId: string },
): Promise<{ id: string; role: PosRole; userId: string }> {
  const row = await target(tx, args);
  if (row.role === 'OWNER' && row.deactivatedAt === null && (await otherActiveOwners(tx, row.id)) === 0) {
    throw new StudioError('CONFLICT', LAST_OWNER);
  }
  await tx.posStaff.update({ where: { id: row.id }, data: { deactivatedAt: new Date() } });
  return { id: row.id, role: row.role, userId: row.userId };
}

/** Switches a staff row back on. */
export async function reactivateIn(
  tx: ScopedTx,
  args: { restaurantId: string; actingUserId: string; staffId: string },
): Promise<{ id: string; role: PosRole; userId: string }> {
  const row = await target(tx, args);
  await tx.posStaff.update({ where: { id: row.id }, data: { deactivatedAt: null } });
  return { id: row.id, role: row.role, userId: row.userId };
}

/** The staff row a manager's action works on, for the role check before the change. */
export async function staffRowRole(tx: ScopedTx, staffId: string): Promise<PosRole> {
  const row = await tx.posStaff.findFirst({ where: { id: staffId }, select: { role: true } });
  if (!row) throw new StudioError('NOT_FOUND');
  return row.role;
}
