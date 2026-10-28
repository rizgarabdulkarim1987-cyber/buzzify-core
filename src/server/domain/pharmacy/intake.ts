/**
 * The pure rules of invoice intake (phase 5): GS1 and date/number reading, the strict shape of what the model may return,
 * the arithmetic checks, row flags, product matching, the image quality gate, the PDF page counter and the AI budget maths.
 * No Prisma, no database, no clock (`now` and `today` come in as arguments), no Float for money: money is BigInt (or a safe
 * integer that is converted at the edge) in the document currency's minor unit. Barcodes and lots are text, never numbers.
 *
 * Nothing here completes a missing value: an unreadable or absent input gives `null` / `UNKNOWN`, and the person decides.
 */
import { z } from 'zod';
import { normalizeScan } from './barcode';
import { identityKeyOf, normalizeForSearch } from './product-identity';

// ---------------------------------------------------------------------------------------------------------------------
// Dates

export type Precision = 'MONTH' | 'DAY';
export type ExpiryValue = { date: string; precision: Precision };

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');
const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** A real calendar day as `YYYY-MM-DD`; day 0 means the last day of the month (MONTH precision). */
function calendar(year: number, month: number, day: number | 'LAST'): ExpiryValue | null {
  if (month < 1 || month > 12) return null;
  const last = daysInMonth(year, month);
  if (day === 'LAST') return { date: `${pad(year, 4)}-${pad(month)}-${pad(last)}`, precision: 'MONTH' };
  if (day < 1 || day > last) return null;
  return { date: `${pad(year, 4)}-${pad(month)}-${pad(day)}`, precision: 'DAY' };
}

/**
 * Expiry as printed on an invoice or box. Month-only forms mean the last day of that month. A two-digit year 00..79 is the
 * 2000s and is accepted only inside [now - 10 years, now + 15 years] (a misread digit is far more likely than a drug that old
 * or that far ahead); 80..99 is refused. Four-digit years must be 2000..2099.
 */
