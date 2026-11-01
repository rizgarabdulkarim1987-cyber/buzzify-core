import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { parsePolicy } from '@/server/domain/permissions';
import { defineQuery, type QueryContext } from '@/server/studio/framework/query';
import { StudioError } from '@/server/studio/framework/result';
import { literal } from '@/server/studio/services/list-filters';
import { sectorWhere } from '@/server/studio/services/space-scope';
import type { InvitationRow, PersonRow } from '@/server/studio/services/people';

/**
 * Who is in the Studio and who has been invited. A Super Admin reads all of it; a restaurant's owner (or designer) whose
 * client policy grants `people.invite` reads that restaurant's members and invitations, through a restaurant target, and
 * nothing outside it: a platform-wide read needs the platform target, which only Super Admins pass. Every row is cut
 * for the reader (the memberships of a restaurant's list are that restaurant's alone), and no token or hash is selected.
 */

const PAGE_SIZE = 25;

const idField = z.string().min(1).max(100);
const pageField = z.number().int().min(1).max(100_000).default(1);

const PLATFORM = { kind: 'platform' } as const;
/**
 * The space a platform-wide list is read through. A person is in a business space when they work in one of its businesses
 * (their memberships are cut the same way); everyone else, the Super Admins and the staff attached to no business, is in
 * the platform's own space. So every account is in at least one space.
 */
const peopleSpace = z.enum(['food', 'pharmacy', 'platform']).default('food');
type PeopleSpace = z.infer<typeof peopleSpace>;

/** A membership of a business space's sector; null for the platform space and for any list that is not the platform-wide one. */
const inSpace = (ctx: QueryContext, space: PeopleSpace) =>
  ctx.restaurantId === null && ctx.scope.kind === 'all' && space !== 'platform' ? { restaurant: sectorWhere(space) } : null;

/** Whether the list is the platform space's own. */
const isPlatformSpace = (ctx: QueryContext, space: PeopleSpace) => ctx.restaurantId === null && ctx.scope.kind === 'all' && space === 'platform';

const targetOf = (i: { restaurantId?: string | undefined }) =>
  i.restaurantId === undefined ? PLATFORM : ({ kind: 'restaurant', restaurantId: i.restaurantId } as const);

/** A query with no restaurant is the platform's: this refuses it for anyone who is not a Super Admin, whatever the framework let in. */
function requirePlatformScope(ctx: QueryContext): void {
  if (ctx.restaurantId === null && ctx.scope.kind !== 'all') throw new StudioError('FORBIDDEN');
}

export const listPeople = defineQuery({
  name: 'people.listPeople',
  permission: 'people.invite',
  input: z.object({
    restaurantId: idField.optional(),
    q: z.string().trim().max(100).optional(),
    page: pageField,
    space: peopleSpace,
  }),
  target: targetOf,
  run: async (ctx, { q, page, space }) => {
    requirePlatformScope(ctx);
    const restaurantId = ctx.restaurantId;
    const spaceMembership = inSpace(ctx, space);
    const where: Prisma.UserWhereInput = {
      ...(restaurantId !== null ? { memberships: { some: { restaurantId } } } : {}),
      ...(spaceMembership ? { memberships: { some: spaceMembership } } : {}),
      ...(isPlatformSpace(ctx, space) ? { OR: [{ isSuperAdmin: true }, { memberships: { none: {} } }] } : {}),
      // A typed % or _ is looked for as itself (`literal`), as in every other search.
      ...(q ? { AND: [{ OR: [{ name: { contains: literal(q), mode: 'insensitive' } }, { email: { contains: literal(q.toLowerCase()) } }] }] } : {}),
    };
    const [total, users] = await Promise.all([
      ctx.db.user.count({ where }),
      ctx.db.user.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true,
          name: true,
          email: true,
          isSuperAdmin: true,
          twoFactorEnabled: true,
          deactivatedAt: true,
          createdAt: true,
          // In a restaurant's list, only that restaurant: where else a person works is not the reader's to see.
          memberships: {
            where: restaurantId !== null ? { restaurantId } : (spaceMembership ?? {}),
            orderBy: { createdAt: 'asc' },
            select: { restaurantId: true, role: true, restaurant: { select: { name: true } } },
          },
        },
      }),
    ]);
    const rows: PersonRow[] = users.map((user) => ({
      userId: user.id,
      name: user.name,
      email: user.email,
      isSuperAdmin: user.isSuperAdmin,
      twoFactorEnabled: user.twoFactorEnabled ?? false,
      deactivated: user.deactivatedAt !== null,
      createdAt: user.createdAt.toISOString(),
      memberships: user.memberships.map((m) => ({ restaurantId: m.restaurantId, restaurantName: m.restaurant.name, role: m.role })),
    }));
    return { rows, page, pageSize: PAGE_SIZE, total };
  },
});

const STATUSES = ['pending', 'accepted', 'expired', 'revoked', 'all'] as const;

