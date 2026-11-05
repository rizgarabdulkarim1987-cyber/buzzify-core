import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { BODY_MAX, TITLE_MAX } from '@/lib/announcements';
import { LOCALES } from '@/lib/locale';
import { defineAction } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';
import { businessSpace } from '@/server/studio/services/space-scope';

/**
 * Announcements from the Buzzify team to every till and Studio user. Only Super Admins hold `platform.settings`, and a
 * client policy can never grant it. Every change is in the audit log.
 */

const PLATFORM = { kind: 'platform' } as const;

const texts = (max: number) =>
  z.object(Object.fromEntries(LOCALES.map((locale) => [locale, z.string().max(max, `Use at most ${max} characters`).optional()])));

const when = z
  .string()
  .max(40)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Use a date and time');

const content = {
  titles: texts(TITLE_MAX),
  bodies: texts(BODY_MAX),
  startsAt: when.optional(),
  endsAt: when.nullable().optional(),
};

type Content = { titles: Record<string, string | undefined>; bodies: Record<string, string | undefined>; startsAt?: string; endsAt?: string | null };

/** Trims, drops the empty languages, and checks what a form cannot: one language with both a title and a message, and an end after the start. */
function prepare(input: Content) {
  const keep = (map: Record<string, string | undefined>): Record<string, string> =>
    Object.fromEntries(Object.entries(map).flatMap(([key, value]) => ((value ?? '').trim() === '' ? [] : [[key, (value ?? '').trim()]])));
  const titles = keep(input.titles);
  const bodies = keep(input.bodies);
  if (!LOCALES.some((locale) => titles[locale] && bodies[locale])) {
    throw new StudioError('INVALID', undefined, { titles: 'Write a title and a message in at least one language' });
  }
  const startsAt = input.startsAt ? new Date(input.startsAt) : new Date();
  const endsAt = input.endsAt ? new Date(input.endsAt) : null;
  if (endsAt && endsAt <= startsAt) throw new StudioError('INVALID', undefined, { endsAt: 'The end must be after the start' });
  return { titles: titles as Prisma.InputJsonObject, bodies: bodies as Prisma.InputJsonObject, startsAt, endsAt };
}

export const createAnnouncement = defineAction({
  name: 'announcement.create',
  permission: 'platform.settings',
  input: z.object({ ...content, space: businessSpace }),
  target: () => PLATFORM,
  run: (ctx, { space, ...input }) => {
    const data = prepare(input);
    return ctx.transaction(async (tx) => {
      const row = await tx.announcement.create({ data: { ...data, space, createdById: ctx.actor.userId }, select: { id: true } });
      ctx.audit({ action: 'announcement.created', entityType: 'Announcement', entityId: row.id });
      return { id: row.id };
    });
  },
});

export const updateAnnouncement = defineAction({
  name: 'announcement.update',
  permission: 'platform.settings',
  input: z.object({ id: z.string().min(1).max(100), ...content }),
  target: () => PLATFORM,
  run: (ctx, { id, ...input }) => {
    const data = prepare(input);
    return ctx.transaction(async (tx) => {
      const found = await tx.announcement.findUnique({ where: { id }, select: { id: true } });
      if (!found) throw new StudioError('NOT_FOUND');
      await tx.announcement.update({ where: { id }, data });
      ctx.audit({ action: 'announcement.updated', entityType: 'Announcement', entityId: id });
      return { id };
    });
  },
});

export const archiveAnnouncement = defineAction({
  name: 'announcement.archive',
  permission: 'platform.settings',
  input: z.object({ id: z.string().min(1).max(100) }),
  target: () => PLATFORM,
  run: (ctx, { id }) =>
    ctx.transaction(async (tx) => {
      const found = await tx.announcement.findUnique({ where: { id }, select: { id: true } });
      if (!found) throw new StudioError('NOT_FOUND');
      await tx.announcement.update({ where: { id }, data: { archivedAt: new Date() } });
      ctx.audit({ action: 'announcement.archived', entityType: 'Announcement', entityId: id });
      return { id };
    }),
});