export function parseExpiry(text: string, now: Date): ExpiryValue | null {
  const t = normalizeScan(text).replace(/\s+/g, '');
  const num = (s: string): number => Number(s);
  const twoDigitYear = (yy: string): number | null => (num(yy) <= 79 ? 2000 + num(yy) : null);
  const fourDigitYear = (yyyy: string): number | null => (num(yyyy) >= 2000 && num(yyyy) <= 2099 ? num(yyyy) : null);
  let m: RegExpExecArray | null;
  let result: ExpiryValue | null = null;
  let windowed = false;

  if ((m = /^(\d{4})[-/.](\d{2})[-/.](\d{2})(?:T.*)?$/.exec(t))) {
    const y = fourDigitYear(m[1]!);
    result = y === null ? null : calendar(y, num(m[2]!), num(m[3]!));
  } else if ((m = /^(\d{4})[-/.](\d{2})$/.exec(t))) {
    const y = fourDigitYear(m[1]!);
    result = y === null ? null : calendar(y, num(m[2]!), 'LAST');
  } else if ((m = /^(\d{2})[-/.](\d{2})[-/.](\d{4})$/.exec(t))) {
    const y = fourDigitYear(m[3]!);
    result = y === null ? null : calendar(y, num(m[2]!), num(m[1]!));
  } else if ((m = /^(\d{2})[-/.](\d{4})$/.exec(t))) {
    const y = fourDigitYear(m[2]!);
    result = y === null ? null : calendar(y, num(m[1]!), 'LAST');
  } else if ((m = /^(\d{2})[-/.](\d{2})$/.exec(t))) {
    const y = twoDigitYear(m[2]!);
    result = y === null ? null : calendar(y, num(m[1]!), 'LAST');
    windowed = true;
  } else if ((m = /^(\d{2})(\d{2})$/.exec(t))) {
    const y = twoDigitYear(m[1]!);
    result = y === null ? null : calendar(y, num(m[2]!), 'LAST');
    windowed = true;
  }
  if (result && windowed) {
    const md = `${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
    const low = `${pad(now.getUTCFullYear() - 10, 4)}-${md}`;
    const high = `${pad(now.getUTCFullYear() + 15, 4)}-${md}`;
    if (result.date < low || result.date > high) return null;
  }
  return result;
}

// ---------------------------------------------------------------------------------------------------------------------
// GS1

export type Gs1 = { gtin?: string; lot?: string; expiry?: ExpiryValue };

const GS = '\x1d';

function gtinCheckOk(gtin: string): boolean {
  let sum = 0;
  for (let i = 12, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += Number(gtin[i]) * w;
  return (10 - (sum % 10)) % 10 === Number(gtin[13]);
}

/** The AIs read here: 01 GTIN-14, 10 lot, 17 expiry; 11 (production date) and 21 (serial) are accepted and ignored. */
const FIXED_AI: Record<string, number> = { '01': 14, '11': 6, '17': 6 };
const VARIABLE_AI = new Set(['10', '21']);

/**
 * GS1 element string as scanned: either `(01)…(17)…(10)…` or the raw form with GS (0x1D / FNC1) ending a variable-length
 * value. Without GS a variable value runs to the end, so the lot must come last. Returns null when the text is not GS1
 * or any part is invalid (bad GTIN check digit, impossible date, lot over 20 characters, unknown AI, repeated AI).
 */
export function parseGs1(text: string): Gs1 | null {
  let s = normalizeScan(text);
  // A symbology identifier says what was scanned: only the GS1 ones (GS1-128, DataMatrix, GS1 QR, GS1 DataBar) are element
  // strings; EAN/UPC (`]E`, `]A`) and any other kind are plain barcodes.
  let gs1Symbology = false;
  const symbology = /^\][A-Za-z]\d/.exec(s);
  if (symbology) {
    if (!/^\](?:C1|d2|e0|Q3)/.test(s)) return null;
    gs1Symbology = true;
    s = s.slice(3);
  }
  s = s.replace(/\s*([()])\s*/g, '$1'); // the printed form has spaces: (01) 0628... (17) 271100
  if (s === '') return null;
  const pairs: Array<[string, string]> = [];
  if (s.includes('(')) {
    if (!/^(?:\(\d{2}\)[^()]*)+$/.test(s)) return null;
    for (const m of s.matchAll(/\((\d{2})\)([^()]*)/g)) pairs.push([m[1]!, m[2]!.replaceAll(GS, '')]);
  } else {
    // Bare digits (an EAN-13, UPC-A or ITF-14 that happens to start with 10) are not element strings. The raw form needs a
    // GS1 symbology id, a leading FNC1, or to start with AI 01 followed by a GTIN-14 whose check digit is right.
    const startsWithGtin = s.startsWith('01') && /^\d{14}/.test(s.slice(2)) && gtinCheckOk(s.slice(2, 16));
    if (!gs1Symbology && s[0] !== GS && !startsWithGtin) return null;
    let i = 0;
    while (i < s.length) {
      if (s[i] === GS) {
        i++;
        continue;
      }
      const ai = s.slice(i, i + 2);
      if (!/^\d{2}$/.test(ai)) return null;
      i += 2;
      const fixed = FIXED_AI[ai];
      if (fixed !== undefined) {
        pairs.push([ai, s.slice(i, i + fixed)]);
        i += fixed;
      } else if (VARIABLE_AI.has(ai)) {
        const end = s.indexOf(GS, i);
        const stop = end === -1 ? s.length : end;
        const value = s.slice(i, stop);
        // Scanners often drop FNC1: an unterminated lot that ends in what looks like an expiry element swallowed it.
        if (ai === '10' && end === -1 && /17\d{6}$/.test(value) && calendar(2000 + Number(value.slice(-6, -4)), Number(value.slice(-4, -2)), Number(value.slice(-2)) || 'LAST')) return null;
        pairs.push([ai, value]);
        i = stop;
      } else {
        return null;
      }
    }
  }
  const out: Gs1 = {};
  const seen = new Set<string>();
  for (const [ai, value] of pairs) {
    if (seen.has(ai)) return null;
    seen.add(ai);
    if (ai === '01') {
      if (!/^\d{14}$/.test(value) || !gtinCheckOk(value)) return null;
      out.gtin = value;
    } else if (ai === '10' || ai === '21') {
      if (!/^[\x21-\x7e]{1,20}$/.test(value)) return null;
      if (ai === '10') out.lot = value;
    } else if (ai === '11' || ai === '17') {
      if (!/^\d{6}$/.test(value)) return null;
      const year = 2000 + Number(value.slice(0, 2));
      const day = Number(value.slice(4, 6));
      const date = calendar(year, Number(value.slice(2, 4)), day === 0 ? 'LAST' : day);
      if (!date) return null;
      if (ai === '17') out.expiry = date;
    } else {
      return null;
    }
  }
  return out.gtin === undefined && out.lot === undefined && out.expiry === undefined ? null : out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Quantity and money text

/**
 * A whole positive count; digit scripts normalised. A thousands separator is a comma or one kind of space in groups of
 * three, never mixed, never after a leading 0. A `.` or `٫` is not accepted at all: `12.000` may be twelve (ERP print) or
 * twelve thousand, so it is null rather than a guess.
 */
export function parseQuantity(text: string): number | null {
  const t = normalizeScan(text).replace(/[٬،]/g, ',');
  if (!/^(?:\d+|[1-9]\d{0,2}(?:,\d{3})+|[1-9]\d{0,2}(?: \d{3})+|[1-9]\d{0,2}(?:\u00a0\d{3})+)$/.test(t)) return null;
  const n = Number(t.replace(/[,\s\u00a0]/g, ''));
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * Money text to minor units. `,` is a thousands separator (groups of three) and `.` a decimal point; anything that could be
 * read two ways gives null instead of a guess: for IQD (no decimals) `1.234` and `1,5` are null, `1,500` and `1,500.00`
 * are 1500; for USD a comma decimal (`12,50`) and three decimals are null.
 */
export function parseMoneyMinor(text: string, currency: 'IQD' | 'USD'): bigint | null {
  let t = normalizeScan(text).replace(/٬/g, ',').replace(/٫/g, '.');
  // A currency marker must agree with the currency asked for; one that names the other (or both) is a different amount.
  const marks = new Set<string>();
  t = t.replace(/د\.ع|دينار|iqd/gi, () => (marks.add('IQD'), '')).replace(/دولار|usd|\$/gi, () => (marks.add('USD'), ''));
  if (marks.size > 1 || (marks.size === 1 && !marks.has(currency))) return null;
  t = t.replace(/\s+/g, '');
  // a leading 0 group (`0,500`) is a European decimal, not a thousands group
  const m = /^([1-9]\d{0,2}(?:,\d{3})+|\d+)(?:\.(\d+))?$/.exec(t);
  if (!m) return null;
  const whole = m[1]!.replaceAll(',', '');
  if (whole.length > 15) return null;
  const frac = m[2];
  if (currency === 'IQD') {
    if (frac !== undefined && !(frac.length <= 2 && /^0+$/.test(frac))) return null;
    return BigInt(whole);
  }
  if (frac === undefined) return BigInt(whole) * 100n;
  if (frac.length > 2) return null;
  return BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0'));
}

// ---------------------------------------------------------------------------------------------------------------------
// What the model may return

const MAX_LINES = 200;

/** Trimmed, length-capped (cut, not refused), blank or missing becomes null. */
const text = (max: number) =>
  z
    .string()
    .nullable()
    .optional()
    .transform((v) => {
      if (v === null || v === undefined) return null;
      const t = v.trim().slice(0, max);
      return t === '' ? null : t;
    });

/** A whole number or null; money is minor units, quantities whole units. */
const wholeNumber = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER)
  .nullable()
  .optional()
  .transform((v) => v ?? null);

const notes = z
  .array(z.string())
  .nullable()
  .optional()
  .transform((v) =>
    (v ?? [])
      .map((n) => n.trim().slice(0, 200))
      .filter((n) => n !== '')
      .slice(0, 20),
  );

const headerSchema = z.object({
  supplierName: text(200),
  invoiceNumber: text(100),
  invoiceDate: text(40),
  currency: z
    .string()
    .nullable()
    .optional()
    .transform((v) => {
      const c = (v ?? '').trim().toUpperCase();
      return c === 'IQD' || c === 'USD' ? c : null;
    }),
  total: wholeNumber,
  discount: wholeNumber,
  tax: wholeNumber,
  unclear: notes,
});

const lineSchema = z.object({
  name: text(200),
  strength: text(60),
  form: text(60),
  pack: text(60),
  quantity: wholeNumber,
  bonus: wholeNumber,
  unitCost: wholeNumber,
  lineTotal: wholeNumber,
  lot: text(100),
  expiry: text(40),
  barcodeText: text(200),
  unclear: notes,
  page: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
});

/** The field sets, exported so a test can pin that `extractionJsonSchema` lists exactly these. */
export const extractionShapes = { header: headerSchema.shape, line: lineSchema.shape };

export const extractionSchema = z.object({
  header: headerSchema,
  lines: z.array(lineSchema).max(MAX_LINES),
});

export type Extraction = z.output<typeof extractionSchema>;
export type ExtractedLine = Extraction['lines'][number];
export type ExtractedHeader = Extraction['header'];

export type ExtractionResult =
  | { ok: true; value: Extraction }
  | { ok: false; code: 'EXTRACTION_INVALID'; line?: number }
  | { ok: false; code: 'TOO_MANY_LINES' };

/** Re-validates what the model returned. A bad line reports its index; more than 200 lines is its own code. */
export function parseExtraction(raw: unknown): ExtractionResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, code: 'EXTRACTION_INVALID' };
  const { header, lines } = raw as { header?: unknown; lines?: unknown };
  if (!Array.isArray(lines)) return { ok: false, code: 'EXTRACTION_INVALID' };
  if (lines.length > MAX_LINES) return { ok: false, code: 'TOO_MANY_LINES' };
  const h = headerSchema.safeParse(header);
  if (!h.success) return { ok: false, code: 'EXTRACTION_INVALID' };
  const parsed: ExtractedLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lineSchema.safeParse(lines[i]);
    if (!l.success) return { ok: false, code: 'EXTRACTION_INVALID', line: i };
    parsed.push(l.data);
  }
  return { ok: true, value: { header: h.data, lines: parsed } };
}

const nullable = (type: 'string' | 'integer', extra: Record<string, unknown> = {}) => ({ type: [type, 'null'], ...extra });
const objectOf = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const unclearNotes = { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 200 } };

/** The same shape for the provider: strict, every property required and nullable (the model says null, never invents). */
export const extractionJsonSchema = objectOf({
  header: objectOf({
    supplierName: nullable('string', { maxLength: 200 }),
    invoiceNumber: nullable('string', { maxLength: 100 }),
    invoiceDate: nullable('string', { maxLength: 40 }),
    currency: { type: ['string', 'null'], enum: ['IQD', 'USD', null] },
    total: nullable('integer', { minimum: 0 }),
    discount: nullable('integer', { minimum: 0 }),
    tax: nullable('integer', { minimum: 0 }),
    unclear: unclearNotes,
  }),
  lines: {
    type: 'array',
    maxItems: MAX_LINES,
    items: objectOf({
      name: nullable('string', { maxLength: 200 }),
      strength: nullable('string', { maxLength: 60 }),
      form: nullable('string', { maxLength: 60 }),
      pack: nullable('string', { maxLength: 60 }),
      quantity: nullable('integer', { minimum: 0 }),
      bonus: nullable('integer', { minimum: 0 }),
      unitCost: nullable('integer', { minimum: 0 }),
      lineTotal: nullable('integer', { minimum: 0 }),
      lot: nullable('string', { maxLength: 100 }),
      expiry: nullable('string', { maxLength: 40 }),
      barcodeText: nullable('string', { maxLength: 200 }),
      unclear: unclearNotes,
      page: nullable('integer', { minimum: 1, maximum: 1000 }),
    }),
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// Arithmetic

export type Money = bigint | number | null | undefined;
export type Arithmetic =
  | { status: 'OK' | 'MISMATCH'; expected: bigint; actual: bigint; difference: bigint; assumed?: Array<'tax' | 'discount'> }
  | { status: 'UNKNOWN' };

const big = (v: bigint | number): bigint => (typeof v === 'bigint' ? v : BigInt(v));
const UNKNOWN: Arithmetic = { status: 'UNKNOWN' };

function compare(expected: bigint, actual: bigint): Arithmetic {
  const difference = actual - expected;
  return { status: difference === 0n ? 'OK' : 'MISMATCH', expected, actual, difference };
}

/**
 * Line total against quantity x unit cost - line discount. The extraction has no per-line discount column, so the discount is
 * absent (0): a line that is discounted on the invoice shows up as MATH_MISMATCH and the reviewer states the reason.
 */
export function lineArithmetic(line: { quantity: Money; unitCost: Money; lineTotal: Money; discount?: Money }): Arithmetic {
  if (line.quantity == null || line.unitCost == null || line.lineTotal == null) return UNKNOWN;
  return compare(big(line.quantity) * big(line.unitCost) - big(line.discount ?? 0), big(line.lineTotal));
}

/**
 * Header total against the sum of line totals + tax - discount. The check exists to catch a line the model dropped, so it
 * must run on the common invoice that prints no tax or discount: a null tax or discount counts as 0 and is listed in
 * `assumed` (a false mismatch only costs the reviewer a stated reason; a skipped check costs a missed line). UNKNOWN only
 * when there are no lines, a line total is null, or the header total is null.
 */
export function headerArithmetic(
  lines: ReadonlyArray<{ lineTotal: Money }>,
  header: { total: Money; tax: Money; discount: Money },
): Arithmetic {
  if (lines.length === 0 || header.total == null) return UNKNOWN;
  let sum = 0n;
  for (const l of lines) {
    if (l.lineTotal == null) return UNKNOWN;
    sum += big(l.lineTotal);
  }
  const assumed: Array<'tax' | 'discount'> = [];
  if (header.tax == null) assumed.push('tax');
  if (header.discount == null) assumed.push('discount');
  const result = compare(sum + big(header.tax ?? 0) - big(header.discount ?? 0), big(header.total));
  return assumed.length > 0 && result.status !== 'UNKNOWN' ? { ...result, assumed } : result;
}

// ---------------------------------------------------------------------------------------------------------------------
// Flags

export type Flag = 'AMBIGUOUS_MATCH' | 'DUPLICATE_LINE' | 'EXPIRED' | 'MATH_MISMATCH' | 'MISSING' | 'MODEL_UNCLEAR';
export type MatchStatus = 'MATCHED' | 'UNMATCHED' | 'AMBIGUOUS';

/** A row as the flags read it: the effective values (edits over extraction) plus what the matcher and arithmetic said. */
export type FlagRow = {
  id: string;
  productId: string | null;
  unitId: string | null;
  quantity: number | null;
  lot: string | null;
  /** `YYYY-MM-DD` */
  expiry: string | null;
  unitCost: bigint | number | null;
  freeOfCharge?: boolean;
  matchStatus: MatchStatus;
  arithmetic?: 'OK' | 'MISMATCH' | 'UNKNOWN';
  unclear?: readonly string[];
};

const lotKey = (lot: string | null): string => (lot ?? '').trim().toLowerCase();

/** The flags a row raises (sorted, unique), before any reviewer acknowledgement: see `openFlags`. */
export function deriveFlags(row: FlagRow, ctx: { today: string; rows: ReadonlyArray<Pick<FlagRow, 'id' | 'productId' | 'unitId' | 'lot'>> }): Flag[] {
  const flags = new Set<Flag>();
  const cost = row.unitCost === null ? null : big(row.unitCost);
  const costMissing = row.freeOfCharge ? false : cost === null || cost === 0n;
  if (
    row.productId === null ||
    row.unitId === null ||
    row.quantity === null ||
    row.quantity <= 0 ||
    lotKey(row.lot) === '' ||
    row.expiry === null ||
    costMissing
  ) {
    flags.add('MISSING');
  }
  if (row.arithmetic === 'MISMATCH') flags.add('MATH_MISMATCH');
  if ((row.unclear ?? []).length > 0) flags.add('MODEL_UNCLEAR');
  if (row.matchStatus === 'AMBIGUOUS') flags.add('AMBIGUOUS_MATCH');
  if (row.expiry !== null && row.expiry < ctx.today) flags.add('EXPIRED');
  if (
    row.productId !== null &&
    row.unitId !== null &&
    lotKey(row.lot) !== '' &&
    ctx.rows.some((o) => o.id !== row.id && o.productId === row.productId && o.unitId === row.unitId && lotKey(o.lot) === lotKey(row.lot))
  ) {
    flags.add('DUPLICATE_LINE');
  }
  return [...flags].sort();
}

/**
 * What a reviewer acknowledged, bound to what they saw: a note lists the flags that existed when it was written (a flag raised
 * by a later edit is not covered), and a mismatch acknowledgement carries the exact difference it accepted (a later edit that
 * changes the difference reopens it).
 */
export type RowAcknowledgement = {
  reviewed?: { note: string; flags: readonly Flag[] } | null;
  mismatchAcknowledged?: { reason: string; difference: bigint } | null;
};

/**
 * The flags still open after the reviewer's acknowledgement. A note clears MODEL_UNCLEAR, EXPIRED and DUPLICATE_LINE, and
 * only those it listed; MATH_MISMATCH needs a reason for the same difference as now (`mismatchDifference`); MISSING and
 * AMBIGUOUS_MATCH are cleared only by supplying the value or choosing the product (then they are no longer derived).
 */
export function openFlags(flags: readonly Flag[], ack: RowAcknowledgement, mismatchDifference?: bigint | null): Flag[] {
  const noted = (ack.reviewed?.note ?? '').trim() !== '';
  const mismatch = ack.mismatchAcknowledged;
  const reasoned =
    mismatch != null && mismatch.reason.trim() !== '' && mismatchDifference != null && mismatch.difference === mismatchDifference;
  return flags.filter((f) => {
    if (f === 'MATH_MISMATCH') return !reasoned;
    if (f === 'MODEL_UNCLEAR' || f === 'EXPIRED' || f === 'DUPLICATE_LINE') return !(noted && ack.reviewed!.flags.includes(f));
    return true;
  });
}

export type ApprovalReason =
  | { code: 'NO_ROWS' }
  | { code: 'OPEN_FLAG'; rowIndex: number; flag: Flag }
  | { code: 'HEADER_MISMATCH' };

/**
 * Whether a batch can be approved: at least one row, no open flag, and a header mismatch only with a stated reason for the
 * same difference. The caller recomputes `flags` and the differences from the stored values; nothing here trusts a client.
 */
export function canApprove(
  rows: ReadonlyArray<{ flags: readonly Flag[]; mismatchDifference?: bigint | null } & RowAcknowledgement>,
  headerAck: {
    status: 'OK' | 'MISMATCH' | 'UNKNOWN';
    difference?: bigint | null;
    acknowledgedReason?: string | null;
    acknowledgedDifference?: bigint | null;
  },
): { ok: boolean; reasons: ApprovalReason[] } {
  const reasons: ApprovalReason[] = [];
  if (rows.length === 0) reasons.push({ code: 'NO_ROWS' });
  rows.forEach((row, rowIndex) => {
    for (const flag of openFlags(row.flags, row, row.mismatchDifference)) reasons.push({ code: 'OPEN_FLAG', rowIndex, flag });
  });
  const headerAcknowledged =
    (headerAck.acknowledgedReason ?? '').trim() !== '' && headerAck.difference != null && headerAck.acknowledgedDifference === headerAck.difference;
  if (headerAck.status === 'MISMATCH' && !headerAcknowledged) reasons.push({ code: 'HEADER_MISMATCH' });
  return { ok: reasons.length === 0, reasons };
}

/** Edited values over extracted ones: an undefined edit leaves the extracted value, an explicit null clears it. */
export function effectiveRow<T extends object>(extracted: T, edited: Partial<T> | null | undefined): T {
  const out = { ...extracted };
  if (edited) {
    // only the extracted row's own keys can be edited: an extra key or an own `__proto__` from JSON.parse is ignored
    for (const key of Object.keys(extracted) as Array<keyof T & string>) {
      if (key === '__proto__' || !Object.hasOwn(edited, key)) continue;
      if (edited[key] !== undefined) out[key] = edited[key] as T[keyof T & string];
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Matching

export type Candidate = {
  productId: string;
  tradeName: string;
  strength: string;
  form: string;
  packLabel: string;
  manufacturer: string;
  barcodes: ReadonlyArray<{ code: string; unitId: string }>;
  /** The unit an identity match proposes (the invoice names none). */
  defaultUnitId?: string | null;
};
export type MatchInput = { barcode?: string | null; name: string; strength: string; form: string; pack: string };
export type MatchResult = {
  status: MatchStatus;
  productId?: string;
  unitId?: string | null;
  candidates: Array<{ productId: string; score: number }>;
};

const MAX_CANDIDATES = 5;
/** Candidates below this name similarity (0..1000) are not offered. */
const MIN_CANDIDATE_SCORE = 300;
/** Two top candidates tied at or above this similarity are ambiguous. */
const TIE_AMBIGUOUS_SCORE = 600;

/** Dice coefficient over character bigrams of the normalised names, 0..1000 (integers, so deterministic). */
function nameScore(a: string, b: string): number {
  if (a === b) return a === '' ? 0 : 1000;
  const grams = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1);
    return m;
  };
  const ga = grams(a);
  const gb = grams(b);
  let common = 0;
  let total = 0;
  for (const n of ga.values()) total += n;
  for (const n of gb.values()) total += n;
  for (const [g, n] of ga) common += Math.min(n, gb.get(g) ?? 0);
  return total === 0 ? 0 : Math.floor((2000 * common) / total);
}

/**
 * The stored-code spellings a scan can mean: the text itself, and for a GS1 element string or a GTIN-14 the GTIN-14 and its
 * EAN-13 form (the leading 0 indicator dropped), since the catalog stores what is printed on the pack.
 */
function barcodeForms(raw: string): string[] {
  const scan = normalizeScan(raw);
  if (scan === '') return [];
  const forms = new Set([scan]);
  const gtin = parseGs1(scan)?.gtin ?? (/^\d{14}$/.test(scan) ? scan : undefined);
  if (gtin) {
    forms.add(gtin);
    if (gtin.startsWith('0')) forms.add(gtin.slice(1));
  }
  return [...forms];
}

/**
 * Finds the catalog product a line is. Order: an exact barcode (gives the unit), an exact identity key (trade name, strength,
 * form, pack through the phase-1 normaliser; the invoice names no manufacturer, so it is left out on both sides), then
 * name similarity. Never picks between doubts: two products on one barcode or key, a candidate with the same name but another
 * strength or pack, or two equally good names are AMBIGUOUS and the reviewer chooses.
 */
export function rankMatches(input: MatchInput, candidates: readonly Candidate[]): MatchResult {
  const forms = barcodeForms(input.barcode ?? '');
  if (forms.length > 0) {
    const hits = candidates.flatMap((c) => c.barcodes.filter((b) => forms.includes(b.code)).map((b) => ({ c, unitId: b.unitId })));
    const products = [...new Set(hits.map((h) => h.c.productId))].sort();
    const units = new Set(hits.map((h) => h.unitId));
    if (products.length === 1 && units.size > 1) {
      return { status: 'AMBIGUOUS', candidates: [{ productId: products[0]!, score: 1000 }] }; // one code on two units: the reviewer picks the unit
    }
    if (products.length === 1) {
      return { status: 'MATCHED', productId: products[0]!, unitId: hits[0]!.unitId, candidates: [{ productId: products[0]!, score: 1000 }] };
    }
    if (products.length > 1) return { status: 'AMBIGUOUS', candidates: products.slice(0, MAX_CANDIDATES).map((productId) => ({ productId, score: 1000 })) };
  }

  const keyOf = (c: { tradeName: string; strength: string; form: string; packLabel: string }): string =>
    identityKeyOf({ tradeName: c.tradeName, strength: c.strength, form: c.form, manufacturer: '', packLabel: c.packLabel });
  const wanted = keyOf({ tradeName: input.name, strength: input.strength, form: input.form, packLabel: input.pack });
  const exact = candidates.filter((c) => keyOf(c) === wanted);
  if (exact.length === 1) {
    return { status: 'MATCHED', productId: exact[0]!.productId, unitId: exact[0]!.defaultUnitId ?? null, candidates: [{ productId: exact[0]!.productId, score: 1000 }] };
  }

  const name = normalizeForSearch(input.name);
  const ranked = candidates
    .map((c) => {
      const tradeName = normalizeForSearch(c.tradeName);
      return { productId: c.productId, tradeName, score: nameScore(name, tradeName) };
    })
    .filter((r) => r.score >= MIN_CANDIDATE_SCORE)
    .sort((a, b) => b.score - a.score || (a.tradeName < b.tradeName ? -1 : a.tradeName > b.tradeName ? 1 : 0) || (a.productId < b.productId ? -1 : 1))
    .slice(0, MAX_CANDIDATES)
    .map(({ productId, score }) => ({ productId, score }));

  const top = ranked[0];
  const second = ranked[1];
  const ambiguous = exact.length > 1 || (top !== undefined && (top.score === 1000 || (second !== undefined && second.score === top.score && top.score >= TIE_AMBIGUOUS_SCORE)));
  return { status: ambiguous ? 'AMBIGUOUS' : 'UNMATCHED', candidates: ranked };
}

// ---------------------------------------------------------------------------------------------------------------------
// Image quality gate (before any AI call)

/**
 * Starting limits, to be recalibrated on real invoice photos at UAT (the tests only pin that each limit decides its reason).
 * - minShortSidePx: the short side of the image; below 800 px a printed invoice line is under about 8 px tall and unreadable.
 * - minLaplacianVariance (only meaningful at a fixed working size: the metric must be computed after resizing the grey image
 *   to a fixed short side, or the threshold drifts with the camera's megapixels): variance of the Laplacian of the grey image (sharpness); the common rule of thumb is that a focused
 *   photograph of text is well above 100 and a motion- or focus-blurred one is below it.
 * - minMeanLuma: mean grey level 0..255; below 50 the page is under-exposed.
 * - minContrast: standard deviation of the grey level; below 25 ink and paper are not separable.
 */
export const QUALITY_LIMITS = {
  minShortSidePx: 800,
  minLaplacianVariance: 100,
  minMeanLuma: 50,
  minContrast: 25,
} as const;

export type QualityMetrics = { width: number; height: number; laplacianVariance: number; meanLuma: number; contrast: number };
export type QualityReason = 'BLURRY' | 'TOO_SMALL' | 'TOO_DARK' | 'LOW_CONTRAST';

/** PDFs go straight to the model (text and vector pages have no pixel sharpness to measure). A NaN metric fails its check. */
export function qualityDecision(metrics: QualityMetrics, mediaType: string): { ok: boolean; reasons: QualityReason[] } {
  if (mediaType === 'application/pdf') return { ok: true, reasons: [] };
  const reasons: QualityReason[] = [];
  if (!(metrics.laplacianVariance >= QUALITY_LIMITS.minLaplacianVariance)) reasons.push('BLURRY');
  if (!(Math.min(metrics.width, metrics.height) >= QUALITY_LIMITS.minShortSidePx)) reasons.push('TOO_SMALL');
  if (!(metrics.meanLuma >= QUALITY_LIMITS.minMeanLuma)) reasons.push('TOO_DARK');
  if (!(metrics.contrast >= QUALITY_LIMITS.minContrast)) reasons.push('LOW_CONTRAST');
  return { ok: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------------------------------------------------------
// Files

/**
 * Number of pages of a PDF, or null when it cannot be told with certainty (the caller refuses null). Conservative on
 * purpose: null for anything that is not plain, single-revision, uncompressed-structure PDF text:
 * - not a PDF, no page object, or objects kept in compressed object streams (`/ObjStm`);
 * - a `#` name escape (`/P#61ge`) outside stream bodies, which could hide a page or an object stream from a text scan;
 * - more than one `%%EOF` or `startxref` (incremental update or linearised file: page objects can repeat);
 * - a leaf-page count that differs from the largest `/Count` of the page-tree nodes.
 * Stream bodies (binary content, images) are removed before any scan. The bytes are decoded as latin1 (one char per byte;
 * the exact code page does not matter because only ASCII tokens are matched).
 */