/** The invitations in a state, as a filter. An invitation is in exactly one: used beats withdrawn beats expired. */
function inStatus(status: Exclude<(typeof STATUSES)[number], 'all'>, now: Date): Prisma.InvitationWhereInput {
  switch (status) {
    case 'accepted':
      return { acceptedAt: { not: null } };
    case 'revoked':
      return { acceptedAt: null, revokedAt: { not: null } };
    case 'expired':
      return { acceptedAt: null, revokedAt: null, expiresAt: { lte: now } };
    case 'pending':
      return { acceptedAt: null, revokedAt: null, expiresAt: { gt: now } };
  }
}

export const listInvitations = defineQuery({
  name: 'people.listInvitations',
  permission: 'people.invite',
  input: z.object({
    restaurantId: idField.optional(),
    status: z.enum(STATUSES).default('pending'),
    page: pageField,
    space: peopleSpace,
  }),
  target: targetOf,
  run: async (ctx, { status, page, space }) => {
    requirePlatformScope(ctx);
    const now = new Date();
    const where: Prisma.InvitationWhereInput = {
      ...(ctx.restaurantId !== null ? { restaurantId: ctx.restaurantId } : isPlatformSpace(ctx, space) ? { restaurantId: null } : inSpace(ctx, space) ? { restaurant: sectorWhere(space as 'food' | 'pharmacy') } : {}),
      ...(status !== 'all' ? inStatus(status, now) : {}),
    };
    const [total, found] = await Promise.all([
      ctx.db.invitation.count({ where }),
      ctx.db.invitation.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true,
          email: true,
          restaurantId: true,
          role: true,
          asSuperAdmin: true,
          acceptedAt: true,
          revokedAt: true,
          expiresAt: true,
          createdAt: true,
          restaurant: { select: { name: true } },
          invitedBy: { select: { name: true } },
        },
      }),
    ]);
    const rows: InvitationRow[] = found.map((row) => ({
      id: row.id,
      email: row.email,
      restaurantId: row.restaurantId,
      restaurantName: row.restaurant?.name ?? null,
      role: row.role,
      asSuperAdmin: row.asSuperAdmin,
      status: row.acceptedAt ? 'accepted' : row.revokedAt ? 'revoked' : row.expiresAt <= now ? 'expired' : 'pending',
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      invitedBy: row.invitedBy.name,
    }));
    return { rows, page, pageSize: PAGE_SIZE, total };
  },
});

export const restaurantMembers = defineQuery({
  name: 'people.restaurantMembers',
  permission: 'people.invite',
  input: z.object({ restaurantId: idField }),
  target: (i) => ({ kind: 'restaurant', restaurantId: i.restaurantId }),
  run: async (ctx) => {
    const restaurantId = ctx.restaurantId;
    if (restaurantId === null) throw new Error('A restaurant query ran without a restaurant');
    const members = await ctx.db.membership.findMany({
      where: { restaurantId },
      // Owners first (the enum is declared designer, then owner), then by name.
      orderBy: [{ role: 'desc' }, { user: { name: 'asc' } }, { id: 'asc' }],
      select: {
        role: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true, deactivatedAt: true } },
      },
    });
    return members.map((member) => ({
      userId: member.user.id,
      name: member.user.name,
      email: member.user.email,
      role: member.role,
      deactivated: member.user.deactivatedAt !== null,
      since: member.createdAt.toISOString(),
    }));
  },
});

/** The people who work a restaurant's till from a till account (not its Studio members). Super Admins only. */
export const restaurantTillStaff = defineQuery({
  name: 'people.restaurantTillStaff',
  permission: 'people.manage',
  input: z.object({ restaurantId: idField }),
  target: (i) => ({ kind: 'restaurant', restaurantId: i.restaurantId }),
  run: async (ctx) => {
    const rows = await ctx.db.posStaff.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, role: true, deactivatedAt: true, createdAt: true, user: { select: { id: true, name: true, email: true, deactivatedAt: true } } },
    });
    return rows.map((row) => ({
      staffId: row.id,
      userId: row.user.id,
      name: row.user.name,
      email: row.user.email,
      role: row.role,
      active: row.deactivatedAt === null && row.user.deactivatedAt === null,
      since: row.createdAt.toISOString(),
    }));
  },
});

/**
 * A restaurant's permission policy as saved (parsed: unknown keys and never-grantable grants are gone) and the version
 * to save a change against. Super Admins only: a client's policy is the agency's to read and change.
 */
export const restaurantPolicy = defineQuery({
  name: 'people.restaurantPolicy',
  permission: 'permissions.manage',
  input: z.object({ restaurantId: idField }),
  target: (i) => ({ kind: 'restaurant', restaurantId: i.restaurantId }),
  run: async (ctx) => {
    const restaurantId = ctx.restaurantId;
    if (restaurantId === null) throw new Error('A restaurant query ran without a restaurant');
    const row = await ctx.db.restaurant.findUnique({ where: { id: restaurantId }, select: { permissionPolicy: true, version: true } });
    if (!row) throw new StudioError('NOT_FOUND');
    return { policy: parsePolicy(row.permissionPolicy), version: row.version };
  },
});
