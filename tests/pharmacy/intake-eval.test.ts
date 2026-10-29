import { describe, expect, it } from 'vitest';
import { databaseTarget } from '../../scripts/database-target';
import {
  compareInvoice,
  evalRefusal,
  guessedCount,
  judge,
  parseCsv,
  parseTruth,
  percentile,
  renderTable,
  SAFETY_FLAG,
  tally,
  type InvoiceTruth,
} from '../../scripts/pharmacy-intake-eval-lib';

/** The comparison of the evaluation script (phase 5, task 10): pure, no network, no database. */

const NOW = new Date('2026-10-29T09:00:00.000Z');
const line = (over: Record<string, string | number | null> = {}) => ({ name: 'Panadol', strength: '500 mg', form: 'tablet', pack: '10 tablets', quantity: 10, bonus: null, unitCost: 1000, lineTotal: 10000, lot: 'L1', expiry: '2028-03', ...over });
const truth = (over: Partial<InvoiceTruth> = {}): InvoiceTruth => ({
  file: 'a.jpg',
  header: { supplierName: 'Al-Noor', invoiceNumber: 'INV-1', invoiceDate: '2026-10-01', currency: 'IQD', total: 10000 },
  lines: [line()],
  ...over,
});
const read = (header: Record<string, string | number | null> = {}, lines: Array<Record<string, string | number | null>> = [line()]) => ({
  header: { supplierName: 'Al-Noor', invoiceNumber: 'INV-1', invoiceDate: '2026-10-01', currency: 'IQD', total: 10000, ...header },
  lines,
});
const verdicts = (cells: ReturnType<typeof compareInvoice>) => cells.filter((c) => c.verdict !== 'CORRECT' && c.verdict !== 'NULL_CORRECT').map((c) => `${c.scope}.${c.field}${c.lineNo ? `#${c.lineNo}` : ''}=${c.verdict}`);

describe('judging one cell', () => {
  it.each([
    ['same text', 'Panadol', 'Panadol', 'CORRECT'],
    ['case and spaces do not matter', 'Panadol  500', 'panadol 500', 'CORRECT'],
    ['Arabic-Indic digits are digits', '١٢٣', '123', 'CORRECT'],
    ['another text', 'Panadol', 'Panadol Extra', 'WRONG'],
    ['null both', null, null, 'NULL_CORRECT'],
    ['blank is null', '', null, 'NULL_CORRECT'],
    ['a value the model did not read', 'L1', null, 'NULL_MISSED'],
    ['a value where the paper has none', null, 'L1', 'GUESSED'],
    ['a zero where the paper has none is still a value', null, 0, 'GUESSED'],
  ] as const)('%s', (_name, t, r, expected) => {
    expect(judge('lot', t, r, NOW)).toBe(expected);
  });

  it('numbers are compared as numbers, texts of digits too', () => {
    expect(judge('quantity', 10, '10', NOW)).toBe('CORRECT');
    expect(judge('unitCost', 1000, 1001, NOW)).toBe('WRONG');
    expect(judge('bonus', 0, null, NOW)).toBe('NULL_MISSED'); // a printed 0 is a value the model left out
  });

  it('dates match across spellings with the same day or month, and a month is not a day', () => {
    expect(judge('expiry', '2028-03', '03/2028', NOW)).toBe('CORRECT');
    expect(judge('expiry', '2028-03-31', '2028-03-31', NOW)).toBe('CORRECT');
    expect(judge('expiry', '2028-03', '2028-03-15', NOW)).toBe('WRONG');
    expect(judge('invoiceDate', '2026-10-01', '2026-10-02', NOW)).toBe('WRONG');
  });
});

describe('comparing an invoice', () => {
  it('a perfect reading has no wrong, missed or guessed cell, and the null bonus is correct as null', () => {
    const cells = compareInvoice(truth(), read(), NOW);
    expect(verdicts(cells)).toEqual([]);
    expect(cells).toHaveLength(5 + 10);
    expect(cells.find((c) => c.field === 'bonus')!.verdict).toBe('NULL_CORRECT');
  });

  it('names every kind of mistake at its cell', () => {
    const cells = compareInvoice(
      truth({ lines: [line({ lot: null })] }),
      read({ total: 9000, invoiceNumber: null }, [line({ lot: 'INVENTED', unitCost: null, name: 'Brufen' })]),
      NOW,
    );
    expect(verdicts(cells)).toEqual(['header.invoiceNumber=NULL_MISSED', 'header.total=WRONG', 'line.name#1=WRONG', 'line.unitCost#1=NULL_MISSED', 'line.lot#1=GUESSED']);
  });

  it('a line the model added is guessed in every value, a line it dropped is missed in every value', () => {
    const added = compareInvoice(truth(), read({}, [line(), line({ name: 'Extra', lot: 'X' })]), NOW);
    expect(added.filter((c) => c.verdict === 'GUESSED' && c.lineNo === 2).map((c) => c.field)).toEqual(['name', 'strength', 'form', 'pack', 'quantity', 'unitCost', 'lineTotal', 'lot', 'expiry']);
    const dropped = compareInvoice(truth({ lines: [line(), line({ name: 'Second' })] }), read(), NOW);
    expect(dropped.filter((c) => c.verdict === 'NULL_MISSED' && c.lineNo === 2)).toHaveLength(9);
    expect(dropped.some((c) => c.verdict === 'GUESSED')).toBe(false);
  });

  it('tallies per field and in total, and the guessed count drives the exit code', () => {
    const t = tally(compareInvoice(truth({ lines: [line({ lot: null })] }), read({}, [line({ lot: 'INVENTED' })]), NOW));
    expect(t['line.lot']).toEqual({ CORRECT: 0, NULL_CORRECT: 0, NULL_MISSED: 0, WRONG: 0, GUESSED: 1 });
    expect(t.TOTAL).toEqual({ CORRECT: 13, NULL_CORRECT: 1, NULL_MISSED: 0, WRONG: 0, GUESSED: 1 });
    expect(guessedCount(t)).toBe(1);
    expect(guessedCount(tally(compareInvoice(truth(), read(), NOW)))).toBe(0);
    const table = renderTable(t);
    expect(table.split('\n')[0]).toMatch(/field\s+CORRECT\s+NULL_CORRECT\s+NULL_MISSED\s+WRONG\s+GUESSED/);
    expect(table.split('\n').at(-1)).toMatch(/^TOTAL\s+13\s+1\s+0\s+0\s+1$/);
  });

  it('p95 of a few values is the value that 95% are below', () => {
    expect(percentile([], 0.95)).toBe(0);
    expect(percentile([1, 2, 3, 4, 100], 0.95)).toBe(100);
    expect(percentile(Array.from({ length: 100 }, (_, i) => i + 1), 0.95)).toBe(95);
  });
});

describe('the truth file', () => {
  const csv = [
    'file,supplierName,invoiceNumber,invoiceDate,currency,total,lines',
    `a.jpg,"Al-Noor, Pharma",INV-1,2026-10-01,IQD,"10,000","[{""name"":""Panadol"",""quantity"":10,""unitCost"":1000,""lineTotal"":10000,""lot"":null}]"`,
    'b.pdf,,,,,,',
  ].join('\r\n');

  it('reads quoted commas, JSON lines, blank cells as null and money with thousands separators', () => {
    const rows = parseTruth(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ file: 'a.jpg', header: { supplierName: 'Al-Noor, Pharma', invoiceNumber: 'INV-1', total: 10000 } });
    expect(rows[0]!.lines).toEqual([{ name: 'Panadol', strength: null, form: null, pack: null, quantity: 10, bonus: null, unitCost: 1000, lineTotal: 10000, lot: null, expiry: null }]);
    expect(rows[1]).toMatchObject({ file: 'b.pdf', header: { supplierName: null, total: null }, lines: [] });
  });

  it('refuses a missing column, a repeated file, bad JSON and a text where a number belongs', () => {
    expect(() => parseTruth('file,total\na,1')).toThrow(/no "supplierName" column/);
    expect(() => parseTruth(`${csv}\r\na.jpg,,,,,,`)).toThrow(/names a.jpg twice/);
    expect(() => parseTruth('file,supplierName,invoiceNumber,invoiceDate,currency,total,lines\na.jpg,,,,,,{nope')).toThrow(/not valid JSON/);
    expect(() => parseTruth('file,supplierName,invoiceNumber,invoiceDate,currency,total,lines\na.jpg,,,,,abc,')).toThrow(/not a number/);
    expect(() => parseTruth('')).toThrow(/empty/);
  });

  it('parses a quoted field with a line break and an escaped quote', () => {
    expect(parseCsv('a,"b\nc","d ""e"""\n')).toEqual([['a', 'b\nc', 'd "e"']]);
  });
});