export function countPdfPages(bytes: Uint8Array): number | null {
  const decoder = new TextDecoder('latin1');
  if (!decoder.decode(bytes.subarray(0, 1024)).includes('%PDF-')) return null;
  const body = decoder.decode(bytes).replace(/stream\r?\n[\s\S]*?endstream/g, 'stream endstream');
  if (/\/Type\s*\/ObjStm/.test(body) || /\/[^\s/<>[\]()%]*#[0-9A-Fa-f]{2}/.test(body)) return null;
  if ((body.match(/%%EOF/g)?.length ?? 0) > 1 || (body.match(/startxref/g)?.length ?? 0) > 1) return null;
  let leaves = 0;
  let declared = 0;
  for (const obj of body.matchAll(/\d+\s+\d+\s+obj([\s\S]*?)endobj/g)) {
    const dict = obj[1]!;
    if (/\/Type\s*\/Page(?![A-Za-z])/.test(dict)) leaves++;
    else if (/\/Type\s*\/Pages(?![A-Za-z])/.test(dict)) declared = Math.max(declared, Number(/\/Count\s+(\d+)/.exec(dict)?.[1] ?? 0));
  }
  return leaves > 0 && leaves === declared ? leaves : null;
}

export const INTAKE_LIMITS = { maxBytes: 8 * 1024 * 1024, maxPages: 10, maxFilesPerBatch: 20 } as const;

const MAGIC: Record<string, (b: Uint8Array) => boolean> = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/webp': (b) => String.fromCharCode(...b.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...b.subarray(8, 12)) === 'WEBP',
  'application/pdf': (b) => String.fromCharCode(...b.subarray(0, 5)) === '%PDF-',
};

