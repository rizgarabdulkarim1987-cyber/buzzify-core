import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The report modules only read (phase 6, task 4; R6-7): no Prisma write, no `$executeRaw`, no SQL that changes a row, no
 * transaction. A source scan, with a negative self-test so it cannot pass by matching nothing.
 */

const FILES = ['src/server/pharmacy/reports.ts', 'src/server/pharmacy/reports-stock.ts', 'src/server/domain/pharmacy/reports-domain.ts', 'src/server/pharmacy/queries/reports.ts'];

const WRITES = [
  /\.(create|createMany|createManyAndReturn|update|updateMany|delete|deleteMany|upsert)\s*\(/,
  /\$executeRaw/,
  /\$transaction/,
  /\bctx\.audit\b/,
  /\b(INSERT\s+INTO|UPDATE\s+"|DELETE\s+FROM|TRUNCATE|ALTER\s+TABLE|DROP\s+TABLE|FOR\s+UPDATE|pg_advisory)/i,
];

const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const writesIn = (text: string) => WRITES.filter((re) => re.test(stripComments(text))).map(String);

describe('the report modules write nothing', () => {
  it('recognises writes, however they are spelled (negative self-test)', () => {
    expect(writesIn('await tx.phSale.update({ where, data });')).not.toEqual([]);
    expect(writesIn('await scoped.phReturn.deleteMany({});')).not.toEqual([]);
    expect(writesIn('await scoped.$executeRaw`UPDATE "PhSale" SET "x" = 1`;')).not.toEqual([]);
    expect(writesIn('await scoped.$queryRaw`DELETE FROM "PhSale" RETURNING *`;')).not.toEqual([]);
    expect(writesIn('await scoped.$queryRaw`SELECT 1 FROM "PhSale" FOR UPDATE`;')).not.toEqual([]);
    expect(writesIn('ctx.audit({ action: "x" });')).not.toEqual([]);
    expect(writesIn('// update(this) is a comment\nawait scoped.$queryRaw`SELECT 1`;')).toEqual([]);
  });

  it.each(FILES)('%s', (file) => {
    const text = readFileSync(file, 'utf8');
    expect(text.length).toBeGreaterThan(500);
    expect(writesIn(text), file).toEqual([]);
  });
});
