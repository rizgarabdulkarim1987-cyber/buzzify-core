import { z } from 'zod';
import { expireMenu } from '@/server/data/cache';
import type { ScopedTx } from '@/server/data/tenant-db';
import { parseSnapshot } from '@/server/domain/snapshot';
import { cancelSchedule as cancelPending, restoreDraftFromSnapshot, RevisionError, rollbackMenu, scheduleRevision } from '@/server/publish/revisions';
import { defineAction, type ActionContext } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';
import { idField } from '@/server/studio/services/content';

/**
 * A menu's revisions (spec 10.6): going back to one that was live, restoring one into the draft, and publishing at a
 * time. Going back changes what guests see at once; a restore only changes the draft; a schedule waits for its time.
 */

const atMenu = (menuId: string) => ({ kind: 'menu', menuId }) as const;

function menuOf(ctx: ActionContext): string {
  if (ctx.menuId === null) throw new Error('A menu action ran without a menu');
  return ctx.menuId;
}

/** A refusal of the publishing code, as what the person is told. */
function refusal(error: unknown): never {
  if (!(error instanceof RevisionError)) throw error;
  switch (error.code) {
    case 'NOT_FOUND':
      throw new StudioError('NOT_FOUND');
    case 'ARCHIVED':
      throw new StudioError('INVALID', 'Archived menus cannot be published');
    case 'NOT_LIVE_BEFORE':
      throw new StudioError('INVALID', 'This revision was never live, so the menu cannot go back to it');
    case 'ALREADY_LIVE':
      throw new StudioError('INVALID', 'This revision is already live');
    case 'TOO_SOON':
      throw new StudioError('INVALID', undefined, { goLiveAt: 'Choose a time at least a minute from now' });
    case 'TOO_FAR':
      throw new StudioError('INVALID', undefined, { goLiveAt: 'Choose a time within a year' });
    case 'PENDING_EXISTS':
      throw new StudioError('CONFLICT', 'Another revision is already scheduled', {
        pendingNumber: String(error.pending!.number),
        pendingAt: error.pending!.goLiveAt.toISOString(),
      });
  }
}

async function slugsOf(tx: ScopedTx, menuId: string): Promise<string[]> {
  return (await tx.menuSlug.findMany({ where: { menuId }, select: { slug: true } })).map((row) => row.slug);
}

export const rollback = defineAction({
  name: 'revisions.rollback',
  permission: 'publish.rollback',
  input: z.object({ menuId: idField, revisionId: idField }),
  target: (i) => atMenu(i.menuId),
  run: (ctx, { revisionId }) =>
    ctx.transaction(async (tx) => {
      const menuId = menuOf(ctx);
      const before = await tx.menu.findFirst({ where: { id: menuId }, select: { liveRevision: { select: { number: true } } } });
      const { number } = await rollbackMenu(tx, { menuId, revisionId }).catch(refusal);
      ctx.audit({ action: 'menu.rolled_back', entityType: 'Menu', entityId: menuId, changes: { revision: { before: before?.liveRevision?.number ?? null, after: number } } });
      const slugs = await slugsOf(tx, menuId);
      ctx.afterCommit(() => expireMenu(slugs, menuId));
      return { number };
    }),
});

export const restore = defineAction({
  name: 'revisions.restore',
  permission: 'publish.rollback',
  input: z.object({ menuId: idField, revisionId: idField, expectedDraftHash: z.string().max(128).nullable() }),
  target: (i) => atMenu(i.menuId),
  run: (ctx, { revisionId, expectedDraftHash }) =>
    ctx.transaction(async (tx) => {
      const menuId = menuOf(ctx);
      // The draft the person was looking at: a restore over changes they have not seen would lose them unknowingly.
      const [menu] = await tx.menu.updateManyAndReturn({ where: { id: menuId }, data: { version: { increment: 1 } }, select: { draftHash: true } });
      if (!menu) throw new StudioError('NOT_FOUND');
      const revision = await tx.menuRevision.findFirst({ where: { id: revisionId, menuId }, select: { number: true, snapshot: true } });
      if (!revision) throw new StudioError('NOT_FOUND');
      if ((menu.draftHash ?? null) !== expectedDraftHash) throw new StudioError('CONFLICT');
      await restoreDraftFromSnapshot(tx, menuId, parseSnapshot(revision.snapshot));
      ctx.audit({ action: 'menu.restored_to_draft', entityType: 'Menu', entityId: menuId, changes: { revision: { before: null, after: revision.number } } });
      return { number: revision.number };
    }),
});

export const schedule = defineAction({
  name: 'revisions.schedule',
  permission: 'publish.schedule',
  // Cancelling what was scheduled, and the scheduler publishing it, stay open after a downgrade.
  feature: 'publish.scheduling',
  input: z.object({
    menuId: idField,
    goLiveAt: z.iso.datetime({ offset: true, error: 'Enter a valid date' }),
    note: z.string().trim().max(500, 'This is too long').optional(),
    replacePending: z.boolean().optional(),
  }),
  target: (i) => atMenu(i.menuId),
  run: (ctx, input) =>
    ctx.transaction(async (tx) => {
      const menuId = menuOf(ctx);
      const goLiveAt = new Date(input.goLiveAt);
      const outcome = await scheduleRevision(tx, {
        menuId,
        actorId: ctx.actor.userId,
        goLiveAt,
        ...(input.note ? { note: input.note } : {}),
        replacePending: input.replacePending ?? false,
        now: new Date(),
      }).catch(refusal);
      if (!outcome.ok) throw new StudioError('INVALID', 'This menu cannot be published yet', undefined, outcome.issues);
      ctx.audit({
        action: 'menu.publish_scheduled',
        entityType: 'Menu',
        entityId: menuId,
        changes: { revision: { before: null, after: outcome.number }, goLiveAt: { before: null, after: goLiveAt.toISOString() } },
      });
      return { revisionId: outcome.revisionId, number: outcome.number, goLiveAt: goLiveAt.toISOString(), warnings: outcome.warnings };
    }),
});

export const cancelSchedule = defineAction({
  name: 'revisions.cancelSchedule',
  permission: 'publish.schedule',
  input: z.object({ menuId: idField, revisionId: idField }),
  target: (i) => atMenu(i.menuId),
  run: (ctx, { revisionId }) =>
    ctx.transaction(async (tx) => {
      const menuId = menuOf(ctx);
      const { number } = await cancelPending(tx, { menuId, revisionId, now: new Date() }).catch(refusal);
      ctx.audit({ action: 'menu.schedule_cancelled', entityType: 'Menu', entityId: menuId, changes: { revision: { before: number, after: null } } });
      return { number };
    }),
});
