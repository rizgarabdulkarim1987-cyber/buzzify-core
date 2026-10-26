import { z } from 'zod';
import { pickAnnouncement, type ActiveAnnouncement, type AnnouncementRow } from '@/lib/announcements';
import { defineQuery } from '@/server/studio/framework/query';

/**
 * The announcements a signed-in person sees now, in their own language: started, not ended, not archived. Everyone who can
 * act (owner, manager, cashier, kitchen, designer, Super Admin) may read them; nothing here is specific to a restaurant.
 */
export const activeAnnouncements = defineQuery({
  name: 'announcements.active',
  permission: null,
  input: z.unknown(),
  target: () => ({ kind: 'self' }),
  run: async ({ actor, db }): Promise<ActiveAnnouncement[]> => {
    const now = new Date();
    const rows = await db.announcement.findMany({
      where: { archivedAt: null, startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
      orderBy: { startsAt: 'desc' },
      take: 20,
    });
    const shown: ActiveAnnouncement[] = [];
    for (const row of rows) {
      const text = pickAnnouncement(row.titles, row.bodies, actor.locale);
      if (text) shown.push({ id: row.id, ...text, endsAt: row.endsAt?.toISOString() ?? null });
    }
    return shown;
  },
});

/** Every announcement that is not archived, for the Super Admin's page. */
export const listAnnouncements = defineQuery({
  name: 'announcements.list',
  permission: 'platform.settings',
  input: z.unknown(),
  target: () => ({ kind: 'platform' }),
  run: async ({ db }): Promise<AnnouncementRow[]> => {
    const now = Date.now();
    const rows = await db.announcement.findMany({ where: { archivedAt: null }, orderBy: { startsAt: 'desc' }, take: 200 });
    return rows.map((row) => ({
      id: row.id,
      titles: row.titles as Record<string, string>,
      bodies: row.bodies as Record<string, string>,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt?.toISOString() ?? null,
      status: row.startsAt.getTime() > now ? 'scheduled' : row.endsAt && row.endsAt.getTime() <= now ? 'ended' : 'live',
    }));
  },
});
