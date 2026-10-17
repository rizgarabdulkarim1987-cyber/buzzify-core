import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { expireMenu } from '@/server/data/cache';
import { delegates, type AnyDb, type ScopedDb, type ScopedTx } from '@/server/data/tenant-db';
import { validateForPublish } from '@/server/domain/publish-rules';
import { SNAPSHOT_SCHEMA_VERSION, snapshotAssetIds, snapshotHash } from '@/server/domain/snapshot';
import { loadDraftSnapshot } from './draft';
import type { PublishOutcome } from './publish';

export { restoreDraftFromSnapshot } from './draft';

/**
 * A menu's revisions after a publish (spec 10.6): going back to an earlier one, scheduling one to go live later, and
 * the scheduler that makes due ones live.
 */

export type RevisionErrorCode = 'ARCHIVED' | 'NOT_FOUND' | 'NOT_LIVE_BEFORE' | 'ALREADY_LIVE' | 'PENDING_EXISTS' | 'TOO_SOON' | 'TOO_FAR';

export class RevisionError extends Error {
  readonly code: RevisionErrorCode;
  /** With `PENDING_EXISTS`: the revision already waiting to go live. */
  readonly pending?: { number: number; goLiveAt: Date };

  constructor(code: RevisionErrorCode, pending?: { number: number; goLiveAt: Date }) {
    super(`Revision refused: ${code}`);
    this.name = 'RevisionError';
    this.code = code;
    if (pending) this.pending = pending;
  }
}

/** A schedule is at least a minute and at most 366 days away. */
const MIN_AHEAD_MS = 60_000;
const MAX_AHEAD_MS = 366 * 24 * 60 * 60_000;

/**
 * Takes the menu's row (with a version increment, as a publish does): two changes to what is live wait on each other.
 * Throws for a missing or archived menu.
 */
async function lockMenu(tx: AnyDb, menuId: string) {
  const [menu] = await tx.menu.updateManyAndReturn({
    where: { id: menuId },
    data: { version: { increment: 1 } },
    select: { status: true, liveRevisionId: true },
  });
  if (!menu) throw new RevisionError('NOT_FOUND');
  if (menu.status === 'ARCHIVED') throw new RevisionError('ARCHIVED');
  return menu;
}

/** The pending revision of a menu: one with a time to go live that has neither gone live nor been cancelled. */
function pendingOf(tx: AnyDb, menuId: string) {
  return tx.menuRevision.findFirst({
    where: { menuId, goLiveAt: { not: null }, wentLiveAt: null, cancelledAt: null },
    select: { id: true, number: true, goLiveAt: true },
    orderBy: { number: 'desc' },
  });
}

/**
 * Makes an earlier revision live again. It must be the menu's own and have gone live before, and not be live now.
 * Nothing is copied: the live pointer moves, and the draft stays as it is.
 */
export function rollbackMenu(db: AnyDb, args: { menuId: string; revisionId: string }): Promise<{ number: number }>;
export function rollbackMenu(db: ScopedTx, args: { menuId: string; revisionId: string }): Promise<{ number: number }>;
export async function rollbackMenu(client: AnyDb | ScopedDb, args: { menuId: string; revisionId: string }): Promise<{ number: number }> {
  const tx = delegates(client);
  const menu = await lockMenu(tx, args.menuId);
  const revision = await tx.menuRevision.findFirst({
    where: { id: args.revisionId, menuId: args.menuId },
    select: { id: true, number: true, snapshotHash: true, wentLiveAt: true },
  });
  if (!revision) throw new RevisionError('NOT_FOUND');
  if (!revision.wentLiveAt) throw new RevisionError('NOT_LIVE_BEFORE');
  if (revision.id === menu.liveRevisionId) throw new RevisionError('ALREADY_LIVE');
  await tx.menu.update({ where: { id: args.menuId }, data: { liveRevisionId: revision.id, liveHash: revision.snapshotHash } });
  return { number: revision.number };
}

export interface ScheduleArgs {
  menuId: string;
  actorId: string | null;
  goLiveAt: Date;
  note?: string;
  /** A schedule already waiting is cancelled in favour of this one; without it, it refuses (`PENDING_EXISTS`). */
  replacePending: boolean;
  now: Date;
}

/**
 * Freezes the draft into a revision that goes live at `goLiveAt` (spec 10.6). The draft is checked as for a publish; the
 * live revision, its hash and the menu's status stay until the scheduler makes the new one live. One revision per menu
 * waits at a time.
 */
export function scheduleRevision(db: AnyDb, args: ScheduleArgs): Promise<PublishOutcome>;
export function scheduleRevision(db: ScopedTx, args: ScheduleArgs): Promise<PublishOutcome>;
export async function scheduleRevision(client: AnyDb | ScopedDb, args: ScheduleArgs): Promise<PublishOutcome> {
  const tx = delegates(client);
  const { menuId, actorId, goLiveAt, note = '', replacePending, now } = args;
  await lockMenu(tx, menuId);

  const ahead = goLiveAt.getTime() - now.getTime();
  if (ahead < MIN_AHEAD_MS) throw new RevisionError('TOO_SOON');
  if (ahead > MAX_AHEAD_MS) throw new RevisionError('TOO_FAR');

  const pending = await pendingOf(tx, menuId);
  if (pending && !replacePending) throw new RevisionError('PENDING_EXISTS', { number: pending.number, goLiveAt: pending.goLiveAt! });

  const snapshot = await loadDraftSnapshot(tx, menuId);
  const issues = validateForPublish(snapshot);
  if (issues.some((issue) => issue.severity === 'block')) return { ok: false, issues };

  if (pending) await tx.menuRevision.update({ where: { id: pending.id }, data: { cancelledAt: now } });
  const latest = await tx.menuRevision.aggregate({ where: { menuId }, _max: { number: true } });
  const number = (latest._max.number ?? 0) + 1;
  const revision = await tx.menuRevision.create({
    data: {
      menuId,
      number,
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
      snapshotHash: snapshotHash(snapshot),
      goLiveAt,
      createdById: actorId,
      note,
      assetIds: snapshotAssetIds(snapshot),
    },
    select: { id: true },
  });
  return { ok: true, revisionId: revision.id, number, warnings: issues };
}

