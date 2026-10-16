import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import type { MemberRole } from '@/server/domain/permissions';
import { defineQuery, type QueryContext } from '@/server/studio/framework/query';
import { StudioError } from '@/server/studio/framework/result';

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
const targetOf = (i: { restaurantId?: string | undefined }) =>
  i.restaurantId === undefined ? PLATFORM : ({ kind: 'restaurant', restaurantId: i.restaurantId } as const);

/** A query with no restaurant is the platform's: this refuses it for anyone who is not a Super Admin, whatever the framework let in. */
function requirePlatformScope(ctx: QueryContext): void {
  if (ctx.restaurantId === null && ctx.scope.kind !== 'all') throw new StudioError('FORBIDDEN');
}

interface PersonRow {
  userId: string;
  name: string;
  email: string;
  isSuperAdmin: boolean;
  twoFactorEnabled: boolean;
  deactivated: boolean;
  createdAt: string;
  memberships: Array<{ restaurantId: string; restaurantName: string; role: MemberRole }>;
}

export const listPeople = defineQuery({
  name: 'people.listPeople',
  permission: 'people.invite',
  input: z.object({
    restaurantId: idField.optional(),
    q: z.string().trim().max(100).optional(),
    page: pageField,
  }),
  target: targetOf,
  run: async (ctx, { q, page }) => {
    requirePlatformScope(ctx);
    const restaurantId = ctx.restaurantId;
    const where: Prisma.UserWhereInput = {
      ...(restaurantId !== null ? { memberships: { some: { restaurantId } } } : {}),
      ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q.toLowerCase() } }] } : {}),
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
            where: restaurantId !== null ? { restaurantId } : {},
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

type ListedStatus = Exclude<(typeof STATUSES)[number], 'all'>;

interface InvitationRow {
  id: string;
  email: string;
  restaurantId: string | null;
  restaurantName: string | null;
  role: MemberRole | null;
  asSuperAdmin: boolean;
  status: ListedStatus;
  expiresAt: string;
  createdAt: string;
  invitedBy: string;
}

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
  }),
  target: targetOf,
  run: async (ctx, { status, page }) => {
    requirePlatformScope(ctx);
    const now = new Date();
    const where: Prisma.InvitationWhereInput = {
      ...(ctx.restaurantId !== null ? { restaurantId: ctx.restaurantId } : {}),
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
