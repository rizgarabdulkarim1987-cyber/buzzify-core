import { readdirSync, readFileSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@/generated/prisma/client';
import * as reports from '@/server/pharmacy/queries/reports';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runQuery, type QueryDef } from '@/server/studio/framework/query';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { NOW, prisma, resetWorld, useTestDatabase } from './fixture';
import { at, build, dataOf, type Biz } from './reports-world';

/**
 * The reports only read (phase 6, task 4; R6-7), checked two ways:
 *  1. a source scan of every report module (expiry.ts also holds the expiry actions, which write, so the read-only connection below covers the list the report calls), with a negative self-test so the scan cannot
 *     pass by matching nothing;
 *  2. a run of every report on a connection that the database itself holds read-only (`default_transaction_read_only`): any
 *     write, however it is reached (an imported helper included), is refused by PostgreSQL and fails the test.
 */

const FILES = [
  ...readdirSync('src/server/pharmacy')
    .filter((f) => /^reports(-[a-z]+)?\.ts$/.test(f))
    .map((f) => `src/server/pharmacy/${f}`),
  'src/server/domain/pharmacy/reports-domain.ts',
  'src/server/pharmacy/queries/reports.ts',
];

const WRITES = [
  /\.(create|createMany|createManyAndReturn|update|updateMany|delete|deleteMany|upsert)\s*\(/,
  /\$executeRaw/,
  /\$transaction/,
  /\bctx\.audit\b/,
  /\b(INSERT\s+INTO|UPDATE\s+"|DELETE\s+FROM|TRUNCATE|ALTER\s+TABLE|DROP\s+TABLE|FOR\s+UPDATE|pg_advisory)/i,
];

const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const writesIn = (text: string) => WRITES.filter((re) => re.test(stripComments(text))).map(String);

describe('the report modules write nothing (source scan)', () => {
  it('recognises writes, however they are spelled (negative self-test)', () => {
    expect(writesIn('await tx.phSale.update({ where, data });')).not.toEqual([]);
    expect(writesIn('await scoped.phReturn.deleteMany({});')).not.toEqual([]);
    expect(writesIn('await scoped.$executeRaw`UPDATE "PhSale" SET "x" = 1`;')).not.toEqual([]);
    expect(writesIn('await scoped.$queryRaw`DELETE FROM "PhSale" RETURNING *`;')).not.toEqual([]);
    expect(writesIn('await scoped.$queryRaw`SELECT 1 FROM "PhSale" FOR UPDATE`;')).not.toEqual([]);
    expect(writesIn('ctx.audit({ action: "x" });')).not.toEqual([]);
    expect(writesIn('// update(this) is a comment\nawait scoped.$queryRaw`SELECT 1`;')).toEqual([]);
  });

  it('finds the report modules (the list is not empty and holds the split files)', () => {
    for (const name of ['reports.ts', 'reports-common.ts', 'reports-margin.ts', 'reports-stock.ts', 'reports-ledger.ts']) expect(FILES).toContain(`src/server/pharmacy/${name}`);
  });

  it.each(FILES)('%s', (file) => {
    const text = readFileSync(file, 'utf8');
    expect(text.length).toBeGreaterThan(300);
    expect(writesIn(text), file).toEqual([]);
  });
});

describe('every report runs on a connection the database holds read-only', () => {
  let w: Biz;
  let client: PrismaClient;
  beforeAll(async () => {
    useTestDatabase();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    await resetWorld();
    w = await build('O', false);
    const url = `${databaseUrl(TEST_DB)}${databaseUrl(TEST_DB).includes('?') ? '&' : '?'}options=-c%20default_transaction_read_only%3Don`;
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  }, 120_000);
  afterAll(async () => {
    await client.$disconnect();
    vi.useRealTimers();
  });

  it('the connection really is read-only (a write is refused by the database)', async () => {
    // eslint-disable-next-line no-restricted-properties -- the test proves its own connection refuses writes
    await expect(client.$executeRaw`UPDATE "PhSettings" SET "maxDiscountPercent" = 6 WHERE "restaurantId" = ${w.a.id}`).rejects.toThrow(/read-only/i);
    expect((await prisma().phSettings.findUniqueOrThrow({ where: { restaurantId: w.a.id } })).maxDiscountPercent).toBe(5);
  });

  const PERIOD = { from: '2026-10-27', to: '2026-10-28' };
  const CASES: Array<[string, Record<string, unknown>]> = [
    ['sales', { ...PERIOD, groupBy: 'product' }],
    ['returns', { ...PERIOD }],
    ['discounts', { ...PERIOD }],
    ['margin', { ...PERIOD }],
    ['stockValuationQuery', {}],
    ['expiry', {}],
    ['damaged', { ...PERIOD }],
    ['transfers', { ...PERIOD }],
    ['lowStock', {}],
  ];
  it.each(CASES)('%s', async (name, input) => {
    const actor = (await loadActor(prisma(), w.owner.userId)) as Actor;
    const def = (reports as unknown as Record<string, QueryDef<unknown, unknown>>)[name]!;
    dataOf(await runQuery(client, actor, def, { ...at(w), ...input }));
  });
});
