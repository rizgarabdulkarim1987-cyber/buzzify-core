import { parseExpiry } from '@/server/domain/pharmacy/intake';

/**
 * The pure part of the invoice-intake evaluation (`scripts/pharmacy-intake-eval.ts`): reading the truth file, comparing what the
 * model read with what the paper says, tallying and printing. No database, no network, no clock (`now` comes in).
 *
 * Each cell is judged against the truth by one rule, so a person can read the table without a legend:
 *   CORRECT      the paper has a value and the pipeline read the same value
 *   NULL_CORRECT the paper has no value (or none that can be read) and the pipeline left it null
 *   NULL_MISSED  the paper has a value and the pipeline left it null (safe: the person types it, but it costs time)
 *   WRONG        the paper has a value and the pipeline read another one
 *   GUESSED      the paper has no value and the pipeline wrote one (the one verdict that must be ZERO)
 * Money in the truth file is in minor units like the pipeline's own: whole dinars for IQD, cents for USD.
 */

export type Verdict = 'CORRECT' | 'NULL_CORRECT' | 'NULL_MISSED' | 'WRONG' | 'GUESSED';
export const VERDICTS: readonly Verdict[] = ['CORRECT', 'NULL_CORRECT', 'NULL_MISSED', 'WRONG', 'GUESSED'];

export const HEADER_FIELDS = ['supplierName', 'invoiceNumber', 'invoiceDate', 'currency', 'total'] as const;
export const LINE_FIELDS = ['name', 'strength', 'form', 'pack', 'quantity', 'bonus', 'unitCost', 'lineTotal', 'lot', 'expiry'] as const;
const NUMBER_FIELDS = new Set<string>(['quantity', 'bonus', 'unitCost', 'lineTotal', 'total']);
const DATE_FIELDS = new Set<string>(['invoiceDate', 'expiry']);

export type Scalar = string | number | null;
export type HeaderTruth = Record<(typeof HEADER_FIELDS)[number], Scalar>;
export type LineTruth = Record<(typeof LINE_FIELDS)[number], Scalar>;
export interface InvoiceTruth {
  file: string;
  header: HeaderTruth;
  lines: LineTruth[];
}
/** What the pipeline read: the same shapes, taken from the stored model reading (never from a person's edit). */
export interface InvoiceRead {
  header: Partial<Record<(typeof HEADER_FIELDS)[number], Scalar | undefined>>;
  lines: Array<Partial<Record<(typeof LINE_FIELDS)[number], Scalar | undefined>>>;
}

export interface Cell {
  scope: 'header' | 'line';
  field: string;
  /** 1-based, for a line. */
  lineNo?: number;
  verdict: Verdict;
}

// The truth file -----------------------------------------------------------------------------------------------------------

/** RFC 4180 as far as a truth file needs: commas, double quotes with `""` inside, quoted fields may hold commas and line breaks. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((cell) => cell !== '')) rows.push(row);
  return rows;
}

const blank = (v: string): Scalar => (v.trim() === '' ? null : v.trim());

/** `file,supplierName,invoiceNumber,invoiceDate,currency,total,lines` where `lines` is a JSON array of objects with the LINE_FIELDS (a missing key or null means "not on the paper"). */
export function parseTruth(text: string): InvoiceTruth[] {
  const [head, ...body] = parseCsv(text);
  if (!head) throw new Error('The truth file is empty');
  const col = (name: string) => {
    const at = head.map((h) => h.trim()).indexOf(name);
    if (at === -1) throw new Error(`The truth file has no "${name}" column`);
    return at;
  };
  const at = Object.fromEntries(['file', ...HEADER_FIELDS, 'lines'].map((name) => [name, col(name)])) as Record<string, number>;
  const seen = new Set<string>();
  return body.map((cells, index) => {
    const file = (cells[at.file!] ?? '').trim();
    if (file === '') throw new Error(`Truth row ${index + 2} has no file name`);
    if (seen.has(file)) throw new Error(`The truth file names ${file} twice`);
    seen.add(file);
    const header = Object.fromEntries(
      HEADER_FIELDS.map((f) => {
        const raw = blank(cells[at[f]!] ?? '');
        return [f, raw !== null && NUMBER_FIELDS.has(f) ? numberOf(raw, `${file}: ${f}`) : raw];
      }),
    ) as HeaderTruth;
    let parsed: unknown;
    try {
      parsed = (cells[at.lines!] ?? '').trim() === '' ? [] : JSON.parse(cells[at.lines!]!);
    } catch {
      throw new Error(`${file}: the "lines" column is not valid JSON`);
    }
    if (!Array.isArray(parsed)) throw new Error(`${file}: the "lines" column must be a JSON array`);
    const lines = parsed.map((item, i): LineTruth => {
      if (item === null || typeof item !== 'object' || Array.isArray(item)) throw new Error(`${file}: line ${i + 1} is not an object`);
      const o = item as Record<string, unknown>;
      return Object.fromEntries(
        LINE_FIELDS.map((f) => {
          const v = o[f];
          if (v === undefined || v === null || v === '') return [f, null];
          if (typeof v === 'number' || typeof v === 'string') return [f, NUMBER_FIELDS.has(f) ? numberOf(v, `${file}: line ${i + 1} ${f}`) : String(v)];
          throw new Error(`${file}: line ${i + 1} ${f} must be text or a number`);
        }),
      ) as LineTruth;
    });
    return { file, header, lines };
  });
}

function numberOf(value: string | number, where: string): number {
  const n = typeof value === 'number' ? value : Number(value.replace(/[\s,]/g, ''));
  if (!Number.isFinite(n)) throw new Error(`${where} is not a number`);
  return n;
}