describe('where the script may run', () => {
  const target = (url: string) => databaseTarget(url);
  const local = 'postgresql://postgres:postgres@127.0.0.1:54503/buzzify_test';
  const refusal = (argv: string[], env: Record<string, string | undefined>, url?: string) => evalRefusal({ argv, env, target: url ? target(url) : null });

  it('needs the flag', () => {
    expect(refusal([], { BUZZIFY_DB_PORT: '54503' })).toMatch(/pass --i-know-this-is-not-production/);
    expect(refusal([SAFETY_FLAG], { BUZZIFY_DB_PORT: '54503' })).toBeNull();
  });

  it('refuses production, a deployment and a missing port', () => {
    expect(refusal([SAFETY_FLAG], { NODE_ENV: 'production', BUZZIFY_DB_PORT: '54503' })).toMatch(/production/);
    expect(refusal([SAFETY_FLAG], { VERCEL: '1', BUZZIFY_DB_PORT: '54503' })).toMatch(/deployment/);
    expect(refusal([SAFETY_FLAG], {})).toMatch(/BUZZIFY_DB_PORT/);
  });

  it('accepts a local database ending in test or eval, and refuses everything else', () => {
    expect(refusal([SAFETY_FLAG], { DATABASE_URL: local }, local)).toBeNull();
    expect(refusal([SAFETY_FLAG], { DATABASE_URL: 'x' }, 'postgresql://u:p@localhost/pharmacy_eval')).toBeNull();
    expect(refusal([SAFETY_FLAG], { DATABASE_URL: 'x' }, 'postgresql://u:p@127.0.0.1:5432/buzzify')).toMatch(/name must end/);
    expect(refusal([SAFETY_FLAG], { DATABASE_URL: 'x' }, 'postgresql://u:p@db.example.com/buzzify_test')).toMatch(/not point at this machine/);
    // pg's `host` parameter replaces the host: the check goes by where pg really connects
    expect(refusal([SAFETY_FLAG], { DATABASE_URL: 'x' }, 'postgresql://u:p@127.0.0.1/buzzify_test?host=db.example.com')).toMatch(/not point at this machine/);
    expect(refusal([SAFETY_FLAG], { DATABASE_URL: 'x' }, 'postgresql://u:p@%2Fcloudsql%2Fproject/buzzify_test')).toMatch(/not point at this machine/);
    expect(refusal([SAFETY_FLAG], { DATABASE_URL: 'not a url' })).toMatch(/not a connection URL/);
  });
});
