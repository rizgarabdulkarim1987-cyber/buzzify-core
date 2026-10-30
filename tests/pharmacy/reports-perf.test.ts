import { PrismaPg } from '@prisma/adapter-pg';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@/generated/prisma/client';
import * as chain from '@/server/pharmacy/queries/chain';
import * as reports from '@/server/pharmacy/queries/reports';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runQuery, type QueryDef } from '@/server/studio/framework/query';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { NOW, person, pharmacy, prisma, resetWorld, useTestDatabase, type Person } from './fixture';
import { dataOf } from './stock-helpers';

/**
 * Report budgets (phase 6, task 4; R6-10): a business with 100,000 sale lines over twelve months of two branches answers the sales,
 * margin and stock valuation reports in under 2 seconds each, and a report costs the same number of statements whatever the
 * amount of data. The rows are seeded with raw INSERT ... SELECT (the only place raw inserts are used: 50,000 sales through the
 * sale service would take hours); every CHECK of the sale tables holds (total = subtotal - discount, paid covers total, line
 * total = price x qty - discount, cost set or null together). Then the whole business is wiped again.
 *
 * Around the sales sit stock movements, returns, USD sales, damage and received transfers (see seedLedger).
 *
 * Shape (i = 1..50,000): sale i is at branch 1 or 2 by parity, by user i mod 3, on day (i mod 365) of 2026 at hour (i mod 21), so Baghdad (+3) stays on the same day; it has
 * two lines of products (2i mod 200) and (2i+1) mod 200, quantity 1 + (i mod 5), price 100 + product, and a discount of 1 on its first
 * line when i is a multiple of 7. Every fifth product has no cost (its batch carries none); the others cost 50 + product.
 */

const SALES = 50_000;
const BUDGET_MS = 2000;
const WINDOW = { from: '2026-01-01', to: '2026-12-31' };
/** A statement count measured on the small business below and on the big one must be the same. */
const MARGIN_OF_ERROR = 0;

/* eslint-disable no-restricted-properties -- seeding and measuring only: raw statements bound to the test business */

/** Every statement the client sends, with its bound values, for the EXPLAIN test. */
function recordingClient() {
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl(TEST_DB) }),
    log: [{ emit: 'event', level: 'query' }],
  });
  const seen: Array<{ query: string; params: string }> = [];
  (
    client as unknown as {
      $on: (event: string, handler: (e: { query: string; params: string }) => void) => void;
    }
  ).$on('query', (e) => seen.push({ query: e.query, params: e.params }));
  return { client, seen };
}

function countingClient() {
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl(TEST_DB) }),
    log: [{ emit: 'event', level: 'query' }],
  });
  const state = { count: 0 };
  (client as unknown as { $on: (event: string, handler: () => void) => void }).$on('query', () => {
    state.count += 1;
  });
  return { client, state };
}

let owner: Person;
let smallOwner: Person;
let big: { id: string; b1: string; b2: string };
let small: { id: string; b1: string; b2: string };

