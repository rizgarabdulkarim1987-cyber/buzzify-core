/* eslint-disable no-restricted-properties -- read-only aggregates: every statement below is bound to the actor's restaurantId and branch ids, and none of them writes */
import { z } from 'zod';
import { Prisma } from '@/generated/prisma/client';
import type { ScopedClient } from '@/server/data/tenant-db';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from './actor';
import { mayViewCost } from './products';
import { money, pagingShape, periodShape, scopeOf, sortBy, stamp, windowOf, type Currency } from './reports-common';
import { HAS_COST, valueOf } from './reports-stock';

/**
 * Pharmacy reports, part 3: what left the stock or went bad (damaged, quarantined, lost) and the transfers between branches
 * (phase 6, task 4; R6-7). Same rules as the other reports: read-only SQL, the actor's branches, one currency per money total,
 * cost keys present only with `cost.view`.
 */

export const TRANSFER_STATUSES = ['REQUESTED', 'SENT', 'RECEIVED', 'PARTIAL', 'CANCELLED'] as const;
export const transfersReportInput = z.object({ ...periodShape, status: z.enum(TRANSFER_STATUSES, 'Choose a status').optional(), ...pagingShape });
export type TransfersReportInput = z.input<typeof transfersReportInput>;
export const damagedInput = z.object({ ...periodShape });
export type DamagedInput = z.input<typeof damagedInput>;

/** Merges rows that share a key (after the id of a branch outside the person's reach was blanked). */
function mergeBy<T>(items: T[], key: (t: T) => string, add: (a: T, b: T) => T): T[] {
  const out = new Map<string, T>();
  for (const item of items) {
    const k = key(item);
    const had = out.get(k);
    out.set(k, had === undefined ? item : add(had, item));
  }
  return [...out.values()];
}

// Damaged, quarantined and lost ------------------------------------------------------------------------------------------

export interface DamagedReport {
  from: string;
  to: string;
  /** Stock in the DAMAGED and QUARANTINE buckets now. */
  current: {
    totals: { damaged: number; quarantine: number; noCostRows?: number; values?: Array<{ currency: Currency; damagedValueMinor: string; quarantineValueMinor: string }> };
    byBranch: Array<{ branchId: string; damaged: number; quarantine: number }>;
  };
  /**
   * Units that left the stock or went bad in the range, by ledger type: DAMAGE (into damaged), ADJUST (taken out, or moved into
   * damaged) and SUPPLIER_RETURN (taken out). Never netted against units that came in; a reversed movement and its reversal are
   * left out. `noCostRows` counts the movements whose batch has no cost: they have no value, and are not valued as zero.
   */
  movements: {
    totals: Array<{ type: 'DAMAGE' | 'ADJUST' | 'SUPPLIER_RETURN'; units: number; noCostRows?: number; values?: Array<{ currency: Currency; valueMinor: string }> }>;
    byBranch: Array<{ branchId: string; type: 'DAMAGE' | 'ADJUST' | 'SUPPLIER_RETURN'; units: number }>;
    reasons: Array<{ type: 'DAMAGE' | 'ADJUST' | 'SUPPLIER_RETURN'; reason: string; units: number }>;
  };
  /** Transfers received in the range: what did not arrive. */
  transfers: {
    totals: { lostQty: number; damagedQty: number; noCostRows?: number; values?: Array<{ currency: Currency; lostValueMinor: string; damagedValueMinor: string }> };
    byRoute: Array<{ fromBranchId: string; toBranchId: string; lostQty: number; damagedQty: number }>;
    byReason: Array<{ reason: 'LOST' | 'OTHER'; lostQty: number }>;
  };
}