/** Cancels a revision waiting to go live. One that went live, was cancelled, or never had a time is not found. */
export function cancelSchedule(db: AnyDb, args: { menuId: string; revisionId: string; now: Date }): Promise<{ number: number }>;
export function cancelSchedule(db: ScopedTx, args: { menuId: string; revisionId: string; now: Date }): Promise<{ number: number }>;
export async function cancelSchedule(client: AnyDb | ScopedDb, args: { menuId: string; revisionId: string; now: Date }): Promise<{ number: number }> {
  const tx = delegates(client);
  const { count } = await tx.menuRevision.updateMany({
    where: { id: args.revisionId, menuId: args.menuId, goLiveAt: { not: null }, wentLiveAt: null, cancelledAt: null },
    data: { cancelledAt: args.now },
  });
  if (count === 0) throw new RevisionError('NOT_FOUND');
  const revision = await tx.menuRevision.findUniqueOrThrow({ where: { id: args.revisionId }, select: { number: true } });
  return { number: revision.number };
}

/** The menu's live addresses, to expire once a change to what is live has committed. */
async function slugsOf(tx: AnyDb, menuId: string): Promise<string[]> {
  const rows = await tx.menuSlug.findMany({ where: { menuId }, select: { slug: true } });
  return rows.map((row) => row.slug);
}

const BATCH = 100;

/**
 * Makes due revisions live (the scheduler, every minute): up to 100 whose time has come, oldest first, each in a
 * transaction of its own that takes the menu's row and reads the revision again, so two runs at once make each live
 * once. A revision of a menu archived meanwhile is cancelled. A draft menu becomes published; a suspended one stays
 * suspended. Each change has an audit row without a person.
 */
export async function activateDueRevisions(prisma: PrismaClient, now: Date): Promise<{ activated: number; cancelled: number }> {
  const due = await prisma.menuRevision.findMany({
    where: { goLiveAt: { lte: now }, wentLiveAt: null, cancelledAt: null },
    orderBy: [{ goLiveAt: 'asc' }, { number: 'asc' }],
    take: BATCH,
    select: { id: true, menuId: true },
  });
  let activated = 0;
  let cancelled = 0;
  for (const { id, menuId } of due) {
    const outcome = await prisma.$transaction(async (tx) => {
      const [menu] = await tx.menu.updateManyAndReturn({
        where: { id: menuId },
        data: { version: { increment: 1 } },
        select: { status: true, restaurantId: true },
      });
      if (!menu) return null;
      const revision = await tx.menuRevision.findUnique({ where: { id }, select: { number: true, snapshotHash: true, wentLiveAt: true, cancelledAt: true } });
      if (!revision || revision.wentLiveAt || revision.cancelledAt) return null;

      const audit = (action: string, changes: Record<string, { before: unknown; after: unknown }>) =>
        tx.auditLog.create({
          data: { actorId: null, restaurantId: menu.restaurantId, menuId, action, entityType: 'Menu', entityId: menuId, changes: changes as Prisma.InputJsonObject, userAgent: 'scheduler' },
        });
      if (menu.status === 'ARCHIVED') {
        await tx.menuRevision.update({ where: { id }, data: { cancelledAt: now } });
        await audit('menu.schedule_cancelled', { revision: { before: revision.number, after: null } });
        return { kind: 'cancelled' as const, slugs: [] };
      }
      await tx.menuRevision.update({ where: { id }, data: { wentLiveAt: now } });
      await tx.menu.update({
        where: { id: menuId },
        data: { liveRevisionId: id, liveHash: revision.snapshotHash, ...(menu.status === 'DRAFT' ? { status: 'PUBLISHED' as const } : {}) },
      });
      await audit('menu.schedule_went_live', { revision: { before: null, after: revision.number } });
      return { kind: 'activated' as const, slugs: await slugsOf(tx, menuId) };
    });
    if (!outcome) continue;
    if (outcome.kind === 'cancelled') cancelled += 1;
    else {
      activated += 1;
      expireMenu(outcome.slugs, menuId);
    }
  }
  return { activated, cancelled };
}

/** The revision a menu has waiting to go live, if any. */
export function pendingSchedule(db: AnyDb, menuId: string): Promise<{ number: number; goLiveAt: string } | null>;
export function pendingSchedule(db: ScopedTx, menuId: string): Promise<{ number: number; goLiveAt: string } | null>;
export async function pendingSchedule(client: AnyDb | ScopedDb, menuId: string): Promise<{ number: number; goLiveAt: string } | null> {
  const pending = await pendingOf(delegates(client), menuId);
  return pending ? { number: pending.number, goLiveAt: pending.goLiveAt!.toISOString() } : null;
}