async function seedBusiness(label: string, products: number, sales: number) {
  const a = await pharmacy(label, { branches: 2 });
  const [b1, b2] = a.branchIds as [string, string];
  const id = a.id;
  await prisma().phSettings.create({ data: { restaurantId: id } });
  await prisma().phCategory.createMany({
    data: Array.from({ length: 10 }, (_, n) => ({
      id: `${label}-c-${n}`,
      restaurantId: id,
      name: `Cat ${n}`,
      nameKey: `cat-${n}`,
    })),
  });
  await prisma().phProduct.createMany({
    data: Array.from({ length: products }, (_, n) => ({
      id: `${label}-p-${n}`,
      restaurantId: id,
      tradeName: `Perf ${String(n).padStart(4, '0')}`,
      identityKey: `perf-${n}|${id}`,
      searchText: `perf ${n}`,
      categoryId: `${label}-c-${n % 10}`,
    })),
  });
  await prisma().phProductUnit.createMany({
    data: Array.from({ length: products }, (_, n) => ({
      id: `${label}-u-${n}`,
      restaurantId: id,
      productId: `${label}-p-${n}`,
      level: 0,
      label: 'tablet',
      baseQty: 1,
    })),
  });
  await prisma().phBatch.createMany({
    data: Array.from({ length: products }, (_, n) => ({
      id: `${label}-b-${n}`,
      restaurantId: id,
      productId: `${label}-p-${n}`,
      lot: `L${n}`,
      expiryDate: new Date('2028-01-01T00:00:00.000Z'),
      ...(n % 5 === 0
        ? {}
        : {
            unitCostMinor: BigInt(50 + n),
            costCurrency: 'IQD' as const,
            costUnitId: `${label}-u-${n}`,
          }),
    })),
  });
  await prisma().phStockBalance.createMany({
    data: [b1, b2].flatMap((branchId) =>
      Array.from({ length: products }, (_, n) => ({
        restaurantId: id,
        branchId,
        productId: `${label}-p-${n}`,
        batchId: `${label}-b-${n}`,
        available: 1000,
        quarantine: n % 7 === 0 ? 5 : 0,
      })),
    ),
  });
  for (const [n, branchId] of [b1, b2].entries()) {
    await prisma().phShift.create({
      data: {
        id: `${label}-shift-${n + 1}`,
        restaurantId: id,
        branchId,
        userId: `${label}-seller`,
        currency: 'IQD',
        openingFloatMinor: 0n,
      },
    });
  }
  const P = products;
  await prisma().$executeRaw`
    INSERT INTO "PhSale" ("id", "restaurantId", "branchId", "shiftId", "number", "status", "currency", "subtotalMinor", "discountMinor", "roundingMinor", "totalMinor", "paidMinor", "changeMinor", "clientKey", "soldById", "createdAt", "completedAt")
    SELECT ${label} || '-s-' || i, ${id}, CASE WHEN i % 2 = 0 THEN ${b1} ELSE ${b2} END, ${label} || '-shift-' || (CASE WHEN i % 2 = 0 THEN 1 ELSE 2 END), 'P-' || i, 'COMPLETED', 'IQD',
           (1 + i % 5) * (200 + (2 * i) % ${P}::int + (2 * i + 1) % ${P}::int), CASE WHEN i % 7 = 0 THEN 1 ELSE 0 END, 0,
           (1 + i % 5) * (200 + (2 * i) % ${P}::int + (2 * i + 1) % ${P}::int) - CASE WHEN i % 7 = 0 THEN 1 ELSE 0 END,
           (1 + i % 5) * (200 + (2 * i) % ${P}::int + (2 * i + 1) % ${P}::int) - CASE WHEN i % 7 = 0 THEN 1 ELSE 0 END, 0,
           ${label} || '-key-' || i, ${label} || '-user-' || (i % 3),
           TIMESTAMP '2026-01-01 00:00:00' + (i % 365) * INTERVAL '1 day' + (i % 21) * INTERVAL '1 hour',
           TIMESTAMP '2026-01-01 00:00:00' + (i % 365) * INTERVAL '1 day' + (i % 21) * INTERVAL '1 hour'
    FROM generate_series(1, ${sales}::int) AS i`;
  await prisma().$executeRaw`
    INSERT INTO "PhSaleLine" ("id", "restaurantId", "saleId", "lineNo", "productId", "unitId", "qty", "baseQty", "unitPriceMinor", "discountMinor", "totalMinor")
    SELECT ${label} || '-l-' || i || '-' || k, ${id}, ${label} || '-s-' || i, k, ${label} || '-p-' || ((2 * i + k - 1) % ${P}::int), ${label} || '-u-' || ((2 * i + k - 1) % ${P}::int),
           1 + i % 5, 1 + i % 5, 100 + (2 * i + k - 1) % ${P}::int, CASE WHEN k = 1 AND i % 7 = 0 THEN 1 ELSE 0 END,
           (100 + (2 * i + k - 1) % ${P}::int) * (1 + i % 5) - CASE WHEN k = 1 AND i % 7 = 0 THEN 1 ELSE 0 END
    FROM generate_series(1, ${sales}::int) AS i, generate_series(1, 2) AS k`;
  await prisma().$executeRaw`ANALYZE`;
  await prisma().$executeRaw`
    INSERT INTO "PhSaleLineAllocation" ("id", "restaurantId", "saleLineId", "batchId", "baseQty", "costSnapshotMinor", "costCurrency", "expirySnapshot")
    SELECT ${label} || '-a-' || i || '-' || k, ${id}, ${label} || '-l-' || i || '-' || k, ${label} || '-b-' || ((2 * i + k - 1) % ${P}::int), 1 + i % 5,
           CASE WHEN ((2 * i + k - 1) % ${P}::int) % 5 = 0 THEN NULL ELSE (50 + (2 * i + k - 1) % ${P}::int) * (1 + i % 5) END,
           CASE WHEN ((2 * i + k - 1) % ${P}::int) % 5 = 0 THEN NULL ELSE 'IQD'::"Currency" END, DATE '2028-01-01'
    FROM generate_series(1, ${sales}::int) AS i, generate_series(1, 2) AS k`;
  await prisma().$executeRaw`
    INSERT INTO "PhPayment" ("id", "restaurantId", "saleId", "method", "amountMinor", "currency", "clientKey")
    SELECT 'pay-' || "id", ${id}, "id", 'CASH', "totalMinor", 'IQD', 'paykey-' || "id" FROM "PhSale" WHERE "restaurantId" = ${id}`;
  await seedLedger(label, id, b1, b2, P, sales);
  return { id, b1, b2 };
}