export async function damagedReport(scoped: ScopedClient, ph: PhActor, place: { branchId?: string | undefined }, input: z.infer<typeof damagedInput>): Promise<DamagedReport> {
  const scope = scopeOf(ph, place.branchId);
  const w = windowOf(input.from, input.to);
  const withCost = mayViewCost(ph);
  const branchOf = (col: string) => Prisma.sql`${Prisma.raw(col)} = ANY(${scope.branchIds}::text[])`;
  const costJoin = Prisma.sql`JOIN "PhBatch" b ON b."restaurantId" = x."restaurantId" AND b."id" = x."batchId" LEFT JOIN "PhProductUnit" cu ON cu."productId" = b."productId" AND cu."id" = b."costUnitId"`;
  // A ledger row's size is what LEFT the stock or went bad, never what came in: DAMAGE counts the units into damaged; ADJUST and
  // SUPPLIER_RETURN count the units taken out (the negative part of the row) and, for an ADJUST that only moves units between
  // buckets, the units moved into damaged. An "in" adjustment is not netted against them. A reversed row and its reversal both
  // stand out of the report (they cancel).
  const delta = Prisma.sql`(x."availableDelta" + x."reservedDelta" + x."quarantineDelta" + x."damagedDelta")`;
  const size = Prisma.sql`CASE x."type"::text
    WHEN 'DAMAGE' THEN GREATEST(x."damagedDelta", 0)
    WHEN 'ADJUST' THEN GREATEST(-${delta}, 0) + CASE WHEN ${delta} = 0 THEN GREATEST(x."damagedDelta", 0) ELSE 0 END
    ELSE GREATEST(-${delta}, 0) END`;
  const standing = Prisma.sql`x."reversesId" IS NULL AND NOT EXISTS (SELECT 1 FROM "PhStockMovement" r WHERE r."restaurantId" = x."restaurantId" AND r."reversesId" = x."id")`;
  const ledgerWhere = Prisma.sql`x."restaurantId" = ${scope.restaurantId} AND ${branchOf('x."branchId"')} AND x."type"::text IN ('DAMAGE', 'ADJUST', 'SUPPLIER_RETURN')
    AND x."createdAt" >= ${stamp(w.start)} AND x."createdAt" < ${stamp(w.endExclusive)} AND ${standing}`;
  const ledger = Prisma.sql`FROM "PhStockMovement" x WHERE ${ledgerWhere}`;
  const lines = Prisma.sql`FROM "PhTransferLine" x JOIN "PhTransfer" t ON t."restaurantId" = x."restaurantId" AND t."id" = x."transferId"
    WHERE t."restaurantId" = ${scope.restaurantId} AND t."status"::text IN ('RECEIVED', 'PARTIAL') AND x."requestLineId" IS NOT NULL
      AND (${branchOf('t."fromBranchId"')} OR ${branchOf('t."toBranchId"')}) AND t."receivedAt" >= ${stamp(w.start)} AND t."receivedAt" < ${stamp(w.endExclusive)}`;
  const empty = Promise.resolve([] as never[]);

  const [cur, curValue, moveQty, moveValue, reasons, tQty, tRoute, tReason, tValue] = await Promise.all([
    scoped.$queryRaw<Array<{ gb: number; branchId: string | null; damaged: number; quarantine: number; nocost: number }>>(Prisma.sql`
      SELECT GROUPING(x."branchId")::int AS "gb", x."branchId", SUM(x."damaged")::int AS "damaged", SUM(x."quarantine")::int AS "quarantine",
             (COUNT(*) FILTER (WHERE NOT (${HAS_COST}) AND (x."damaged" + x."quarantine") > 0))::int AS "nocost"
      FROM "PhStockBalance" x JOIN "PhBatch" b ON b."restaurantId" = x."restaurantId" AND b."id" = x."batchId" LEFT JOIN "PhProductUnit" cu ON cu."productId" = b."productId" AND cu."id" = b."costUnitId"
      WHERE x."restaurantId" = ${scope.restaurantId} AND ${branchOf('x."branchId"')} AND (x."damaged" > 0 OR x."quarantine" > 0)
      GROUP BY GROUPING SETS ((), (x."branchId"))`),
    withCost
      ? scoped.$queryRaw<Array<{ cur: Currency; damaged: bigint; quarantine: bigint }>>(Prisma.sql`
          SELECT b."costCurrency"::text AS "cur", COALESCE(SUM(${valueOf(Prisma.sql`x."damaged"`)}), 0)::bigint AS "damaged", COALESCE(SUM(${valueOf(Prisma.sql`x."quarantine"`)}), 0)::bigint AS "quarantine"
          FROM "PhStockBalance" x ${costJoin}
          WHERE x."restaurantId" = ${scope.restaurantId} AND ${branchOf('x."branchId"')} AND (x."damaged" > 0 OR x."quarantine" > 0) AND ${HAS_COST} GROUP BY b."costCurrency"`)
      : empty,
    scoped.$queryRaw<Array<{ gb: number; branchId: string | null; type: 'DAMAGE' | 'ADJUST' | 'SUPPLIER_RETURN'; units: number }>>(Prisma.sql`
      SELECT GROUPING(x."branchId")::int AS "gb", x."branchId", x."type"::text AS "type", COALESCE(SUM(${size}), 0)::int AS "units"
      ${ledger} GROUP BY GROUPING SETS ((x."type"), (x."type", x."branchId"))`),
    withCost
      ? scoped.$queryRaw<Array<{ type: 'DAMAGE' | 'ADJUST' | 'SUPPLIER_RETURN'; cur: Currency | null; value: bigint; nocost: number }>>(Prisma.sql`
          SELECT x."type"::text AS "type", b."costCurrency"::text AS "cur",
                 COALESCE(SUM(floor(b."unitCostMinor"::numeric * (${size}) / cu."baseQty")::bigint) FILTER (WHERE ${HAS_COST}), 0)::bigint AS "value",
                 (COUNT(*) FILTER (WHERE NOT (${HAS_COST})))::int AS "nocost"
          FROM "PhStockMovement" x ${costJoin}
          WHERE ${ledgerWhere} AND (${size}) > 0
          GROUP BY x."type", b."costCurrency"`)
      : empty,
    scoped.$queryRaw<Array<{ type: 'DAMAGE' | 'ADJUST' | 'SUPPLIER_RETURN'; reason: string; units: number }>>(Prisma.sql`
      SELECT x."type"::text AS "type", x."reason", SUM(${size})::int AS "units" ${ledger} AND x."reason" <> ''
      GROUP BY x."type", x."reason" HAVING SUM(${size}) > 0 ORDER BY SUM(${size}) DESC, x."type", x."reason" LIMIT 30`),
    scoped.$queryRaw<Array<{ lost: number; damaged: number }>>(Prisma.sql`SELECT COALESCE(SUM(x."lostQty"), 0)::int AS "lost", COALESCE(SUM(x."damagedQty"), 0)::int AS "damaged" ${lines}`),
    scoped.$queryRaw<Array<{ f: string; t: string; lost: number; damaged: number }>>(Prisma.sql`
      SELECT t."fromBranchId" AS "f", t."toBranchId" AS "t", SUM(x."lostQty")::int AS "lost", SUM(x."damagedQty")::int AS "damaged" ${lines}
      GROUP BY t."fromBranchId", t."toBranchId" HAVING SUM(x."lostQty") + SUM(x."damagedQty") > 0`),
    scoped.$queryRaw<Array<{ reason: 'LOST' | 'OTHER'; lost: number }>>(Prisma.sql`
      SELECT x."lostReason"::text AS "reason", SUM(x."lostQty")::int AS "lost" ${lines} AND x."lostQty" > 0 GROUP BY x."lostReason"`),
    withCost
      ? scoped.$queryRaw<Array<{ cur: Currency | null; lost: bigint; damaged: bigint; nocost: number }>>(Prisma.sql`
          SELECT b."costCurrency"::text AS "cur", COALESCE(SUM(${valueOf(Prisma.sql`x."lostQty"`)}) FILTER (WHERE ${HAS_COST}), 0)::bigint AS "lost",
                 COALESCE(SUM(${valueOf(Prisma.sql`x."damagedQty"`)}) FILTER (WHERE ${HAS_COST}), 0)::bigint AS "damaged",
                 (COUNT(*) FILTER (WHERE NOT (${HAS_COST})))::int AS "nocost"
          FROM "PhTransferLine" x JOIN "PhTransfer" t ON t."restaurantId" = x."restaurantId" AND t."id" = x."transferId"
            JOIN "PhBatch" b ON b."restaurantId" = x."restaurantId" AND b."id" = x."batchId" LEFT JOIN "PhProductUnit" cu ON cu."productId" = b."productId" AND cu."id" = b."costUnitId"
          WHERE t."restaurantId" = ${scope.restaurantId} AND t."status"::text IN ('RECEIVED', 'PARTIAL') AND x."requestLineId" IS NOT NULL
            AND (${branchOf('t."fromBranchId"')} OR ${branchOf('t."toBranchId"')}) AND t."receivedAt" >= ${stamp(w.start)} AND t."receivedAt" < ${stamp(w.endExclusive)} AND (x."lostQty" + x."damagedQty") > 0
          GROUP BY b."costCurrency"`)
      : empty,
  ]);

  const total = cur.find((r) => r.gb === 1);
  const types = ['DAMAGE', 'ADJUST', 'SUPPLIER_RETURN'] as const;
  return {
    from: input.from,
    to: input.to,
    current: {
      totals: {
        damaged: total?.damaged ?? 0,
        quarantine: total?.quarantine ?? 0,
        ...(withCost
          ? {
              noCostRows: total?.nocost ?? 0,
              values: sortBy(curValue.map((v) => ({ currency: v.cur, damagedValueMinor: money(v.damaged), quarantineValueMinor: money(v.quarantine) })), (r) => r.currency),
            }
          : {}),
      },
      byBranch: sortBy(
        cur.filter((r) => r.gb === 0).map((r) => ({ branchId: r.branchId!, damaged: r.damaged, quarantine: r.quarantine })),
        (r) => r.branchId,
      ),
    },
    movements: {
      totals: types.map((type) => ({
        type,
        units: moveQty.find((r) => r.gb === 1 && r.type === type)?.units ?? 0,
        ...(withCost
          ? {
              noCostRows: moveValue.filter((v) => v.type === type).reduce((n, v) => n + v.nocost, 0),
              values: sortBy(moveValue.filter((v) => v.type === type && v.cur !== null).map((v) => ({ currency: v.cur!, valueMinor: money(v.value) })), (r) => r.currency),
            }
          : {}),
      })),
      byBranch: sortBy(
        moveQty.filter((r) => r.gb === 0).map((r) => ({ branchId: r.branchId!, type: r.type, units: r.units })),
        (r) => r.branchId,
        (r) => r.type,
      ),
      reasons,
    },
    transfers: {
      totals: {
        lostQty: tQty[0]?.lost ?? 0,
        damagedQty: tQty[0]?.damaged ?? 0,
        ...(withCost
          ? {
              noCostRows: tValue.reduce((n, v) => n + v.nocost, 0),
              values: sortBy(tValue.filter((v) => v.cur !== null).map((v) => ({ currency: v.cur!, lostValueMinor: money(v.lost), damagedValueMinor: money(v.damaged) })), (r) => r.currency),
            }
          : {}),
      },
      byRoute: sortBy(
        mergeBy(tRoute.map((r) => ({ fromBranchId: ph.branchIds.includes(r.f) ? r.f : '', toBranchId: ph.branchIds.includes(r.t) ? r.t : '', lostQty: r.lost, damagedQty: r.damaged })), (r) => `${r.fromBranchId}|${r.toBranchId}`, (a, b) => ({ ...a, lostQty: a.lostQty + b.lostQty, damagedQty: a.damagedQty + b.damagedQty })),
        (r) => r.fromBranchId,
        (r) => r.toBranchId,
      ),
      byReason: sortBy(tReason.map((r) => ({ reason: r.reason, lostQty: r.lost })), (r) => r.reason),
    },
  };
}