export type FileRefusal = 'UNSUPPORTED_TYPE' | 'EMPTY' | 'TOO_LARGE' | 'TYPE_MISMATCH' | 'PAGES_UNKNOWN' | 'TOO_MANY_PAGES';

/** One upload against the per-file limits. `pages` is `countPdfPages` for a PDF (ignored for images). */
export function intakeFileAcceptable(file: { mediaType: string; bytes: Uint8Array; pages: number | null }): { ok: true } | { ok: false; reason: FileRefusal } {
  const magic = MAGIC[file.mediaType];
  if (!magic) return { ok: false, reason: 'UNSUPPORTED_TYPE' };
  if (file.bytes.length === 0) return { ok: false, reason: 'EMPTY' };
  if (file.bytes.length > INTAKE_LIMITS.maxBytes) return { ok: false, reason: 'TOO_LARGE' };
  if (!magic(file.bytes)) return { ok: false, reason: 'TYPE_MISMATCH' };
  if (file.mediaType === 'application/pdf') {
    if (file.pages === null || file.pages < 1) return { ok: false, reason: 'PAGES_UNKNOWN' };
    if (file.pages > INTAKE_LIMITS.maxPages) return { ok: false, reason: 'TOO_MANY_PAGES' };
  }
  return { ok: true };
}

