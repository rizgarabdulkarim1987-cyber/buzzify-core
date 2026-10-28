import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@/generated/prisma/client';
import { searchTextOf } from '@/server/domain/pharmacy/product-identity';
import * as saleActions from '@/server/pharmacy/actions/sales';
import * as sellQueries from '@/server/pharmacy/queries/sell';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runAction } from '@/server/studio/framework/action';
import { runQuery } from '@/server/studio/framework/query';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { NOW, person, pharmacy, prisma, resetWorld, useTestDatabase } from './fixture';
import { dataOf, makeBatch, META } from './stock-helpers';

/**
 * The sale path costs a bounded number of database queries and has no N+1 outside the stock ledger. Counted on a client
 * that logs every statement (the actor load, the row locks and the audit insert included). Measured on 2026-10-28:
 *
 * - `ph.sales.create` = 29 fixed statements (actor, key lock, shift, settings, products, units, prices, stock, batches,
 *   number, sale, lines, allocations, payments, cash, audit) + 5 per stock allocation. The five are `applyMovement`
 *   (stock.ts, the one writer of the ledger): batch check, branch check, balance upsert, balance update, movement insert.
 *   So the count grows with the batches a cart takes stock from (one movement per batch, R2-1), and with nothing else:
 *   products, units, prices, stock and batches are read once for the whole cart, and lines, allocations, payments and
 *   cash rows are inserted in one statement each. Batching the ledger writes would make it constant; it is a stock.ts
 *   change and not done here.
 * - `ph.sell.search` = 25 statements (the actor's 8 included) whatever the number of results.
 *
 * Each bound is the measurement plus a margin, so one new statement on the path is noticed and a statement per line is not
 * let through.
 */
const MEASURED = { saleFixed: 29, perAllocation: 5, search: 25 };
const MARGIN = 4;

beforeAll(() => {
  useTestDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});

let seq = 0;
const key = (label: string) => `${label}-${(seq += 1)}-${'x'.repeat(8)}`;

async function world(products: number) {
  await resetWorld();
  const a = await pharmacy('A', { branches: 1 });
  const b1 = a.branchIds[0]!;
  const owner = await person('owner', { membership: [a.id, 'OWNER'] });
  const cashier = await person('cashier', { staff: [a.id, 'CASHIER', [b1]] });
  await prisma().phSettings.create({ data: { restaurantId: a.id } });
  await prisma().phShift.create({ data: { restaurantId: a.id, branchId: b1, userId: cashier.userId, currency: 'IQD', openingFloatMinor: 0n } });
  const made: { id: string; tablet: string; strip: string }[] = [];
  for (let i = 0; i < products; i += 1) {
    const tradeName = `Drug ${String(i).padStart(2, '0')}`;
    const product = await prisma().phProduct.create({
      data: { restaurantId: a.id, tradeName, identityKey: `${tradeName}|${a.id}`, searchText: searchTextOf({ tradeName, genericName: '', activeIngredient: '', strength: '', form: '', manufacturer: '' }) },
      select: { id: true },
    });
    const tablet = await prisma().phProductUnit.create({ data: { restaurantId: a.id, productId: product.id, level: 0, label: 'tablet', baseQty: 1 }, select: { id: true } });
    const strip = await prisma().phProductUnit.create({ data: { restaurantId: a.id, productId: product.id, level: 1, label: 'strip', baseQty: 10 }, select: { id: true } });
    for (const [unitId, amountMinor] of [[tablet.id, 100n], [strip.id, 900n]] as const) {
      await prisma().phPrice.create({ data: { restaurantId: a.id, productId: product.id, unitId, branchId: null, currency: 'IQD', amountMinor, validFrom: new Date('2026-01-01T00:00:00.000Z'), changedById: 'seed' } });
    }
    // Two batches each, so the FEFO allocation has something to choose from.
    await makeBatch(a.id, b1, product.id, { lot: 'L1', expiry: '2027-03-31', buckets: { available: 3 } });
    await makeBatch(a.id, b1, product.id, { lot: 'L2', expiry: '2028-03-31', buckets: { available: 100 } });
    made.push({ id: product.id, tablet: tablet.id, strip: strip.id });
  }
  return { a, b1, cashier, products: made };
}

/** A client that counts every statement it sends. */
function countingClient() {
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl(TEST_DB) }), log: [{ emit: 'event', level: 'query' }] });
  const state = { count: 0 };
  (client as unknown as { $on: (event: string, handler: () => void) => void }).$on('query', () => {
    state.count += 1;
  });
  return { client, state };
}

describe('the sale path issues a bounded number of queries', () => {
  it('a sale of 3 lines and 2 payments, and of 12 lines and 2 payments, cost the same', async () => {
    const w = await world(15);
    const actor = (await loadActor(prisma(), w.cashier.userId)) as Actor;
    const { client, state } = countingClient();
    // Disjoint products for the two sales, so each line still finds its first batch whole and is split over two.
    const sell = async (lines: number, offset: number) => {
      const input = {
        restaurantId: w.a.id,
        branchId: w.b1,
        clientKey: key('sale'),
        currency: 'IQD',
        // Each line asks 4 tablets: 4 > 3 in the first batch, so every line is allocated across two batches.
        lines: w.products.slice(offset, offset + lines).map((p) => ({ productId: p.id, unitId: p.tablet, qty: 4 })),
        // The total is lines x 400: a cash part and a transfer for the rest.
        payments: [
          { method: 'CASH', amountMinor: 100n, clientKey: key('pay') },
          { method: 'TRANSFER_MANUAL', amountMinor: BigInt(lines) * 400n - 100n, clientKey: key('pay') },
        ],
      };
      state.count = 0;
      const made = dataOf(await runAction(client, actor, saleActions.create, input, META)) as { id: string };
      const queries = state.count;
      const allocations = await prisma().phSaleLineAllocation.count({ where: { saleLine: { saleId: made.id } } });
      expect(await prisma().phSaleLine.count({ where: { saleId: made.id } })).toBe(lines);
      expect(allocations).toBe(lines * 2);
      expect(await prisma().phPayment.count({ where: { saleId: made.id } })).toBe(2);
      return { queries, allocations };
    };
    try {
      const three = await sell(3, 0);
      const twelve = await sell(12, 3);
      for (const measured of [three, twelve]) {
        expect(measured.queries).toBeLessThanOrEqual(MEASURED.saleFixed + MARGIN + MEASURED.perAllocation * measured.allocations);
      }
      // Nine more lines (18 more allocations) cost the stock writes of those allocations and not one statement more.
      expect(twelve.queries - three.queries).toBeLessThanOrEqual(MEASURED.perAllocation * (twelve.allocations - three.allocations));
    } finally {
      await client.$disconnect();
    }
  }, 120_000);
});

describe('the sale screen search issues a bounded number of queries', () => {
  it('3 results and 30 results cost the same', async () => {
    const w = await world(30);
    const actor = (await loadActor(prisma(), w.cashier.userId)) as Actor;
    const { client, state } = countingClient();
    const search = async (limit: number) => {
      state.count = 0;
      const found = dataOf(await runQuery(client, actor, sellQueries.search, { restaurantId: w.a.id, branchId: w.b1, q: 'Drug', limit })) as { items: unknown[] };
      expect(found.items).toHaveLength(limit);
      return state.count;
    };
    try {
      const three = await search(3);
      const thirty = await search(30);
      expect(three).toBeLessThanOrEqual(MEASURED.search + MARGIN);
      expect(thirty).toBe(three);
    } finally {
      await client.$disconnect();
    }
  }, 120_000);
});