// Transfers --------------------------------------------------------------------------------------------------------------

export interface TransferReportRow {
  id: string;
  number: string | null;
  fromBranchId: string;
  fromBranchName: string;
  toBranchId: string;
  toBranchName: string;
  status: (typeof TRANSFER_STATUSES)[number];
  requestedAt: string;
  sentAt: string | null;
  receivedAt: string | null;
  requestedQty: number;
  sentQty: number;
  receivedQty: number;
  lostQty: number;
  damagedQty: number;
}

export interface TransfersReport {
  from: string;
  to: string;
  /**
   * Which transfers these are: every one that touches a branch of the report. A transfer between two branches of the report is
   * counted once in the all-branches answer and once in EACH narrowed answer that includes one of its ends, so per-branch calls
   * must not be added up: take the figure from the all-branches call (its `byBranch` is by sending branch and adds up to `total`).
   */
  scope: 'transfers-touching-the-branches-shown';
  /** Transfers requested in the range that touch the actor's branches. `byBranch` counts them by sending branch, so it adds up to `total`. */
  total: number;
  byStatus: Array<{ status: (typeof TRANSFER_STATUSES)[number]; count: number }>;
  byBranch: Array<{ branchId: string; count: number }>;
  byRoute: Array<{ fromBranchId: string; toBranchId: string; status: (typeof TRANSFER_STATUSES)[number]; count: number }>;
  /** Sent and not received, now (not limited to the range), in units. */
  inTransit: { units: number; transfers: number; byRoute: Array<{ fromBranchId: string; toBranchId: string; units: number }> };
  lost: { lostQty: number; damagedQty: number; byReason: Array<{ reason: 'LOST' | 'OTHER'; lostQty: number }> };
  /** Mean time from sent to received over the received ones; null when none. */
  avgTransitSeconds: number | null;
  rows: TransferReportRow[];
  hasMore: boolean;
  nextCursor: string | null;
}