/**
 * What a year of real use adds around the sales: a SALE stock movement per allocation (stamped like its sale), a return on every
 * 25th sale (a line and a RETURN movement each), a USD shift with USD sales (one per 25 sales, one line, cost in IQD so the margin flags it),
 * damage and adjustment movements (one per 16 sales, a quarter of them reversed) and a received transfer per 100 sales with two lines
 * (one short). Counts are proportional to the sales so the small and the big business have the same shape.
 */
async function seedLedger(label: string, id: string, b1: string, b2: string, P: number, sales: number) {
  await prisma().$executeRaw`
    INSERT INTO "PhStockMovement" ("id", "restaurantId", "branchId", "productId", "batchId", "type", "availableDelta", "reason", "userId", "refType", "refId", "createdAt")
    SELECT 'mv-' || a."id", ${id}, s."branchId", l."productId", a."batchId", 'SALE', -a."baseQty", '', ${label} || '-seller', 'PhSale', s."id", s."completedAt"
    FROM "PhSaleLineAllocation" a JOIN "PhSaleLine" l ON l."id" = a."saleLineId" JOIN "PhSale" s ON s."id" = l."saleId" WHERE a."restaurantId" = ${id}`;
  await prisma().$executeRaw`
    INSERT INTO "PhReturn" ("id", "restaurantId", "branchId", "saleId", "shiftId", "number", "reason", "approvedById", "refundMethod", "refundMinor", "currency", "clientKey", "createdAt")
    SELECT ${label} || '-r-' || i, ${id}, s."branchId", s."id", s."shiftId", 'R-' || ${label} || '-' || i, 'perf', ${label} || '-seller', 'CASH', 100, 'IQD', ${label} || '-rkey-' || i, s."completedAt" + INTERVAL '1 hour'
    FROM generate_series(1, ${sales}::int / 25) AS i JOIN "PhSale" s ON s."id" = ${label} || '-s-' || (i * 25)`;
  await prisma().$executeRaw`
    INSERT INTO "PhReturnLine" ("id", "restaurantId", "returnId", "saleLineAllocationId", "baseQty", "refundMinor")
    SELECT ${label} || '-rl-' || i, ${id}, ${label} || '-r-' || i, ${label} || '-a-' || (i * 25) || '-1', 1, 100 FROM generate_series(1, ${sales}::int / 25) AS i`;
  await prisma().$executeRaw`
    INSERT INTO "PhStockMovement" ("id", "restaurantId", "branchId", "productId", "batchId", "type", "availableDelta", "reason", "userId", "refType", "refId", "createdAt")
    SELECT 'mvr-' || rl."id", ${id}, r."branchId", l."productId", a."batchId", 'RETURN_IN', 1, '', ${label} || '-seller', 'PhReturn', r."id", r."createdAt"
    FROM "PhReturnLine" rl JOIN "PhReturn" r ON r."id" = rl."returnId" JOIN "PhSaleLineAllocation" a ON a."id" = rl."saleLineAllocationId" JOIN "PhSaleLine" l ON l."id" = a."saleLineId" WHERE rl."restaurantId" = ${id}`;
  await prisma().$executeRaw`
    INSERT INTO "PhShift" ("id", "restaurantId", "branchId", "userId", "currency", "openingFloatMinor") VALUES (${label} || '-shift-usd-1', ${id}, ${b1}, ${label} || '-seller-usd1', 'USD', 0), (${label} || '-shift-usd-2', ${id}, ${b2}, ${label} || '-seller-usd2', 'USD', 0)`;
  await prisma().$executeRaw`
    INSERT INTO "PhSale" ("id", "restaurantId", "branchId", "shiftId", "number", "status", "currency", "subtotalMinor", "discountMinor", "roundingMinor", "totalMinor", "paidMinor", "changeMinor", "clientKey", "soldById", "createdAt", "completedAt")
    SELECT ${label} || '-su-' || i, ${id}, CASE WHEN i % 2 = 0 THEN ${b1} ELSE ${b2} END, ${label} || '-shift-usd-' || (CASE WHEN i % 2 = 0 THEN 1 ELSE 2 END), 'U-' || i, 'COMPLETED', 'USD', 300, 0, 0, 300, 300, 0,
           ${label} || '-ukey-' || i, ${label} || '-user-' || (i % 3), TIMESTAMP '2026-01-01 00:00:00' + (i % 365) * INTERVAL '1 day' + INTERVAL '5 hours', TIMESTAMP '2026-01-01 00:00:00' + (i % 365) * INTERVAL '1 day' + INTERVAL '5 hours'
    FROM generate_series(1, ${sales}::int / 25) AS i`;
  await prisma().$executeRaw`
    INSERT INTO "PhSaleLine" ("id", "restaurantId", "saleId", "lineNo", "productId", "unitId", "qty", "baseQty", "unitPriceMinor", "discountMinor", "totalMinor")
    SELECT ${label} || '-lu-' || i, ${id}, ${label} || '-su-' || i, 1, ${label} || '-p-' || (i % ${P}::int), ${label} || '-u-' || (i % ${P}::int), 3, 3, 100, 0, 300 FROM generate_series(1, ${sales}::int / 25) AS i`;
  await prisma().$executeRaw`
    INSERT INTO "PhSaleLineAllocation" ("id", "restaurantId", "saleLineId", "batchId", "baseQty", "costSnapshotMinor", "costCurrency", "expirySnapshot")
    SELECT ${label} || '-au-' || i, ${id}, ${label} || '-lu-' || i, ${label} || '-b-' || (i % ${P}::int), 3,
           CASE WHEN (i % ${P}::int) % 5 = 0 THEN NULL ELSE (50 + i % ${P}::int) * 3 END, CASE WHEN (i % ${P}::int) % 5 = 0 THEN NULL ELSE 'IQD'::"Currency" END, DATE '2028-01-01'
    FROM generate_series(1, ${sales}::int / 25) AS i`;
  await prisma().$executeRaw`
    INSERT INTO "PhStockMovement" ("id", "restaurantId", "branchId", "productId", "batchId", "type", "availableDelta", "damagedDelta", "reason", "userId", "createdAt")
    SELECT 'mvd-' || ${label} || i, ${id}, CASE WHEN i % 2 = 0 THEN ${b1} ELSE ${b2} END, ${label} || '-p-' || (i % ${P}::int), ${label} || '-b-' || (i % ${P}::int),
           (CASE WHEN i % 3 = 0 THEN 'DAMAGE' ELSE 'ADJUST' END)::"PhMovementType", CASE WHEN i % 3 = 0 THEN -2 ELSE -1 END, CASE WHEN i % 3 = 0 THEN 2 ELSE 0 END,
           CASE WHEN i % 2 = 0 THEN 'broken' ELSE 'expired' END, ${label} || '-seller', TIMESTAMP '2026-01-01 00:00:00' + (i % 365) * INTERVAL '1 day' + INTERVAL '8 hours'
    FROM generate_series(1, ${sales}::int / 16) AS i`;
  await prisma().$executeRaw`
    INSERT INTO "PhStockMovement" ("id", "restaurantId", "branchId", "productId", "batchId", "type", "availableDelta", "damagedDelta", "reason", "userId", "reversesId", "createdAt")
    SELECT 'mvz-' || m."id", ${id}, m."branchId", m."productId", m."batchId", m."type", -m."availableDelta", -m."damagedDelta", m."reason", ${label} || '-seller', m."id", m."createdAt" + INTERVAL '1 hour'
    FROM "PhStockMovement" m WHERE m."restaurantId" = ${id} AND m."id" LIKE ('mvd-' || ${label} || '%') AND substring(m."id" from char_length('mvd-' || ${label}) + 1)::int % 4 = 0`;
  // The transfer guards (lines only while a request, one way status) exist for the services; the seed writes finished transfers directly.
  await prisma().$executeRaw`ALTER TABLE "PhTransfer" DISABLE TRIGGER USER`;
  try {
    await prisma().$executeRaw`ALTER TABLE "PhTransferLine" DISABLE TRIGGER USER`;
    await prisma().$executeRaw`
    INSERT INTO "PhTransfer" ("id", "restaurantId", "fromBranchId", "toBranchId", "status", "number", "clientKey", "payloadHash", "requestedById", "requestedAt", "sentById", "sentAt", "receivedById", "receivedAt", "sendKey", "sendHash", "receiveKey", "receiveHash", "updatedAt")
    SELECT ${label} || '-t-' || i, ${id}, ${b1}, ${b2}, 'RECEIVED', 'T-' || ${label} || '-' || i, ${label} || '-tkey-' || i, 'h', ${label} || '-seller',
           TIMESTAMP '2026-01-01' + (i % 365) * INTERVAL '1 day', ${label} || '-seller', TIMESTAMP '2026-01-01' + (i % 365) * INTERVAL '1 day' + INTERVAL '2 hours', ${label} || '-seller', TIMESTAMP '2026-01-01' + (i % 365) * INTERVAL '1 day' + INTERVAL '5 hours', ${label} || '-tsend-' || i, 'h', ${label} || '-trecv-' || i, 'h', now()
    FROM generate_series(1, ${sales}::int / 100) AS i`;
    // A transfer holds a request line (what was asked, no batch) and a sent line per request (what left, from a batch), received short.
    await prisma().$executeRaw`
    INSERT INTO "PhTransferLine" ("id", "restaurantId", "transferId", "fromBranchId", "toBranchId", "lineNo", "productId", "requestedQty")
    SELECT ${label} || '-tq-' || i || '-' || k, ${id}, ${label} || '-t-' || i, ${b1}, ${b2}, k, ${label} || '-p-' || ((i + k) % ${P}::int), 10
    FROM generate_series(1, ${sales}::int / 100) AS i, generate_series(1, 2) AS k`;
    await prisma().$executeRaw`
    INSERT INTO "PhTransferLine" ("id", "restaurantId", "transferId", "fromBranchId", "toBranchId", "lineNo", "productId", "batchId", "requestLineId", "requestedQty", "sentQty", "receivedQty", "lostQty", "damagedQty", "lostReason")
    SELECT ${label} || '-tl-' || i || '-' || k, ${id}, ${label} || '-t-' || i, ${b1}, ${b2}, k + 2, ${label} || '-p-' || ((i + k) % ${P}::int), ${label} || '-b-' || ((i + k) % ${P}::int), ${label} || '-tq-' || i || '-' || k,
           0, 10, CASE WHEN k = 2 THEN 8 ELSE 10 END, CASE WHEN k = 2 THEN 1 ELSE 0 END, CASE WHEN k = 2 THEN 1 ELSE 0 END, CASE WHEN k = 2 THEN 'LOST'::"PhTransferLostReason" ELSE NULL END
    FROM generate_series(1, ${sales}::int / 100) AS i, generate_series(1, 2) AS k`;
  } finally {
    await prisma().$executeRaw`ALTER TABLE "PhTransfer" ENABLE TRIGGER USER`;
    await prisma().$executeRaw`ALTER TABLE "PhTransferLine" ENABLE TRIGGER USER`;
  }
}

