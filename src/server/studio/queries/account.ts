import { z } from 'zod';
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
