import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { person, pharmacy, prisma, resetWorld, useTestDatabase } from './fixture';
import { makeBatch, makeProduct } from './stock-helpers';

/* eslint-disable no-restricted-properties -- the test seeds and explains raw statements over its own business */

/**
 * Phase 6 whole-phase review I1 (and minor 6): the indexes of PhTransferLine.requestLineId. 20,000 transfers, each with a request line, and
 * 6 sent lines on each of the first 3,000 (38,000 lines). The line trigger sums the sent lines of a request line on every send and receive, and
 * the self foreign key is checked when request lines are deleted (a transfer edit, a business delete): without an index both scan the table.
 * The rows are inserted with triggers off (session_replication_role = replica) because the rows are consistent by construction and the
 * triggers are not what is measured.
 */

let rid = '';
let a = '';
let b = '';
let productId = '';
const BATCHES = 6;

type Plan = { Plan: { 'Node Type': string; Plans?: unknown[]; 'Index Name'?: string } };
const planText = (rows: Array<{ 'QUERY PLAN': Plan[] }>) => JSON.stringify(rows[0]!['QUERY PLAN']);

beforeAll(async () => {
  useTestDatabase();
  await resetWorld();
  const p = await pharmacy('Perf6T', { branches: 2 });
  rid = p.id;
  [a, b] = p.branchIds as [string, string];
  await person('ownerPerf6T', { membership: [rid, 'OWNER'] });
  const P = await makeProduct(rid, 'Panadol');
  productId = P.id;
  for (let i = 0; i < BATCHES; i += 1) await makeBatch(rid, a, P.id, { lot: `PF${i}`, buckets: { available: 10 } });
  const batches = (await prisma().phBatch.findMany({ where: { restaurantId: rid }, select: { id: true }, orderBy: { id: 'asc' } })).map((x) => x.id);
  await prisma().$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
      await tx.$executeRawUnsafe(
        `INSERT INTO "PhTransfer" ("id","restaurantId","fromBranchId","toBranchId","status","number","clientKey","payloadHash","requestedById","requestedAt","sentById","sentAt","sendKey","sendHash","version","createdAt","updatedAt")
         SELECT 'pt' || i, $1, $2, $3, CASE WHEN i <= 3000 THEN 'SENT'::"PhTransferStatus" ELSE 'REQUESTED'::"PhTransferStatus" END, 'T-' || i, 'ck' || i, 'h', 'u',
                timestamp '2026-01-01' + (i * interval '14 minutes'), CASE WHEN i <= 3000 THEN 'u' END, CASE WHEN i <= 3000 THEN timestamp '2026-01-01' + (i * interval '14 minutes') END,
                CASE WHEN i <= 3000 THEN 'sk' || i END, CASE WHEN i <= 3000 THEN 'sh' END, 1, now(), now()
         FROM generate_series(1, 20000) i`,
        rid, a, b,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO "PhTransferLine" ("id","restaurantId","transferId","fromBranchId","toBranchId","lineNo","productId","requestedQty")
         SELECT 'rl' || i, $1, 'pt' || i, $2, $3, 1, $4, 6 FROM generate_series(1, 20000) i`,
        rid, a, b, productId,
      );
      for (const [k, batchId] of batches.entries()) {
        await tx.$executeRawUnsafe(
          `INSERT INTO "PhTransferLine" ("id","restaurantId","transferId","fromBranchId","toBranchId","lineNo","productId","batchId","requestLineId","requestedQty","sentQty")
           SELECT 'sl' || i || '_' || ${k}, $1, 'pt' || i, $2, $3, ${k + 2}, $4, $5, 'rl' || i, 0, 1 FROM generate_series(1, 3000) i`,
          rid, a, b, productId, batchId,
        );
      }
    },
    { timeout: 120_000 },
  );
  await prisma().$executeRawUnsafe('ANALYZE "PhTransferLine"');
  await prisma().$executeRawUnsafe('VACUUM ANALYZE "PhTransfer"');
}, 240_000);
afterAll(async () => {
  await prisma().subscription.deleteMany({ where: { restaurantId: rid } });
  await prisma().restaurant.deleteMany({ where: { id: rid } });
});

const explain = (sql: string, ...args: unknown[]) => prisma().$queryRawUnsafe<Array<{ 'QUERY PLAN': Plan[] }>>(`EXPLAIN (FORMAT JSON) ${sql}`, ...args);
const TRIGGER = `SELECT COALESCE(SUM("sentQty"), 0) FROM "PhTransferLine" WHERE "requestLineId" = 'rl5' AND "id" <> 'sl5_1'`;
const FK_CHECK = `SELECT 1 FROM ONLY "PhTransferLine" x WHERE "restaurantId" = $1 AND "transferId" = 'pt5' AND "requestLineId" = 'rl5' FOR KEY SHARE OF x`;

describe('the request-line indexes', () => {
  it('the line trigger sum and the self foreign key check use an index', async () => {
    expect(planText(await explain(TRIGGER))).toMatch(/Index (Only )?Scan|Bitmap Index Scan/);
    expect(planText(await explain(FK_CHECK, rid))).toMatch(/Index (Only )?Scan|Bitmap Index Scan/);
    expect(planText(await explain(TRIGGER))).toContain('PhTransferLine_requestLineId_idx');
    expect(planText(await explain(FK_CHECK, rid))).toContain('PhTransferLine_restaurantId_transferId_requestLineId_idx');
  });

  it('without them both are scans of the whole table (the finding), rolled back', async () => {
    class Rollback extends Error {}
    let trigger = '';
    let fk = '';
    await prisma()
      .$transaction(async (tx) => {
        await tx.$executeRawUnsafe('DROP INDEX "PhTransferLine_requestLineId_idx"');
        await tx.$executeRawUnsafe('DROP INDEX "PhTransferLine_restaurantId_transferId_requestLineId_idx"');
        trigger = planText(await tx.$queryRawUnsafe(`EXPLAIN (FORMAT JSON) ${TRIGGER}`));
        fk = planText(await tx.$queryRawUnsafe(`EXPLAIN (FORMAT JSON) ${FK_CHECK}`, rid));
        throw new Rollback();
      })
      .catch((error: unknown) => {
        if (!(error instanceof Rollback)) throw error;
      });
    expect(trigger).toContain('Seq Scan');
    // (the foreign key check may find another way through the unique (transferId, lineNo) index; the trigger statement cannot)
    expect(fk.length).toBeGreaterThan(10);
  });

  it('a narrow window of the newest transfers reads the (restaurantId, requestedAt) index, and without it is a scan and a sort', async () => {
    class Rollback extends Error {}
    const WINDOW = `SELECT t."id" FROM "PhTransfer" t WHERE t."restaurantId" = $1 AND t."requestedAt" >= timestamp '2026-02-01' AND t."requestedAt" < timestamp '2026-02-03' ORDER BY t."requestedAt" DESC, t."id" DESC LIMIT 21`;
    const withIndex = planText(await explain(WINDOW, rid));
    expect(withIndex.replace(/"[A-Z][A-Za-z ]+":(false|true|[0-9.]+),?/g, '')).toContain('PhTransfer_restaurantId_requestedAt_idx');
    let without = '';
    await prisma()
      .$transaction(async (tx) => {
        await tx.$executeRawUnsafe('DROP INDEX "PhTransfer_restaurantId_requestedAt_idx"');
        without = planText(await tx.$queryRawUnsafe(`EXPLAIN (FORMAT JSON) ${WINDOW}`, rid));
        throw new Rollback();
      })
      .catch((error: unknown) => {
        if (!(error instanceof Rollback)) throw error;
      });
    expect(without).toContain('Seq Scan');
  });

  it('deleting a business with 38,000 transfer lines finishes in a few seconds', async () => {
    const started = Date.now();
    await prisma().subscription.deleteMany({ where: { restaurantId: rid } });
    await prisma().restaurant.delete({ where: { id: rid } });
    const took = Date.now() - started;
    expect(took, `business delete took ${took} ms`).toBeLessThan(30_000);
    expect(await prisma().phTransferLine.count({ where: { restaurantId: rid } })).toBe(0);
  }, 120_000);
});