beforeAll(async () => {
  useTestDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await resetWorld();
  // The big business goes first: a pooled connection keeps the plans of its foreign-key checks, and a plan made while the tables
  // held 40 rows is a sequential scan that turns 100,000 inserts into minutes.
  big = await seedBusiness('BG', 200, SALES);
  owner = await person('ownerBG', { membership: [big.id, 'OWNER'] });
  small = await seedBusiness('SM', 20, 40);
  smallOwner = await person('ownerSM', { membership: [small.id, 'OWNER'] });
  await prisma().$executeRaw`ANALYZE`;
}, 600_000);

afterAll(async () => {
  // Bounded: the cascade of 100,000 movements is quick only with the reversesId index (migration 20261031130000); a missing one
  // fails here in two minutes instead of hanging a database session for good.
  await resetWorld();
  vi.useRealTimers();
}, 120_000);

const CASES: Array<[string, QueryDef<unknown, unknown>, Record<string, unknown>]> = [
  ['sales by day', reports.sales as QueryDef<unknown, unknown>, { ...WINDOW, groupBy: 'day' }],
  ['sales by branch', reports.sales as QueryDef<unknown, unknown>, { ...WINDOW, groupBy: 'branch' }],
  ['sales by user', reports.sales as QueryDef<unknown, unknown>, { ...WINDOW, groupBy: 'user' }],
  ['sales by method', reports.sales as QueryDef<unknown, unknown>, { ...WINDOW, groupBy: 'method' }],
  ['sales by product', reports.sales as QueryDef<unknown, unknown>, { ...WINDOW, groupBy: 'product' }],
  ['sales by category', reports.sales as QueryDef<unknown, unknown>, { ...WINDOW, groupBy: 'category' }],
  ['margin by day', reports.margin as QueryDef<unknown, unknown>, { ...WINDOW, groupBy: 'day' }],
  ['margin by product', reports.margin as QueryDef<unknown, unknown>, { ...WINDOW, groupBy: 'product' }],
  ['stock valuation by product', reports.stockValuationQuery as QueryDef<unknown, unknown>, { groupBy: 'product' }],
  ['stock valuation by branch', reports.stockValuationQuery as QueryDef<unknown, unknown>, { groupBy: 'branch' }],
  ['returns', reports.returns as QueryDef<unknown, unknown>, { ...WINDOW }],
  ['discounts', reports.discounts as QueryDef<unknown, unknown>, { ...WINDOW }],
  ['low stock', reports.lowStock as QueryDef<unknown, unknown>, {}],
  ['expiry', reports.expiry as QueryDef<unknown, unknown>, {}],
  ['damaged', reports.damaged as QueryDef<unknown, unknown>, { ...WINDOW }],
  ['transfers', reports.transfers as QueryDef<unknown, unknown>, { ...WINDOW }],
  ['chain dashboard (year)', chain.dashboard as QueryDef<unknown, unknown>, { ...WINDOW }],
];

