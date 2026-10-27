import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { scopedClient } from '@/server/data/tenant-db';
import { searchProducts, type SearchResult } from '@/server/pharmacy/search';
import {
  assertPrivateConnection,
  LOAD_INGREDIENTS,
  LOAD_PHARMACY_PER_BUSINESS,
  seedLoadPharmacy,
  type LoadPharmacyBusiness,
} from '../../prisma/seed/load-pharmacy';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { resetTestData, testPrisma } from '../helpers/db';

/**
 * The central search's budget (spec 9): p95 under 150 ms at 50,000 products, with two clients searching at once. Each
 * client is its own Prisma client (its own pool), as two tills would be, and searches its own business through the
 * real service and the restaurant-scoped client. 1,000 queries in all (500 each, after 20 warm-ups each), mixed:
 * barcode hits, barcode misses, trade-name prefixes, Arabic names (with Arabic-Indic digits), active ingredients, two
 * words, and misses. Measured on the private local database: on Neon add the network round trips (see the report).
 */

const QUERIES_PER_CLIENT = 500;
const WARM_UP = 20;
const P95_LIMIT_MS = 150;
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

let seeder: PrismaClient;
const clients: PrismaClient[] = [];
let businesses: LoadPharmacyBusiness[] = [];

/** The nearest-rank percentile of sorted samples. */
const percentile = (sorted: number[], p: number) => sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]!;

/** A small deterministic generator, so every run asks the same questions. */
function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

type Kind = 'barcode' | 'barcode miss' | 'prefix' | 'arabic' | 'ingredient' | 'two words' | 'miss';

interface Query {
  kind: Kind;
  q: string;
  /** For a barcode hit: the product that must come first. */
  expect?: string;
}

function queriesFor(business: LoadPharmacyBusiness, seed: number, count: number): Query[] {
  const next = random(seed);
  const pick = <T>(list: readonly T[]) => list[Math.floor(next() * list.length)]!;
  const latin = business.products.filter((p) => !p.arabic);
  const arabic = business.products.filter((p) => p.arabic);
  const out: Query[] = [];
  for (let i = 0; i < count; i += 1) {
    const r = next();
    if (r < 0.2) {
      const p = pick(business.products);
      out.push({ kind: 'barcode', q: p.barcode, expect: p.productId });
    } else if (r < 0.3) {
      out.push({ kind: 'barcode miss', q: `9990${String(Math.floor(next() * 1e9)).padStart(9, '0')}` });
    } else if (r < 0.55) {
      const name = pick(latin).tradeName;
      out.push({ kind: 'prefix', q: name.slice(0, 3 + Math.floor(next() * 4)).toLowerCase() });
    } else if (r < 0.7) {
      const name = pick(arabic).tradeName;
      out.push({ kind: 'arabic', q: next() < 0.5 ? name : `${name} ${pick(['١٠٠', '٢٥٠', '٥٠٠', '١٠٠٠'])}` });
    } else if (r < 0.82) {
      const ingredient = pick(LOAD_INGREDIENTS);
      out.push({ kind: 'ingredient', q: next() < 0.5 ? ingredient.toUpperCase() : ingredient.slice(0, 6).toLowerCase() });
    } else if (r < 0.9) {
      out.push({ kind: 'two words', q: `${pick(latin).tradeName.slice(0, 5)} ${pick(['100', '250', '500', '1000'])}` });
    } else {
      out.push({ kind: 'miss', q: `qzx${Math.floor(next() * 1e6)}${ARABIC_DIGITS[i % 10]}` });
    }
  }
  return out;
}

interface Sample {
  kind: Kind;
  ms: number;
}

/** One client: its warm-up, then its queries one after another, each timed and its answer checked. */
async function run(client: PrismaClient, business: LoadPharmacyBusiness, queries: Query[]): Promise<Sample[]> {
  const scoped = scopedClient(client, { restaurantId: business.id, allBranches: true });
  const ask = (q: string) => searchProducts(scoped, { q, branchId: business.branchId });
  for (const q of queriesFor(business, 999, WARM_UP)) await ask(q.q);
  const samples: Sample[] = [];
  for (const query of queries) {
    const started = performance.now();
    const results: SearchResult[] = await ask(query.q);
    samples.push({ kind: query.kind, ms: performance.now() - started });
    if (query.expect) {
      expect(results[0], query.q).toMatchObject({ productId: query.expect, matchedOn: 'barcode' });
      expect(results[0]!.price, query.q).not.toBeNull();
    }
    if (query.kind === 'miss' || query.kind === 'barcode miss') expect(results, query.q).toEqual([]);
    expect(results.length).toBeLessThanOrEqual(30);
  }
  return samples;
}

beforeAll(async () => {
  seeder = testPrisma();
  await resetTestData(seeder);
  const started = performance.now();
  businesses = await seedLoadPharmacy(seeder, { databaseUrl: databaseUrl(TEST_DB) });
  console.log(
    `[load] Seeded ${businesses.reduce((n, b) => n + b.products.length, 0)} pharmacy products in ` +
      `${((performance.now() - started) / 1000).toFixed(1)} s`,
  );
  clients.push(testPrisma(), testPrisma());
});

afterAll(async () => {
  if (seeder) {
    await resetTestData(seeder);
    await seeder.$disconnect();
  }
  for (const client of clients) await client.$disconnect();
});

