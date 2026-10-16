import { z } from 'zod';
import type { MemberRole } from '@/server/domain/permissions';
import { currentSessionId } from '@/server/studio/auth/sessions';
import { defineQuery } from '@/server/studio/framework/query';

/** One of a person's own sessions, as the account page lists it. */
interface SessionRow {
  id: string;
  createdAt: string;
  expiresAt: string;
  ipAddress: string;
  userAgent: string;
  /** Whether this is the session the request itself carries. */
  current: boolean;
}

/** A restaurant the signed-in person is a member of, with their role there and its menus. */
interface MyRestaurant {
  id: string;
  name: string;
  role: MemberRole;
  menus: Array<{ id: string; name: string }>;
}

/**
 * The restaurants the signed-in person belongs to, by name, with their menus: what an owner's navigation links to (an
 * owner with one restaurant and one menu goes straight to the menu). Keyed by the actor's own memberships, never by an id
 * from the input, so it reads nothing the person does not already belong to. A Super Admin's reach comes from the flag,
 * not from memberships, so their list is only the restaurants they were also made a member of.
 */
export const myRestaurants = defineQuery({
  name: 'account.myRestaurants',
  permission: null,
  input: z.unknown(),
  target: () => ({ kind: 'self' }),
  run: async ({ actor, db }): Promise<MyRestaurant[]> => {
    const memberships = await db.membership.findMany({
      where: { userId: actor.userId },
      orderBy: { createdAt: 'asc' },
      select: {
        role: true,
        restaurant: {
          select: { id: true, name: true, menus: { orderBy: [{ name: 'asc' }, { id: 'asc' }], select: { id: true, name: true } } },
        },
      },
    });
    return memberships.map(({ role, restaurant }) => ({ id: restaurant.id, name: restaurant.name, role, menus: restaurant.menus }));
  },
});

/**
 * The signed-in person's own sessions that have not expired, newest first. Keyed by the actor, and a session's token (the
 * secret half of its cookie) is never selected: `id` is what `endSession` takes.
 */
export const listMySessions = defineQuery({
  name: 'account.listMySessions',
  permission: null,
  // Whatever arrives (a client component may pass nothing at all) is ignored.
  input: z.unknown(),
  target: () => ({ kind: 'self' }),
  run: async ({ actor, db }): Promise<SessionRow[]> => {
    const [rows, current] = await Promise.all([
      db.session.findMany({
        where: { userId: actor.userId, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, createdAt: true, expiresAt: true, ipAddress: true, userAgent: true },
      }),
      currentSessionId(db),
    ]);
    return rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      ipAddress: row.ipAddress ?? '',
      userAgent: row.userAgent ?? '',
      current: row.id === current,
    }));
  },
});