export async function transfersReport(scoped: ScopedClient, ph: PhActor, place: { branchId?: string | undefined }, input: z.infer<typeof transfersReportInput>): Promise<TransfersReport> {
  const scope = scopeOf(ph, place.branchId);
  const w = windowOf(input.from, input.to);
  const touches = Prisma.sql`(t."fromBranchId" = ANY(${scope.branchIds}::text[]) OR t."toBranchId" = ANY(${scope.branchIds}::text[]))`;
  const base = Prisma.sql`t."restaurantId" = ${scope.restaurantId} AND ${touches} AND t."requestedAt" >= ${stamp(w.start)} AND t."requestedAt" < ${stamp(w.endExclusive)}
    ${input.status ? Prisma.sql`AND t."status"::text = ${input.status}` : Prisma.empty}`;
  let after = Prisma.empty;
  if (input.cursor) {
    const at = await scoped.$queryRaw<Array<{ requestedAt: Date }>>(Prisma.sql`SELECT t."requestedAt" FROM "PhTransfer" t WHERE t."id" = ${input.cursor} AND t."restaurantId" = ${scope.restaurantId} AND ${touches}`);
    if (!at[0]) throw new StudioError('INVALID', 'Check the highlighted fields', { cursor: 'This page of results is no longer available' });
    after = Prisma.sql`AND (t."requestedAt" < ${stamp(at[0].requestedAt)} OR (t."requestedAt" = ${stamp(at[0].requestedAt)} AND t."id" < ${input.cursor}))`;
  }
  const sentLines = Prisma.sql`l."requestLineId" IS NOT NULL`;
  // Lost and damaged units and the time in transit are known when the transfer is RECEIVED, so they are cut by the day it was received (the same axis as the
  // damaged report, R6-17a); every other figure of this report is cut by the day the transfer was requested.
  const receivedBase = Prisma.sql`t."restaurantId" = ${scope.restaurantId} AND ${touches} AND t."status"::text IN ('RECEIVED', 'PARTIAL') AND t."receivedAt" >= ${stamp(w.start)} AND t."receivedAt" < ${stamp(w.endExclusive)}
    ${input.status ? Prisma.sql`AND t."status"::text = ${input.status}` : Prisma.empty}`;
  const [groups, rows, open, lost, lostReasons, avg] = await Promise.all([
    scoped.$queryRaw<Array<{ g: number; status: TransfersReport['byStatus'][number]['status'] | null; f: string | null; t: string | null; n: number }>>(Prisma.sql`
      SELECT GROUPING(t."status", t."fromBranchId", t."toBranchId")::int AS "g", t."status"::text AS "status", t."fromBranchId" AS "f", t."toBranchId" AS "t", COUNT(*)::int AS "n"
      FROM "PhTransfer" t WHERE ${base}
      GROUP BY GROUPING SETS ((), (t."status"), (t."fromBranchId"), (t."fromBranchId", t."toBranchId", t."status"))`),
    scoped.$queryRaw<Array<Omit<TransferReportRow, 'requestedAt' | 'sentAt' | 'receivedAt'> & { requestedAt: Date; sentAt: Date | null; receivedAt: Date | null }>>(Prisma.sql`
      SELECT t."id", t."number", t."fromBranchId", fb."name" AS "fromBranchName", t."toBranchId", tb."name" AS "toBranchName", t."status"::text AS "status",
             t."requestedAt", t."sentAt", t."receivedAt",
             COALESCE(SUM(l."requestedQty"), 0)::int AS "requestedQty", COALESCE(SUM(l."sentQty"), 0)::int AS "sentQty", COALESCE(SUM(l."receivedQty"), 0)::int AS "receivedQty",
             COALESCE(SUM(l."lostQty"), 0)::int AS "lostQty", COALESCE(SUM(l."damagedQty"), 0)::int AS "damagedQty"
      FROM "PhTransfer" t JOIN "Branch" fb ON fb."restaurantId" = t."restaurantId" AND fb."id" = t."fromBranchId" JOIN "Branch" tb ON tb."restaurantId" = t."restaurantId" AND tb."id" = t."toBranchId"
        LEFT JOIN "PhTransferLine" l ON l."restaurantId" = t."restaurantId" AND l."transferId" = t."id"
      WHERE ${base} ${after}
      GROUP BY t."id", fb."name", tb."name" ORDER BY t."requestedAt" DESC, t."id" DESC LIMIT ${input.take + 1}`),
    scoped.$queryRaw<Array<{ f: string; t: string; units: number; transfers: number }>>(Prisma.sql`
      SELECT t."fromBranchId" AS "f", t."toBranchId" AS "t", SUM(GREATEST(l."sentQty" - l."receivedQty" - l."damagedQty" - l."lostQty", 0))::int AS "units", COUNT(DISTINCT t."id")::int AS "transfers"
      FROM "PhTransferLine" l JOIN "PhTransfer" t ON t."restaurantId" = l."restaurantId" AND t."id" = l."transferId"
      WHERE t."restaurantId" = ${scope.restaurantId} AND ${touches} AND t."status" = 'SENT' AND ${sentLines} GROUP BY t."fromBranchId", t."toBranchId"`),
    scoped.$queryRaw<Array<{ lost: number; damaged: number }>>(Prisma.sql`
      SELECT COALESCE(SUM(l."lostQty"), 0)::int AS "lost", COALESCE(SUM(l."damagedQty"), 0)::int AS "damaged"
      FROM "PhTransferLine" l JOIN "PhTransfer" t ON t."restaurantId" = l."restaurantId" AND t."id" = l."transferId" WHERE ${receivedBase} AND ${sentLines}`),
    scoped.$queryRaw<Array<{ reason: 'LOST' | 'OTHER'; lost: number }>>(Prisma.sql`
      SELECT l."lostReason"::text AS "reason", SUM(l."lostQty")::int AS "lost"
      FROM "PhTransferLine" l JOIN "PhTransfer" t ON t."restaurantId" = l."restaurantId" AND t."id" = l."transferId" WHERE ${receivedBase} AND ${sentLines} AND l."lostQty" > 0 GROUP BY l."lostReason"`),
    scoped.$queryRaw<Array<{ secs: bigint | null }>>(Prisma.sql`
      SELECT ROUND(AVG(EXTRACT(EPOCH FROM (t."receivedAt" - t."sentAt"))))::bigint AS "secs"
      FROM "PhTransfer" t WHERE ${receivedBase} AND t."sentAt" IS NOT NULL AND t."receivedAt" IS NOT NULL`),
  ]);
  const more = rows.length > input.take;
  const page = more ? rows.slice(0, input.take) : rows;
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  // R6-17: the other end of a transfer is shown only when it is a branch the person works in; otherwise it is "other branch" (empty id, empty name).
  const reach = new Set(ph.branchIds);
  const mask = (id: string) => (reach.has(id) ? id : '');
  return {
    from: input.from,
    to: input.to,
    scope: 'transfers-touching-the-branches-shown',
    total: groups.find((g) => g.g === 7)?.n ?? 0,
    byStatus: sortBy(
      groups.filter((g) => g.g === 3 && g.status !== null).map((g) => ({ status: g.status!, count: g.n })),
      (r) => r.status,
    ),
    byBranch: sortBy(
      mergeBy(groups.filter((g) => g.g === 5 && g.f !== null).map((g) => ({ branchId: mask(g.f!), count: g.n })), (r) => r.branchId, (a, b) => ({ ...a, count: a.count + b.count })),
      (r) => r.branchId,
    ),
    byRoute: sortBy(
      mergeBy(groups.filter((g) => g.g === 0).map((g) => ({ fromBranchId: mask(g.f!), toBranchId: mask(g.t!), status: g.status!, count: g.n })), (r) => `${r.fromBranchId}|${r.toBranchId}|${r.status}`, (a, b) => ({ ...a, count: a.count + b.count })),
      (r) => r.fromBranchId,
      (r) => r.toBranchId,
      (r) => r.status,
    ),
    inTransit: {
      units: open.reduce((s, r) => s + r.units, 0),
      transfers: open.reduce((s, r) => s + r.transfers, 0),
      byRoute: sortBy(mergeBy(open.map((r) => ({ fromBranchId: mask(r.f), toBranchId: mask(r.t), units: r.units })), (r) => `${r.fromBranchId}|${r.toBranchId}`, (a, b) => ({ ...a, units: a.units + b.units })), (r) => r.fromBranchId, (r) => r.toBranchId),
    },
    lost: { lostQty: lost[0]?.lost ?? 0, damagedQty: lost[0]?.damaged ?? 0, byReason: sortBy(lostReasons.map((r) => ({ reason: r.reason, lostQty: r.lost })), (r) => r.reason) },
    avgTransitSeconds: avg[0]?.secs === null || avg[0]?.secs === undefined ? null : Number(avg[0].secs),
    rows: page.map((r) => ({ ...r, fromBranchId: mask(r.fromBranchId), fromBranchName: reach.has(r.fromBranchId) ? r.fromBranchName : '', toBranchId: mask(r.toBranchId), toBranchName: reach.has(r.toBranchId) ? r.toBranchName : '', requestedAt: r.requestedAt.toISOString(), sentAt: iso(r.sentAt), receivedAt: iso(r.receivedAt) })),
    hasMore: more,
    nextCursor: more ? page[page.length - 1]!.id : null,
  };
}

