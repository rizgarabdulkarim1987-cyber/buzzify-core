import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@/generated/prisma/client';
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

function countingClient() {
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl(TEST_DB) }), log: [{ emit: 'event', level: 'query' }] });
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
  await prisma().phCategory.createMany({ data: Array.from({ length: 10 }, (_, n) => ({ id: `${label}-c-${n}`, restaurantId: id, name: `Cat ${n}`, nameKey: `cat-${n}` })) });
  await prisma().phProduct.createMany({
    data: Array.from({ length: products }, (_, n) => ({ id: `${label}-p-${n}`, restaurantId: id, tradeName: `Perf ${String(n).padStart(4, '0')}`, identityKey: `perf-${n}|${id}`, searchText: `perf ${n}`, categoryId: `${label}-c-${n % 10}` })),
  });
  await prisma().phProductUnit.createMany({ data: Array.from({ length: products }, (_, n) => ({ id: `${label}-u-${n}`, restaurantId: id, productId: `${label}-p-${n}`, level: 0, label: 'tablet', baseQty: 1 })) });
  await prisma().phBatch.createMany({
    data: Array.from({ length: products }, (_, n) => ({
      id: `${label}-b-${n}`,
      restaurantId: id,
      productId: `${label}-p-${n}`,
      lot: `L${n}`,
      expiryDate: new Date('2028-01-01T00:00:00.000Z'),
      ...(n % 5 === 0 ? {} : { unitCostMinor: BigInt(50 + n), costCurrency: 'IQD' as const, costUnitId: `${label}-u-${n}` }),
    })),
  });
  await prisma().phStockBalance.createMany({
    data: [b1, b2].flatMap((branchId) => Array.from({ length: products }, (_, n) => ({ restaurantId: id, branchId, productId: `${label}-p-${n}`, batchId: `${label}-b-${n}`, available: 1000, quarantine: n % 7 === 0 ? 5 : 0 }))),
  });
  for (const [n, branchId] of [b1, b2].entries()) {
    await prisma().phShift.create({ data: { id: `${label}-shift-${n + 1}`, restaurantId: id, branchId, userId: `${label}-seller`, currency: 'IQD', openingFloatMinor: 0n } });
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
  return { id, b1, b2 };
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
  await resetWorld();
  vi.useRealTimers();
});

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
];

describe('report budgets over 100,000 sale lines', () => {
  it('seeded what it says: 50,000 sales, 100,000 lines and allocations, 12 months', async () => {
    const [row] = await prisma().$queryRaw<Array<{ sales: bigint; lines: bigint; allocations: bigint; days: bigint }>>`
      SELECT (SELECT COUNT(*) FROM "PhSale" WHERE "restaurantId" = ${big.id}) AS sales, (SELECT COUNT(*) FROM "PhSaleLine" WHERE "restaurantId" = ${big.id}) AS lines,
             (SELECT COUNT(*) FROM "PhSaleLineAllocation" WHERE "restaurantId" = ${big.id}) AS allocations,
             (SELECT COUNT(DISTINCT ("completedAt" + interval '3 hours')::date) FROM "PhSale" WHERE "restaurantId" = ${big.id}) AS days`;
    expect(row).toEqual({ sales: BigInt(SALES), lines: BigInt(SALES * 2), allocations: BigInt(SALES * 2), days: 365n });
  });

  it.each(CASES)('%s answers in under 2 seconds', async (name, def, input) => {
    const actor = (await loadActor(prisma(), owner.userId)) as Actor;
    const started = performance.now();
    const result = await runQuery(prisma(), actor, def, { restaurantId: big.id, ...input });
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
        dataOf(await runQuery(client, smallActor, def, { restaurantId: small.id, ...input }));
        const few = state.count;
        state.count = 0;
        dataOf(await runQuery(client, bigActor, def, { restaurantId: big.id, ...input }));
        const many = state.count;
        expect(many, `${name}: ${few} statements on the small business, ${many} on the big one`).toBeLessThanOrEqual(few + MARGIN_OF_ERROR);
        console.log(`${name}: ${many} statements`);
      }
    } finally {
      await client.$disconnect();
    }
  }, 120_000);

  it('the margin of the seeded business is what its rows say (independent SQL)', async () => {
    const actor = (await loadActor(prisma(), owner.userId)) as Actor;
    const result = dataOf(await runQuery(prisma(), actor, reports.margin as QueryDef<unknown, unknown>, { restaurantId: big.id, ...WINDOW, groupBy: 'branch' })) as {
      totals: Array<{ currency: string; netMinor: string; costMinor: string }>;
      incompleteCostRows: number;
    };
    // A line counts only when both of its (one) allocation's cost is known: products not a multiple of 5.
    const [expected] = await prisma().$queryRaw<Array<{ net: bigint; cost: bigint; nulls: bigint }>>`
      SELECT COALESCE(SUM(l."totalMinor") FILTER (WHERE a."costSnapshotMinor" IS NOT NULL), 0)::bigint AS net,
             COALESCE(SUM(a."costSnapshotMinor"), 0)::bigint AS cost,
             COUNT(*) FILTER (WHERE a."costSnapshotMinor" IS NULL)::bigint AS nulls
      FROM "PhSaleLine" l JOIN "PhSaleLineAllocation" a ON a."saleLineId" = l."id" WHERE l."restaurantId" = ${big.id}`;
    expect(result.totals).toEqual([expect.objectContaining({ currency: 'IQD', netMinor: String(expected!.net), costMinor: String(expected!.cost) })]);
    expect(BigInt(result.incompleteCostRows)).toBe(expected!.nulls);
  });
});