/** Counting against the plan's `storageMb` (0 means none left) and the per-batch file count. */
export const STORAGE = {
  limitBytes: (storageMb: number): number => storageMb * 1024 * 1024,
  fits: (usedBytes: number, addBytes: number, storageMb: number): boolean => usedBytes + addBytes <= STORAGE.limitBytes(storageMb),
  filesFit: (existing: number, adding: number): boolean => existing + adding <= INTAKE_LIMITS.maxFilesPerBatch,
};

// ---------------------------------------------------------------------------------------------------------------------
// AI budget (micro-dollars, BigInt)

function whole(value: number | bigint, name: string): bigint {
  if (typeof value === 'bigint') {
    if (value < 0n) throw new RangeError(`${name} must not be negative`);
    return value;
  }
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a whole number, zero or more`);
  return BigInt(value);
}

/** Cost of one call in micro-dollars: tokens x (micro-dollars per million tokens), rounded up to the next micro-dollar. */
export function estimateCostMicroUsd(
  tokens: { inputTokens: number | bigint; outputTokens: number | bigint },
  price: { inputPerMtok: number | bigint; outputPerMtok: number | bigint },
): bigint {
  const total = whole(tokens.inputTokens, 'inputTokens') * whole(price.inputPerMtok, 'inputPerMtok') + whole(tokens.outputTokens, 'outputTokens') * whole(price.outputPerMtok, 'outputPerMtok');
  return (total + 999_999n) / 1_000_000n;
}

/** The plan field `aiMonthlyBudgetMinor` is USD cents; one cent is 10,000 micro-dollars. */
export function budgetMicroUsdFromCents(cents: number | bigint): bigint {
  return whole(cents, 'cents') * 10_000n;
}

/** A worst-case reservation fits only while spent + reserved + worst stays within the budget. */
export function canReserve(state: { spent: bigint; reserved: bigint; budget: bigint }, worst: bigint): boolean {
  return state.spent + state.reserved + whole(worst, 'worst') <= state.budget;
}

/** A bookkeeping error in the budget: the caller must treat it as a defect and alert, not retry silently. */
export class BudgetError extends Error {
  constructor(readonly code: 'OVERRUN' | 'UNKNOWN_RESERVATION') {
    super(code);
    this.name = 'BudgetError';
  }
}

/**
 * Ends a reservation: it is released and the actual cost is booked as spent. The reservation must be an upper bound of the
 * actual cost (input tokens counted from a trustworthy page count or image size, output tokens capped), which is what keeps
 * spent + reserved within the budget. So an actual above the reservation throws OVERRUN (nothing changes; the caller books
 * at most the reservation and raises the alarm), and a reservation larger than what is reserved at all (a double settle, or
 * an amount that was never reserved) throws UNKNOWN_RESERVATION instead of releasing other calls' reservations. A double
 * settle while other reservations are in flight cannot be told apart in aggregate: the caller must settle each call once.
 */
export function settle(state: { spent: bigint; reserved: bigint }, reservedAmount: bigint, actual: bigint): { spent: bigint; reserved: bigint } {
  const amount = whole(reservedAmount, 'reservedAmount');
  const cost = whole(actual, 'actual');
  if (amount > state.reserved) throw new BudgetError('UNKNOWN_RESERVATION');
  if (cost > amount) throw new BudgetError('OVERRUN');
  return { spent: state.spent + cost, reserved: state.reserved - amount };
}

/** The Baghdad (UTC+3, no daylight saving) calendar month as `YYYY-MM`, without timezone data. */
export function baghdadMonth(now: Date): string {
  const d = new Date(now.getTime() + 3 * 3_600_000);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}`;
}