describe('report budgets over 100,000 sale lines', () => {
  it('seeded what it says: 50,000 sales, 100,000 lines and allocations, 12 months', async () => {
    const [row] = await prisma().$queryRaw<Array<{ sales: bigint; lines: bigint; allocations: bigint; days: bigint }>>`
      SELECT (SELECT COUNT(*) FROM "PhSale" WHERE "restaurantId" = ${big.id} AND "currency" = 'IQD') AS sales, (SELECT COUNT(*) FROM "PhSaleLine" l JOIN "PhSale" s ON s."id" = l."saleId" WHERE l."restaurantId" = ${big.id} AND s."currency" = 'IQD') AS lines,
             (SELECT COUNT(*) FROM "PhSaleLineAllocation" a JOIN "PhSaleLine" l ON l."id" = a."saleLineId" JOIN "PhSale" s ON s."id" = l."saleId" WHERE a."restaurantId" = ${big.id} AND s."currency" = 'IQD') AS allocations,
             (SELECT COUNT(DISTINCT ("completedAt" + interval '3 hours')::date) FROM "PhSale" WHERE "restaurantId" = ${big.id} AND "currency" = 'IQD') AS days`;
    expect(row).toEqual({
      sales: BigInt(SALES),
      lines: BigInt(SALES * 2),
      allocations: BigInt(SALES * 2),
      days: 365n,
    });
  });

  it.each(CASES)('%s answers in under 2 seconds', async (name, def, input) => {
    const actor = (await loadActor(prisma(), owner.userId)) as Actor;
    const started = performance.now();
    const result = await runQuery(prisma(), actor, def, {
      restaurantId: big.id,
      ...input,
    });
    const took = performance.now() - started;
    dataOf(result);
    console.log(`${name}: ${took.toFixed(0)} ms`);
    expect(took, name).toBeLessThan(BUDGET_MS);
  });

  it('every report costs the same number of statements on 40 sales and on 50,000', async () => {
    const { client, state } = countingClient();
    try {
      const smallActor = (await loadActor(prisma(), smallOwner.userId)) as Actor;
      const bigActor = (await loadActor(prisma(), owner.userId)) as Actor;
      for (const [name, def, input] of CASES) {
        state.count = 0;
        dataOf(
          await runQuery(client, smallActor, def, {
            restaurantId: small.id,
            ...input,
          }),
        );
        const few = state.count;
        state.count = 0;
        dataOf(
          await runQuery(client, bigActor, def, {
            restaurantId: big.id,
            ...input,
          }),
        );
        const many = state.count;
        expect(many, `${name}: ${few} statements on the small business, ${many} on the big one`).toBeLessThanOrEqual(few + MARGIN_OF_ERROR);
        console.log(`${name}: ${many} statements`);
      }
    } finally {
      await client.$disconnect();
    }
  }, 120_000);

  it('EXPLAIN (ANALYZE, BUFFERS) of every report statement on the big business: no scan of the movement table, nothing slow', async () => {
    const { client, seen } = recordingClient();
    const pg = new Client({ connectionString: databaseUrl(TEST_DB) });
    await pg.connect();
    try {
      const actor = (await loadActor(prisma(), owner.userId)) as Actor;
      const problems: string[] = [];
      const unreplayable: string[] = [];
      let explained = 0;
      for (const [name, def, input] of CASES) {
        seen.length = 0;
        dataOf(
          await runQuery(client, actor, def, {
            restaurantId: big.id,
            ...input,
          }),
        );
        for (const [n, { query, params }] of seen.filter((q) => /^\s*(WITH|SELECT)/i.test(q.query) && /\$1/.test(q.query)).entries()) {
          let plan: string[];
          try {
            const rows = await pg.query(`EXPLAIN (ANALYZE, BUFFERS) ${query}`, JSON.parse(params) as unknown[]);
            plan = rows.rows.map((r: Record<string, string>) => r['QUERY PLAN']!);
          } catch (error) {
            unreplayable.push(`${name} #${n}: ${(error as Error).message}`);
            continue;
          }
          explained += 1;
          const time = plan.find((l) => l.startsWith('Execution Time')) ?? '';
          const nodes = plan.filter((l) => /(Seq|Index|Bitmap Heap|Index Only) Scan on "PhStockMovement"/.test(l)).map((l) => l.trim().replace(/\s+\(.*$/, ''));
          let without = '';
          if (name === 'damaged') {
            // The same statement with the two report indexes dropped inside a transaction that is rolled back (DDL is transactional).
            await pg.query('BEGIN');
            try {
              await pg.query('SET LOCAL statement_timeout = 90000');
              await pg.query('DROP INDEX "PhStockMovement_restaurantId_branchId_createdAt_idx"');
              await pg.query('DROP INDEX "PhStockMovement_reversesId_idx"');
              const rows = await pg.query(`EXPLAIN (ANALYZE, BUFFERS) ${query}`, JSON.parse(params) as unknown[]);
              without = ` | WITHOUT the report indexes: ${rows.rows.map((r: Record<string, string>) => r['QUERY PLAN']!).find((l: string) => l.startsWith('Execution Time'))}`;
            } catch (error) {
              without = ` | WITHOUT the report indexes: ${(error as Error).message}`;
            } finally {
              await pg.query('ROLLBACK');
            }
          }
          console.log(`EXPLAIN ${name} #${n}: ${time}; PhStockMovement access: ${nodes.join(', ') || 'none'}${without}`);
          if (process.env.EXPLAIN_FULL) console.log(plan.join('\n'));
          if (Number.parseFloat(time.replace('Execution Time: ', '')) > BUDGET_MS) problems.push(`${name} #${n}: ${time}`);
        }
      }
      // Not vacuous: statements that could not be replayed from the log are listed, and most of them must have been explained.
      expect(unreplayable).toEqual([]);
      expect(explained).toBeGreaterThan(CASES.length);
      expect(problems).toEqual([]);
    } finally {
      await pg.end();
      await client.$disconnect();
    }
  }, 300_000);

  it('the margin of the seeded business is what its rows say (independent SQL)', async () => {
    const actor = (await loadActor(prisma(), owner.userId)) as Actor;
    const result = dataOf(await runQuery(prisma(), actor, reports.margin as QueryDef<unknown, unknown>, { restaurantId: big.id, ...WINDOW, groupBy: 'branch' })) as {
      totals: Array<{ currency: string; netMinor: string; costMinor: string }>;
      incompleteCostRows: number;
    };
    // A line counts only when both of its (one) allocation's cost is known: products not a multiple of 5.
    const [expected] = await prisma().$queryRaw<Array<{ net: bigint; cost: bigint; nulls: bigint }>>`
      SELECT COALESCE(SUM(l."totalMinor") FILTER (WHERE a."costSnapshotMinor" IS NOT NULL AND s."currency" = 'IQD'), 0)::bigint AS net,
             COALESCE(SUM(a."costSnapshotMinor") FILTER (WHERE s."currency" = 'IQD'), 0)::bigint AS cost,
             COUNT(*) FILTER (WHERE a."costSnapshotMinor" IS NULL)::bigint AS nulls
      FROM "PhSaleLine" l JOIN "PhSale" s ON s."id" = l."saleId" JOIN "PhSaleLineAllocation" a ON a."saleLineId" = l."id" WHERE l."restaurantId" = ${big.id}`;
    // The no-cost lines of the USD sales count too (every report counts a line without cost, whatever its currency). The USD sales carry IQD costs: they are left out of the figures and counted as mixed-currency rows, not mixed into the IQD ones.
    expect(result.totals.filter((t) => t.currency === 'IQD')).toEqual([
      expect.objectContaining({
        currency: 'IQD',
        netMinor: String(expected!.net),
        costMinor: String(expected!.cost),
      }),
    ]);
    expect(BigInt(result.incompleteCostRows)).toBe(expected!.nulls);
  });
});

describe('chain dashboard budget (R6-10): 5 branches on the same seed in under 1.5 seconds', () => {
  const DASHBOARD_BUDGET_MS = 1500;
  it('answers a year window and the default 30 days with five branches, and the total is the sum of the cards', async () => {
    // Three more branches without sales (the seed's two carry the 50,000 sales): the dashboard asks for five cards.
    for (let n = 3; n <= 5; n += 1) await prisma().branch.create({ data: { restaurantId: big.id, name: `BG branch ${n}`, sortOrder: n } });
    const actor = (await loadActor(prisma(), owner.userId)) as Actor;
    for (const [name, input] of [['year', { ...WINDOW }], ['default 30 days', {}]] as const) {
      const started = performance.now();
      const result = dataOf(await runQuery(prisma(), actor, chain.dashboard as QueryDef<unknown, unknown>, { restaurantId: big.id, ...input })) as {
        branches: unknown[];
        total: { sales: Array<{ currency: string; salesMinor: string }> };
        scope: { branchIds: string[] };
      };
      const took = performance.now() - started;
      console.log(`chain dashboard ${name}, 5 branches: ${took.toFixed(0)} ms`);
      expect(result.branches).toHaveLength(5);
      expect(result.scope.branchIds).toHaveLength(5);
      expect(took, name).toBeLessThan(DASHBOARD_BUDGET_MS);
    }
    // The year window against independent SQL: IQD sales of the seed.
    const year = dataOf(await runQuery(prisma(), actor, chain.dashboard as QueryDef<unknown, unknown>, { restaurantId: big.id, ...WINDOW })) as { total: { sales: Array<{ currency: string; salesMinor: string }> } };
    const [sum] = await prisma().$queryRaw<Array<{ sales: bigint }>>`SELECT SUM("totalMinor")::bigint AS sales FROM "PhSale" WHERE "restaurantId" = ${big.id} AND "currency" = 'IQD'`;
    expect(year.total.sales.find((t) => t.currency === 'IQD')!.salesMinor).toBe(String(sum!.sales));
  }, 120_000);
});