describe('the pharmacy load seed', () => {
  it('makes 50,000 products in two businesses, each with its units, barcode and price', async () => {
    expect(businesses.map((b) => b.products.length)).toEqual([LOAD_PHARMACY_PER_BUSINESS, LOAD_PHARMACY_PER_BUSINESS]);
    expect(await seeder.phProduct.count()).toBe(50_000);
    expect(await seeder.phProductUnit.count()).toBe(100_000);
    expect(await seeder.phBarcode.count()).toBe(50_000);
    expect(await seeder.phProduct.count({ where: { searchText: '' } })).toBe(0);
  });

  it('refuses a database that is not the private one', async () => {
    for (const url of [undefined, 'postgresql://u:p@127.0.0.1:54329/buzzify', 'postgresql://u:p@db.example.com:54381/buzzify', 'postgresql://u:p@127.0.0.1:54381/x?host=db.example.com']) {
      await expect(seedLoadPharmacy(seeder, { databaseUrl: url }), String(url)).rejects.toThrow(/private database/);
    }
    // The URL is the private one, but the client's live connection is not: refused before anything is deleted.
    const elsewhere = (port: number | null, addr: string | null) =>
      ({ $queryRawUnsafe: async () => [{ port, addr }] }) as unknown as PrismaClient;
    for (const [port, addr] of [[5432, '127.0.0.1'], [54381, '10.0.0.5'], [null, null]] as const) {
      await expect(seedLoadPharmacy(elsewhere(port, addr), { databaseUrl: databaseUrl(TEST_DB) }), `${addr}:${port}`).rejects.toThrow(
        /private database/,
      );
    }
    await expect(assertPrivateConnection(seeder)).resolves.toBeUndefined();
    expect(await seeder.phProduct.count()).toBe(50_000);
  });
});

describe('pharmacy search at 50,000 products', () => {
  // At this size a full scan still fits the budget on a fast local machine, so the timing alone would not notice a
  // missing index: the plan is checked as well, for selective words (for a word in a quarter of the catalog the planner
  // may rightly prefer another path, such as walking the trade-name index for a short prefix). The statements have the
  // shapes the service's exact, prefix and contains reads send (Prisma's LIKE with the scoped client's restaurant
  // filter). Arabic words are not checked: under the local database's
  // C ctype pg_trgm extracts no trigrams from Arabic letters (see the task report); Neon's UTF-8 ctype does.
  it('reads selective names through the trigram index', async () => {
    const admin = new pg.Client({ connectionString: databaseUrl(TEST_DB) });
    await admin.connect();
    const indexesOf = (node: Record<string, unknown>): string[] => [
      ...(typeof node['Index Name'] === 'string' ? [node['Index Name']] : []),
      ...((node.Plans as Record<string, unknown>[] | undefined) ?? []).flatMap(indexesOf),
    ];
    try {
      // [what the read is, its LIKE patterns]: contains, prefix + another word, the exact trade name.
      const reads: [string, string[]][] = [
        ['contains', ['%bruzitro%']],
        ['contains', ['%zitrocor%']],
        ['prefix', ['bruzi%']],
        ['prefix', ['neoprazol%']],
        ['prefix and a word', ['bruzi%', '%500mg%']],
        ['exact trade name', ['bruzitro|%']],
      ];
      for (const [read, patterns] of reads) {
        const likes = patterns.map((_, i) => `AND "searchText" LIKE $${i + 2} `).join('');
        const plan = await admin.query(
          `EXPLAIN (FORMAT JSON) SELECT "id" FROM "PhProduct" WHERE "restaurantId" = $1 AND "active" = true ${likes}` +
            `ORDER BY "tradeName" ASC, "id" ASC LIMIT 30`,
          [businesses[0]!.id, ...patterns],
        );
        expect(indexesOf(plan.rows[0]['QUERY PLAN'][0].Plan), `${read}: ${patterns.join(' ')}`).toContain('PhProduct_searchText_trgm');
      }
    } finally {
      await admin.end();
    }
  });

  it('answers 1,000 mixed queries from two clients at once with p95 under 150 ms', async () => {
    const [a, b] = businesses as [LoadPharmacyBusiness, LoadPharmacyBusiness];
    const runs = await Promise.all([
      run(clients[0]!, a, queriesFor(a, 1, QUERIES_PER_CLIENT)),
      run(clients[1]!, b, queriesFor(b, 2, QUERIES_PER_CLIENT)),
    ]);
    const samples = runs.flat();
    expect(samples).toHaveLength(1000);

    const row = (kind: string, list: Sample[]) => {
      const times = list.map((s) => s.ms).sort((x, y) => x - y);
      return {
        kind,
        n: times.length,
        p50: +percentile(times, 50).toFixed(1),
        p95: +percentile(times, 95).toFixed(1),
        p99: +percentile(times, 99).toFixed(1),
        max: +times[times.length - 1]!.toFixed(1),
      };
    };
    const kinds = [...new Set(samples.map((s) => s.kind))].sort();
    const all = row('all', samples);
    console.log(`\n[load] Pharmacy search, 2 concurrent clients, ${samples.length} queries (ms; limit ${P95_LIMIT_MS} for p95)`);
    console.table([all, ...kinds.map((k) => row(k, samples.filter((s) => s.kind === k)))]);
    expect(all.p95, `p95 ${all.p95} ms`).toBeLessThan(P95_LIMIT_MS);
  });
});