// Comparing ----------------------------------------------------------------------------------------------------------------

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const EASTERN = '۰۱۲۳۴۵۶۷۸۹';
const latinDigits = (s: string) => s.replace(/[٠-٩۰-۹]/g, (d) => String(ARABIC_INDIC.includes(d) ? ARABIC_INDIC.indexOf(d) : EASTERN.indexOf(d)));
const textKey = (v: string) => latinDigits(v).normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

const isEmpty = (v: Scalar | undefined) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

function same(field: string, truth: Scalar, read: Scalar, now: Date): boolean {
  if (NUMBER_FIELDS.has(field)) return Number(typeof truth === 'string' ? latinDigits(truth) : truth) === Number(typeof read === 'string' ? latinDigits(read) : read);
  if (DATE_FIELDS.has(field)) {
    const a = parseExpiry(String(truth), now);
    const b = parseExpiry(String(read), now);
    if (a && b) return a.date === b.date && a.precision === b.precision;
  }
  return textKey(String(truth)) === textKey(String(read));
}

export function judge(field: string, truth: Scalar | undefined, read: Scalar | undefined, now: Date): Verdict {
  const t = isEmpty(truth);
  const r = isEmpty(read);
  if (t && r) return 'NULL_CORRECT';
  if (t) return 'GUESSED';
  if (r) return 'NULL_MISSED';
  return same(field, truth as Scalar, read as Scalar, now) ? 'CORRECT' : 'WRONG';
}

/**
 * Every cell of one invoice. Lines are compared by position (the model keeps the paper's order). A line the model added beyond the
 * paper has every value it wrote GUESSED; a line it dropped has every value on the paper NULL_MISSED.
 */
export function compareInvoice(truth: InvoiceTruth, read: InvoiceRead, now: Date): Cell[] {
  const cells: Cell[] = HEADER_FIELDS.map((field) => ({ scope: 'header', field, verdict: judge(field, truth.header[field], read.header[field], now) }));
  const count = Math.max(truth.lines.length, read.lines.length);
  for (let i = 0; i < count; i += 1) {
    for (const field of LINE_FIELDS) {
      cells.push({ scope: 'line', field, lineNo: i + 1, verdict: judge(field, truth.lines[i]?.[field] ?? null, read.lines[i]?.[field] ?? null, now) });
    }
  }
  return cells;
}

// Tallying and printing ------------------------------------------------------------------------------------------------------

export type Tally = Record<string, Record<Verdict, number>>;
const zero = (): Record<Verdict, number> => ({ CORRECT: 0, NULL_CORRECT: 0, NULL_MISSED: 0, WRONG: 0, GUESSED: 0 });

/** Counts per field name (`header.total`, `line.lot`, ...) and a `TOTAL` row. */
export function tally(cells: readonly Cell[]): Tally {
  const out: Tally = { TOTAL: zero() };
  for (const cell of cells) {
    const key = `${cell.scope}.${cell.field}`;
    (out[key] ??= zero())[cell.verdict] += 1;
    out.TOTAL![cell.verdict] += 1;
  }
  return out;
}

export const guessedCount = (t: Tally): number => t.TOTAL?.GUESSED ?? 0;

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))]!;
}

/** The table the script prints: one row per field, the five verdicts as columns, TOTAL last. */
export function renderTable(t: Tally): string {
  const names = Object.keys(t)
    .filter((k) => k !== 'TOTAL')
    .sort();
  const header = ['field', ...VERDICTS];
  const rows = [...names, 'TOTAL'].map((name) => [name, ...VERDICTS.map((v) => String(t[name]![v]))]);
  const width = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => (i === 0 ? c.padEnd(width[i]!) : c.padStart(width[i]!))).join('  ');
  return [line(header), line(width.map((w) => '-'.repeat(w))), ...rows.map(line)].join('\n');
}

// Where the script may run -----------------------------------------------------------------------------------------------------

export const SAFETY_FLAG = '--i-know-this-is-not-production';
const DEPLOYMENT_MARKERS = ['VERCEL', 'HOSTINGER', 'RENDER'] as const;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/**
 * Why the evaluation must not run here, or null. It writes a throwaway business and spends the AI budget of a real provider key,
 * so it refuses everything but a local test database: the safety flag must be given, never in production or on a deployment,
 * and a `DATABASE_URL` must be on this machine (a Unix socket can reach a hosted database, so it is refused too) and name a
 * database whose name ends in `test` or `eval`. Without a `DATABASE_URL` the local test database on `BUZZIFY_DB_PORT` is used,
 * and the port must be set explicitly.
 */
export function evalRefusal(args: { argv: readonly string[]; env: Record<string, string | undefined>; target: { host: string; database: string } | null }): string | null {
  const { argv, env, target } = args;
  if (!argv.includes(SAFETY_FLAG)) return `Refused: pass ${SAFETY_FLAG} to say this database may be written to and that the AI key may be spent.`;
  if (env.NODE_ENV === 'production') return 'Refused: NODE_ENV is production.';
  const marker = DEPLOYMENT_MARKERS.find((key) => env[key]?.trim());
  if (marker) return `Refused: ${marker} is set, so this looks like a deployment.`;
  if (env.DATABASE_URL) {
    if (!target) return 'Refused: DATABASE_URL is not a connection URL.';
    if (!LOOPBACK.has(target.host)) return 'Refused: DATABASE_URL does not point at this machine.';
    if (!/(^|[_-])(test|eval)$/i.test(target.database)) return 'Refused: the database name must end in "test" or "eval".';
    return null;
  }
  if (!env.BUZZIFY_DB_PORT?.trim()) return 'Refused: set BUZZIFY_DB_PORT (the local test database) or DATABASE_URL (a local database ending in "test" or "eval").';
  return null;
}
