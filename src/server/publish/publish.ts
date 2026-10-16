import type { Prisma } from '@/generated/prisma/client';
import { delegates, type AnyDb, type ScopedDb, type ScopedTx } from '@/server/data/tenant-db';
import { validateForPublish, type PublishIssue } from '@/server/domain/publish-rules';
import { SNAPSHOT_SCHEMA_VERSION, snapshotHash } from '@/server/domain/snapshot';
import { loadDraftSnapshot } from './draft';

export type PublishErrorCode = 'ARCHIVED' | 'NOT_FOUND';

/** A publish that cannot be attempted at all, as opposed to one that is blocked by issues in the menu. */
export class PublishError extends Error {
  readonly code: PublishErrorCode;

  constructor(code: PublishErrorCode, menuId: string) {
    super(code === 'ARCHIVED' ? `Menu ${menuId} is archived and cannot be published` : `Menu ${menuId} does not exist`);
    this.name = 'PublishError';
    this.code = code;
  }
}

export interface PublishArgs {
  menuId: string;
  /** Who published; null for the seed and other scripts. */
  actorId: string | null;
  note?: string;
  now: Date;
}

export type PublishOutcome =
  | { ok: true; revisionId: string; number: number; warnings: PublishIssue[] }
  | { ok: false; issues: PublishIssue[] };

/**
 * Freezes the menu's draft into a new revision and makes it live. Runs in the caller's transaction
 * (`prisma.$transaction((tx) => publishMenu(tx, ...))`), so the caller can add its audit entry to the same commit and
 * expire the cache (`expireMenu`) once it has committed.
 *
 * The first statement takes the menu row with a version increment. A second publish of the same menu waits on that
 * row until the first commits, then reads the draft and the revision numbers as the first left them, so concurrent
 * publishes get consecutive numbers. A blocked publish writes nothing but that increment, which the caller rolls back
 * if it fails the action.
 *
 * Throws `PublishError` for a missing or archived menu. A suspended menu gets its revision and stays suspended; a
 * draft becomes PUBLISHED.
 */
export function publishMenu(tx: AnyDb, args: PublishArgs): Promise<PublishOutcome>;
export function publishMenu(tx: ScopedTx, args: PublishArgs): Promise<PublishOutcome>;
export async function publishMenu(client: AnyDb | ScopedDb, args: PublishArgs): Promise<PublishOutcome> {
  const tx = delegates(client);
  const { menuId, actorId, note = '', now } = args;

  const [menu] = await tx.menu.updateManyAndReturn({
    where: { id: menuId },
    data: { version: { increment: 1 } },
    select: { status: true },
  });
  if (!menu) throw new PublishError('NOT_FOUND', menuId);
  if (menu.status === 'ARCHIVED') throw new PublishError('ARCHIVED', menuId);

  const snapshot = await loadDraftSnapshot(tx, menuId);
  const issues = validateForPublish(snapshot);
  if (issues.some((issue) => issue.severity === 'block')) return { ok: false, issues };

  const latest = await tx.menuRevision.aggregate({ where: { menuId }, _max: { number: true } });
  const number = (latest._max.number ?? 0) + 1;
  const hash = snapshotHash(snapshot);
  const revision = await tx.menuRevision.create({
    data: {
      // Named explicitly: a menu-scoped client would stamp it anyway, an unscoped one needs it.
      menuId,
      number,
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
      snapshotHash: hash,
      wentLiveAt: now,
      createdById: actorId,
      note,
    },
    select: { id: true },
  });

  await tx.menu.update({
    where: { id: menuId },
    data: {
      liveRevisionId: revision.id,
      liveHash: hash,
      // The draft is exactly what was just published.
      draftHash: hash,
      ...(menu.status === 'DRAFT' ? { status: 'PUBLISHED' as const } : {}),
    },
  });

  return { ok: true, revisionId: revision.id, number, warnings: issues };
}
