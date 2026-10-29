import { describe, expect, it } from 'vitest';
import {
  INTAKE_LIMITS,
  QUALITY_LIMITS,
  STORAGE,
  baghdadMonth,
  budgetMicroUsdFromCents,
  canApprove,
  canReserve,
  countPdfPages,
  deriveFlags,
  effectiveRow,
  estimateCostMicroUsd,
  BudgetError,
  barcodeForms,
  extractionJsonSchema,
  extractionShapes,
  headerArithmetic,
  intakeFileAcceptable,
  lineArithmetic,
  openFlags,
  parseExpiry,
  parseExtraction,
  parseGs1,
  parseMoneyMinor,
  parseQuantity,
  qualityDecision,
  rankMatches,
  settle,
  type Candidate,
  type FlagRow,
} from '@/server/domain/pharmacy/intake';

type Node = { type?: unknown; maximum?: number; additionalProperties?: boolean; required: string[]; maxItems?: number; items: Node; properties: Record<string, Node> };
const NOW = new Date('2026-10-29T10:00:00Z');

/** GS1 check digit for a 13-digit body. */
function gtin14(body13: string): string {
  let sum = 0;
  for (let i = 12, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += Number(body13[i]) * w;
  return body13 + String((10 - (sum % 10)) % 10);
}

describe('parseGs1', () => {
  const g = gtin14('0628001234567'.slice(0, 13));
  const GS = '\x1d';
  it('parses the parentheses form', () => {
    expect(parseGs1(`(01)${g}(17)271100(10)AB123`)).toEqual({
      gtin: g,
      lot: 'AB123',
      expiry: { date: '2027-11-30', precision: 'MONTH' },
    });
  });
  it('parses the raw form with FNC1 after the variable lot', () => {
    expect(parseGs1(`01${g}10LOT-9${GS}17280215`)).toEqual({
      gtin: g,
      lot: 'LOT-9',
      expiry: { date: '2028-02-15', precision: 'DAY' },
    });
  });
  it('parses the raw form without FNC1 when the lot is last', () => {
    expect(parseGs1(`01${g}1728021510XYZ`)).toEqual({
      gtin: g,
      lot: 'XYZ',
      expiry: { date: '2028-02-15', precision: 'DAY' },
    });
  });
  it('accepts Arabic-Indic digits and a symbology prefix', () => {
    expect(parseGs1(`]d2(01)${g.replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)))}`)).toEqual({ gtin: g });
  });
  it('DD=00 is the last day of the month (leap February too)', () => {
    expect(parseGs1(`(17)280200`)?.expiry).toEqual({ date: '2028-02-29', precision: 'MONTH' });
    expect(parseGs1(`(17)270200`)?.expiry).toEqual({ date: '2027-02-28', precision: 'MONTH' });
  });
  it('refuses a bad check digit, a bad date, a long lot, unknown AI, and text that is not GS1', () => {
    const bad = g.slice(0, 13) + String((Number(g[13]) + 1) % 10);
    expect(parseGs1(`(01)${bad}`)).toBeNull();
    expect(parseGs1('(17)271399')).toBeNull();
    expect(parseGs1('(17)270231')).toBeNull();
    expect(parseGs1(`(10)${'A'.repeat(21)}`)).toBeNull();
    expect(parseGs1(`(99)12345`)).toBeNull();
    expect(parseGs1('6281000123456')).toBeNull();
    expect(parseGs1('')).toBeNull();
    expect(parseGs1('hello')).toBeNull();
    expect(parseGs1(`(01)${g}junk`)).toBeNull();
  });
  it('a bare EAN/UPC/ITF digit string is not GS1, whatever it starts with', () => {
    for (const t of ['1012345678901', '10012345678902', '6281000123456', '012345678905', ']E01012345678901', ']A0123456789012']) {
      expect(parseGs1(t)).toBeNull();
    }
  });
  it('raw form needs 01 + valid GTIN, a GS1 symbology id, or a leading FNC1', () => {
    expect(parseGs1(`${GS}10LOT1`)).toEqual({ lot: 'LOT1' });
    expect(parseGs1(']C110LOT1')).toEqual({ lot: 'LOT1' });
    expect(parseGs1(']d210LOT1')).toEqual({ lot: 'LOT1' });
    expect(parseGs1(`01${g}`)).toEqual({ gtin: g });
  });
  it('an unterminated lot that ends like an expiry element is refused, not swallowed', () => {
    expect(parseGs1(`01${g}10LOT17280215`)).toBeNull();
    expect(parseGs1(`01${g}10LOT${GS}17280215`)?.lot).toBe('LOT');
  });
  it('accepts the printed form with spaces around the parentheses', () => {
    expect(parseGs1(`(01) ${g} (17) 271100`)).toEqual({ gtin: g, expiry: { date: '2027-11-30', precision: 'MONTH' } });
  });
  it('keeps leading zeros of the GTIN (text)', () => {
    const z = gtin14('0000012345678');
    expect(parseGs1(`(01)${z}`)?.gtin).toBe(z);
  });
});

describe('parseExpiry', () => {
  const table: Array<[string, { date: string; precision: 'MONTH' | 'DAY' } | null]> = [
    ['03/2028', { date: '2028-03-31', precision: 'MONTH' }],
    ['02/2028', { date: '2028-02-29', precision: 'MONTH' }],
    ['03-28', { date: '2028-03-31', precision: 'MONTH' }],
    ['2028-03', { date: '2028-03-31', precision: 'MONTH' }],
    ['15/03/2028', { date: '2028-03-15', precision: 'DAY' }],
    ['2028-03-15', { date: '2028-03-15', precision: 'DAY' }],
    ['2028-03-15T00:00:00Z', { date: '2028-03-15', precision: 'DAY' }],
    ['2803', { date: '2028-03-31', precision: 'MONTH' }],
    ['٠٣/٢٠٢٨', { date: '2028-03-31', precision: 'MONTH' }],
    ['۱۵/۰۳/۲۰۲۸', { date: '2028-03-15', precision: 'DAY' }],
    [' 03 / 2028 ', { date: '2028-03-31', precision: 'MONTH' }],
    ['13/2028', null],
    ['00/2028', null],
    ['31/02/2028', null],
    ['2813', null],
    ['03/99', null], // two-digit 80..99 is never read as the 1900s
    ['03/15', null], // 2015: more than 10 years before now
    ['03/45', null], // 2045: more than 15 years after now
    ['03/41', { date: '2041-03-31', precision: 'MONTH' }], // inside +15y
    ['10/16', { date: '2016-10-31', precision: 'MONTH' }],
    ['', null],
    ['abc', null],
    ['2028', null],
  ];
  for (const [input, want] of table) {
    it(`${JSON.stringify(input)} -> ${JSON.stringify(want)}`, () => {
      expect(parseExpiry(input, NOW)).toEqual(want);
    });
  }
});

describe('parseQuantity', () => {
  it('reads whole positive integers', () => {
    expect(parseQuantity('12')).toBe(12);
    expect(parseQuantity(' ١٢ ')).toBe(12);
    expect(parseQuantity('۱۲')).toBe(12);
    expect(parseQuantity('1,000')).toBe(1000);
    expect(parseQuantity('1 000')).toBe(1000);
    expect(parseQuantity('١٬٠٠٠')).toBe(1000);
    expect(parseQuantity('12,345,678')).toBe(12345678);
  });
  it('refuses everything else', () => {
    for (const t of ['0', '-3', '2.5', '1,5', '', 'x', '12a', '1,00', '9'.repeat(20), '1.000', '12.000', '0.500', '1,000.000', '0,500', '1,000 000', '12٫000']) expect(parseQuantity(t)).toBeNull();
  });
});

describe('parseMoneyMinor', () => {
  it('IQD is whole dinars', () => {
    expect(parseMoneyMinor('1500', 'IQD')).toBe(1500n);
    expect(parseMoneyMinor('1,500', 'IQD')).toBe(1500n);
    expect(parseMoneyMinor('١٬٥٠٠', 'IQD')).toBe(1500n);
    expect(parseMoneyMinor('1,500.00', 'IQD')).toBe(1500n);
    expect(parseMoneyMinor('0', 'IQD')).toBe(0n);
    expect(parseMoneyMinor('12,345,000 IQD', 'IQD')).toBe(12345000n);
  });
  it('a currency marker that contradicts the currency gives null', () => {
    expect(parseMoneyMinor('5 USD', 'IQD')).toBeNull();
    expect(parseMoneyMinor('$12', 'IQD')).toBeNull();
    expect(parseMoneyMinor('1,500 IQD', 'USD')).toBeNull();
    expect(parseMoneyMinor('1500 دينار', 'USD')).toBeNull();
    expect(parseMoneyMinor('1500 دينار', 'IQD')).toBe(1500n);
    expect(parseMoneyMinor('IQD 5 USD', 'IQD')).toBeNull();
    expect(parseMoneyMinor('0,500', 'IQD')).toBeNull();
    expect(parseMoneyMinor('0,500', 'USD')).toBeNull();
  });
  it('IQD ambiguous or fractional forms are null, never guessed', () => {
    for (const t of ['1.234', '1.500', '1,5', '1.234.567', '1500.50', '1,50', '-5', '', 'abc']) {
      expect(parseMoneyMinor(t, 'IQD')).toBeNull();
    }
  });
  it('USD is cents', () => {
    expect(parseMoneyMinor('12', 'USD')).toBe(1200n);
    expect(parseMoneyMinor('12.5', 'USD')).toBe(1250n);
    expect(parseMoneyMinor('12.05', 'USD')).toBe(1205n);
    expect(parseMoneyMinor('$1,234.56', 'USD')).toBe(123456n);
    expect(parseMoneyMinor('١٢٫٥٠', 'USD')).toBe(1250n);
    expect(parseMoneyMinor('0.00', 'USD')).toBe(0n);
  });
  it('USD with three decimals or a comma decimal is null', () => {
    for (const t of ['1.234', '12,50', '1,2345', '12.', '.5x', '-1.00']) expect(parseMoneyMinor(t, 'USD')).toBeNull();
  });
});

describe('parseExtraction', () => {
  const line = {
    name: ' Amoxil ',
    strength: '500mg',
    form: 'Cap',
    pack: '20',
    quantity: 10,
    bonus: null,
    unitCost: 1500,
    lineTotal: 15000,
    lot: 'L1',
    expiry: '03/2028',
    barcodeText: null,
    unclear: [],
    page: 1,
  };
  const header = {
    supplierName: 'ACME',
    invoiceNumber: 'INV-1',
    invoiceDate: '2026-10-01',
    currency: 'IQD',
    total: 15000,
    discount: null,
    tax: null,
    unclear: [],
  };
  it('accepts a full extraction, trims strings, keeps nulls null, strips unknown keys', () => {
    const r = parseExtraction({ header: { ...header, extra: 'x' }, lines: [{ ...line, evil: 1 }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.lines[0]!.name).toBe('Amoxil');
    expect(r.value.lines[0]!.bonus).toBeNull();
    expect(r.value.lines[0]!.barcodeText).toBeNull();
    expect('evil' in r.value.lines[0]!).toBe(false);
    expect('extra' in r.value.header).toBe(false);
  });
  it('missing fields become null (no completion); blank strings become null; long strings are capped', () => {
    const r = parseExtraction({ header: {}, lines: [{ name: '  ', lot: 'x'.repeat(500) }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.header.total).toBeNull();
    expect(r.value.lines[0]!.name).toBeNull();
    expect(r.value.lines[0]!.quantity).toBeNull();
    expect(r.value.lines[0]!.lot!.length).toBeLessThanOrEqual(100);
  });
  it('an unknown currency becomes null', () => {
    const r = parseExtraction({ header: { ...header, currency: 'EUR' }, lines: [] });
    expect(r.ok && r.value.header.currency).toBeNull();
    const ok = parseExtraction({ header: { ...header, currency: ' usd ' }, lines: [] });
    expect(ok.ok && ok.value.header.currency).toBe('USD');
  });
  it('names the failing line', () => {
    const r = parseExtraction({ header, lines: [line, { ...line, quantity: 1.5 }, line] });
    expect(r).toEqual({ ok: false, code: 'EXTRACTION_INVALID', line: 1 });
    expect(parseExtraction({ header, lines: [line, { ...line, unitCost: -1 }] })).toEqual({
      ok: false,
      code: 'EXTRACTION_INVALID',
      line: 1,
    });
    expect(parseExtraction({ header, lines: [{ ...line, lineTotal: '15000' }] })).toMatchObject({ ok: false, line: 0 });
  });
  it('refuses a bad header without a line, and non-objects', () => {
    expect(parseExtraction({ header: { ...header, total: 1.5 }, lines: [] })).toEqual({ ok: false, code: 'EXTRACTION_INVALID' });
    expect(parseExtraction(null)).toEqual({ ok: false, code: 'EXTRACTION_INVALID' });
    expect(parseExtraction('x')).toEqual({ ok: false, code: 'EXTRACTION_INVALID' });
    expect(parseExtraction({ header })).toEqual({ ok: false, code: 'EXTRACTION_INVALID' });
  });
  it('more than 200 lines is TOO_MANY_LINES; exactly 200 is fine', () => {
    expect(parseExtraction({ header, lines: Array.from({ length: 201 }, () => line) })).toEqual({ ok: false, code: 'TOO_MANY_LINES' });
    expect(parseExtraction({ header, lines: Array.from({ length: 200 }, () => line) }).ok).toBe(true);
  });
  it('the JSON schema is strict and every field is nullable and required', () => {
    const s = extractionJsonSchema as unknown as Node;
    expect(s.additionalProperties).toBe(false);
    expect(s.required).toEqual(['header', 'lines']);
    const lineSchema = s.properties.lines.items;
    expect(s.properties.lines.maxItems).toBeUndefined(); // limits live in Zod (strict output rejects them): see intake-extract-schema
    expect(lineSchema.additionalProperties).toBe(false);
    expect(lineSchema.required.slice().sort()).toEqual(Object.keys(lineSchema.properties).sort());
    expect(Object.keys(lineSchema.properties).sort()).toEqual(
      ['name', 'strength', 'form', 'pack', 'quantity', 'bonus', 'unitCost', 'lineTotal', 'lot', 'expiry', 'barcodeText', 'unclear', 'page'].sort(),
    );
    const h = s.properties.header;
    expect(Object.keys(h.properties).sort()).toEqual(Object.keys(extractionShapes.header).sort());
    expect(Object.keys(lineSchema.properties).sort()).toEqual(Object.keys(extractionShapes.line).sort());
    expect(lineSchema.properties.page.maximum).toBeUndefined();
    expect(h.required.slice().sort()).toEqual(Object.keys(h.properties).sort());
    for (const [k, v] of Object.entries<Node>(lineSchema.properties)) {
      if (k === 'unclear') continue;
      expect(Array.isArray(v.type) && v.type.includes('null')).toBe(true);
    }
  });
});

describe('lineArithmetic / headerArithmetic', () => {
  it('OK, MISMATCH with the difference, and UNKNOWN on nulls', () => {
    expect(lineArithmetic({ quantity: 10, unitCost: 1500, lineTotal: 15000 })).toEqual({
      status: 'OK',
      expected: 15000n,
      actual: 15000n,
      difference: 0n,
    });
    expect(lineArithmetic({ quantity: 10, unitCost: 1500, lineTotal: 14000 })).toEqual({
      status: 'MISMATCH',
      expected: 15000n,
      actual: 14000n,
      difference: -1000n,
    });
    expect(lineArithmetic({ quantity: 10, unitCost: 1500, lineTotal: 14000, discount: 1000 }).status).toBe('OK');
    for (const l of [
      { quantity: null, unitCost: 1, lineTotal: 1 },
      { quantity: 1, unitCost: null, lineTotal: 1 },
      { quantity: 1, unitCost: 1, lineTotal: null },
    ]) {
      expect(lineArithmetic(l)).toEqual({ status: 'UNKNOWN' });
    }
  });
  it('is exact beyond 2^53 (BigInt)', () => {
    const r = lineArithmetic({ quantity: 3, unitCost: 3_000_000_000_000_000n, lineTotal: 9_000_000_000_000_001n });
    expect(r.status).toBe('MISMATCH');
    expect(r.status === 'MISMATCH' && r.difference).toBe(1n);
  });
  it('header: sum + tax - discount vs total', () => {
    const lines = [{ lineTotal: 15000 }, { lineTotal: 5000 }];
    expect(headerArithmetic(lines, { total: 21000, tax: 2000, discount: 1000 })).toEqual({
      status: 'OK',
      expected: 21000n,
      actual: 21000n,
      difference: 0n,
    });
    expect(headerArithmetic(lines, { total: 20000, tax: 2000, discount: 1000 })).toMatchObject({
      status: 'MISMATCH',
      expected: 21000n,
      difference: -1000n,
    });
  });
  it('header: a null tax or discount counts as 0 and is reported as assumed; a dropped line then mismatches', () => {
    expect(headerArithmetic([{ lineTotal: 1000 }], { total: 1000, tax: null, discount: null })).toEqual({
      status: 'OK',
      expected: 1000n,
      actual: 1000n,
      difference: 0n,
      assumed: ['tax', 'discount'],
    });
    expect(headerArithmetic([{ lineTotal: 1000 }], { total: 3000, tax: null, discount: 0 })).toMatchObject({
      status: 'MISMATCH',
      difference: 2000n,
      assumed: ['tax'],
    });
  });
  it('header: an unknown total or line total is UNKNOWN, never MISMATCH', () => {
    expect(headerArithmetic([{ lineTotal: 1 }, { lineTotal: null }], { total: 5, tax: 0, discount: 0 })).toEqual({ status: 'UNKNOWN' });
    expect(headerArithmetic([{ lineTotal: 1 }], { total: null, tax: 0, discount: 0 })).toEqual({ status: 'UNKNOWN' });
    expect(headerArithmetic([], { total: 0, tax: 0, discount: 0 })).toEqual({ status: 'UNKNOWN' });
  });
});

describe('flags', () => {
  const ctx = { today: '2026-10-29' };
  const base: FlagRow = {
    id: 'a',
    productId: 'p1',
    unitId: 'u1',
    quantity: 5,
    lot: 'L1',
    expiry: '2028-03-31',
    unitCost: 1000n,
    matchStatus: 'MATCHED',
  };
  const flags = (row: Partial<FlagRow>, others: FlagRow[] = []) =>
    deriveFlags({ ...base, ...row }, { ...ctx, rows: [{ ...base, ...row }, ...others] });

  it('a complete row has no flags', () => {
    expect(flags({})).toEqual([]);
  });
  it('MISSING for each required field', () => {
    for (const patch of [{ productId: null }, { unitId: null }, { quantity: null }, { quantity: 0 }, { lot: null }, { lot: '  ' }, { expiry: null }, { unitCost: null }, { unitCost: 0n }]) {
      expect(flags(patch as Partial<FlagRow>)).toEqual(['MISSING']);
    }
  });
  it('cost 0 or null is fine only with freeOfCharge', () => {
    expect(flags({ unitCost: 0n, freeOfCharge: true })).toEqual([]);
    expect(flags({ unitCost: null, freeOfCharge: true })).toEqual([]);
  });
  it('MATH_MISMATCH, MODEL_UNCLEAR, AMBIGUOUS_MATCH, EXPIRED', () => {
    expect(flags({ arithmetic: 'MISMATCH' })).toEqual(['MATH_MISMATCH']);
    expect(flags({ arithmetic: 'UNKNOWN' })).toEqual([]);
    expect(flags({ unclear: ['blurred lot'] })).toEqual(['MODEL_UNCLEAR']);
    expect(flags({ matchStatus: 'AMBIGUOUS' })).toEqual(['AMBIGUOUS_MATCH']);
    expect(flags({ expiry: '2026-10-28' })).toEqual(['EXPIRED']);
    expect(flags({ expiry: '2026-10-29' })).toEqual([]);
  });
  it('DUPLICATE_LINE for the same product, unit and lot in the batch, not for another lot', () => {
    expect(flags({}, [{ ...base, id: 'b' }])).toEqual(['DUPLICATE_LINE']);
    expect(flags({}, [{ ...base, id: 'b', lot: ' l1 ' }])).toEqual(['DUPLICATE_LINE']);
    expect(flags({}, [{ ...base, id: 'b', lot: 'L2' }])).toEqual([]);
    expect(flags({}, [{ ...base, id: 'b', unitId: 'u2' }])).toEqual([]);
    expect(flags({ productId: null }, [{ ...base, id: 'b', productId: null }])).toEqual(['MISSING']);
  });
  it('flags come out sorted and unique', () => {
    const f = flags({ productId: null, quantity: null, expiry: '2020-01-01', arithmetic: 'MISMATCH', unclear: ['x'] });
    expect(f).toEqual([...f].sort());
    expect(new Set(f).size).toBe(f.length);
    expect(f).toEqual(['EXPIRED', 'MATH_MISMATCH', 'MISSING', 'MODEL_UNCLEAR']);
  });
  it('openFlags: a note clears only the soft flags it was written for; the mismatch needs its own reason', () => {
    const all = ['AMBIGUOUS_MATCH', 'DUPLICATE_LINE', 'EXPIRED', 'MATH_MISMATCH', 'MISSING', 'MODEL_UNCLEAR'] as const;
    const note = { note: 'checked', flags: [...all] };
    expect(openFlags([...all], { reviewed: note })).toEqual(['AMBIGUOUS_MATCH', 'MATH_MISMATCH', 'MISSING']);
    expect(openFlags([...all], { reviewed: { note: '   ', flags: [...all] } })).toEqual([...all]);
    expect(openFlags(['MATH_MISMATCH'], { reviewed: note })).toEqual(['MATH_MISMATCH']);
  });
  it('a note does not clear a flag raised after it was written', () => {
    const reviewed = { note: 'blurry lot, checked', flags: ['MODEL_UNCLEAR' as const] };
    expect(openFlags(['MODEL_UNCLEAR'], { reviewed })).toEqual([]);
    expect(openFlags(['EXPIRED', 'MODEL_UNCLEAR'], { reviewed })).toEqual(['EXPIRED']);
  });
  it('a mismatch acknowledgement goes stale when the difference changes', () => {
    const ack = { mismatchAcknowledged: { reason: 'supplier rounding', difference: 1n } };
    expect(openFlags(['MATH_MISMATCH'], ack, 1n)).toEqual([]);
    expect(openFlags(['MATH_MISMATCH'], ack, 1_000_000n)).toEqual(['MATH_MISMATCH']);
    expect(openFlags(['MATH_MISMATCH'], ack, null)).toEqual(['MATH_MISMATCH']);
    expect(openFlags(['MATH_MISMATCH'], { mismatchAcknowledged: { reason: ' ', difference: 1n } }, 1n)).toEqual(['MATH_MISMATCH']);
    expect(openFlags(['MATH_MISMATCH'], {}, 1n)).toEqual(['MATH_MISMATCH']);
  });
  it('canApprove lists every reason', () => {
    expect(canApprove([], { status: 'OK' })).toEqual({ ok: false, reasons: [{ code: 'NO_ROWS' }] });
    expect(canApprove([{ flags: [] }], { status: 'OK' })).toEqual({ ok: true, reasons: [] });
    expect(canApprove([{ flags: [] }], { status: 'UNKNOWN' }).ok).toBe(true);
    const r = canApprove(
      [{ flags: [] }, { flags: ['MISSING', 'EXPIRED'], reviewed: { note: 'n', flags: ['EXPIRED', 'MISSING'] } }],
      { status: 'MISMATCH', difference: 5n },
    );
    expect(r.ok).toBe(false);
    expect(r.reasons).toEqual([{ code: 'OPEN_FLAG', rowIndex: 1, flag: 'MISSING' }, { code: 'HEADER_MISMATCH' }]);
  });
  it('canApprove: the header acknowledgement is bound to the difference it saw', () => {
    const rows = [{ flags: [] }];
    expect(canApprove(rows, { status: 'MISMATCH', difference: 5n, acknowledgedReason: 'rounding', acknowledgedDifference: 5n }).ok).toBe(true);
    expect(canApprove(rows, { status: 'MISMATCH', difference: 500n, acknowledgedReason: 'rounding', acknowledgedDifference: 5n }).ok).toBe(false);
    expect(canApprove(rows, { status: 'MISMATCH', difference: 5n, acknowledgedReason: ' ', acknowledgedDifference: 5n }).ok).toBe(false);
    expect(canApprove(rows, { status: 'MISMATCH', difference: 5n, acknowledgedReason: 'rounding' }).ok).toBe(false);
  });
  it('canApprove: a row mismatch acknowledgement needs the matching difference', () => {
    const row = { flags: ['MATH_MISMATCH' as const], mismatchAcknowledged: { reason: 'r', difference: 1n } };
    expect(canApprove([{ ...row, mismatchDifference: 1n }], { status: 'OK' }).ok).toBe(true);
    expect(canApprove([{ ...row, mismatchDifference: 2n }], { status: 'OK' }).ok).toBe(false);
  });
  it('effectiveRow ignores keys the extracted row does not have, including __proto__', () => {
    const e = { name: 'A' };
    const edited = JSON.parse('{"__proto__": {"polluted": true}, "extra": 1, "name": "B"}') as Partial<typeof e>;
    const out = effectiveRow(e, edited);
    expect(out).toEqual({ name: 'B' });
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it('effectiveRow: edits override, untouched stays, an explicit null clears', () => {
    const e = { name: 'A', quantity: 5, lot: 'L1' as string | null };
    expect(effectiveRow(e, null)).toEqual(e);
    expect(effectiveRow(e, { quantity: 6 })).toEqual({ name: 'A', quantity: 6, lot: 'L1' });
    expect(effectiveRow(e, { lot: null, name: undefined })).toEqual({ name: 'A', quantity: 5, lot: null });
    expect(e.quantity).toBe(5);
  });
});

describe('rankMatches', () => {
  const cand = (productId: string, tradeName: string, strength: string, form: string, packLabel: string, extra: Partial<Candidate> = {}): Candidate => ({
    productId,
    tradeName,
    strength,
    form,
    packLabel,
    manufacturer: 'M',
    barcodes: [],
    defaultUnitId: `${productId}-u`,
    ...extra,
  });
  const amox500 = cand('p1', 'Amoxil', '500 mg', 'Capsule', '20');
  const amox250 = cand('p2', 'Amoxil', '250 mg', 'Capsule', '20');
  const para = cand('p3', 'Paracetamol', '500mg', 'Tablet', '100', { barcodes: [{ code: '0628100012345', unitId: 'p3-box' }] });
  const input = { name: 'amoxil', strength: '500mg', form: 'capsule', pack: '20' };

  it('barcode exact wins and gives the unit', () => {
    const r = rankMatches({ ...input, name: 'whatever', barcode: ' 0628100012345 ' }, [amox500, para]);
    expect(r).toMatchObject({ status: 'MATCHED', productId: 'p3', unitId: 'p3-box' });
  });
  it('a barcode on two products is ambiguous', () => {
    const a = cand('a', 'X', '', '', '', { barcodes: [{ code: '111', unitId: 'au' }] });
    const b = cand('b', 'Y', '', '', '', { barcodes: [{ code: '111', unitId: 'bu' }] });
    expect(rankMatches({ ...input, barcode: '111' }, [a, b]).status).toBe('AMBIGUOUS');
  });
  it('identity key exact (normaliser, Arabic digits and unit spelling) matches', () => {
    const r = rankMatches({ name: 'AMOXIL', strength: '٥٠٠ ملغم', form: 'capsule', pack: '20' }, [amox250, amox500, para]);
    expect(r).toMatchObject({ status: 'MATCHED', productId: 'p1', unitId: 'p1-u' });
  });
  it('same name, different strength is never auto-picked', () => {
    const r = rankMatches({ ...input, strength: '1000mg' }, [amox250, amox500, para]);
    expect(r.status).toBe('AMBIGUOUS');
    expect(r.candidates.map((c) => c.productId).slice(0, 2).sort()).toEqual(['p1', 'p2']);
  });
  it('same name, pack mismatch with one candidate is ambiguous', () => {
    expect(rankMatches({ ...input, pack: '30' }, [amox500, para]).status).toBe('AMBIGUOUS');
  });
  it('two equal exact identities (different makers) are ambiguous', () => {
    const twin = cand('p9', 'Amoxil', '500 mg', 'Capsule', '20', { manufacturer: 'Other' });
    expect(rankMatches(input, [amox500, twin]).status).toBe('AMBIGUOUS');
  });
  it('unrelated names are UNMATCHED with at most 5 ranked candidates, deterministic', () => {
    const many = Array.from({ length: 8 }, (_, i) => cand(`m${i}`, `Panadol ${i}`, '500mg', 'Tablet', '24'));
    const r1 = rankMatches({ name: 'Panadol', strength: '500mg', form: 'tablet', pack: '10' }, many);
    expect(r1.status).toBe('AMBIGUOUS');
    expect(r1.candidates.length).toBeLessThanOrEqual(5);
    const r2 = rankMatches({ name: 'Panadol', strength: '500mg', form: 'tablet', pack: '10' }, [...many].reverse());
    expect(r2).toEqual(r1);
    const none = rankMatches({ name: 'Zzzzqq', strength: '', form: '', pack: '' }, [para, amox500]);
    expect(none).toMatchObject({ status: 'UNMATCHED', candidates: [] });
  });
  it('a GS1 scan or a GTIN-14 meets a stored EAN-13', () => {
    const ean = cand('e1', 'Z', '', '', '', { barcodes: [{ code: '6281000123456', unitId: 'e1-u' }] });
    const g14 = gtin14('0628100012345'.slice(0, 13));
    const stored = cand('e2', 'Y', '', '', '', { barcodes: [{ code: g14.slice(1), unitId: 'e2-u' }] });
    expect(rankMatches({ ...input, barcode: `(01)${g14}(17)271100(10)A1` }, [ean, stored])).toMatchObject({ status: 'MATCHED', productId: 'e2', unitId: 'e2-u' });
    expect(rankMatches({ ...input, barcode: g14 }, [ean, stored])).toMatchObject({ status: 'MATCHED', productId: 'e2' });
  });
  it('one product with two units on one code is ambiguous', () => {
    const two = cand('t', 'T', '', '', '', { barcodes: [{ code: '555', unitId: 'box' }, { code: '555', unitId: 'strip' }] });
    expect(rankMatches({ ...input, barcode: '555' }, [two]).status).toBe('AMBIGUOUS');
  });
  it('no candidates: UNMATCHED', () => {
    expect(rankMatches(input, [])).toEqual({ status: 'UNMATCHED', candidates: [] });
  });
});

describe('qualityDecision', () => {
  const good = { width: 2000, height: 1500, sharpness: 1.2, meanLuma: 150, contrast: 60 };
  it('good image passes', () => {
    expect(qualityDecision(good, 'image/jpeg')).toEqual({ ok: true, reasons: [] });
  });
  it('each limit yields its reason, just either side of the constant', () => {
    expect(qualityDecision({ ...good, sharpness: QUALITY_LIMITS.minSharpness - 0.001 }, 'image/png').reasons).toEqual(['BLURRY']);
    expect(qualityDecision({ ...good, sharpness: QUALITY_LIMITS.minSharpness }, 'image/png').ok).toBe(true);
    expect(qualityDecision({ ...good, width: QUALITY_LIMITS.minShortSidePx - 1 }, 'image/webp').reasons).toEqual(['TOO_SMALL']);
    expect(qualityDecision({ ...good, height: QUALITY_LIMITS.minShortSidePx }, 'image/webp').ok).toBe(true);
    expect(qualityDecision({ ...good, meanLuma: QUALITY_LIMITS.minMeanLuma - 1 }, 'image/jpeg').reasons).toEqual(['TOO_DARK']);
    expect(qualityDecision({ ...good, contrast: QUALITY_LIMITS.minContrast - 1 }, 'image/jpeg').reasons).toEqual(['LOW_CONTRAST']);
  });
  it('several reasons together; PDFs skip pixel metrics', () => {
    const bad = { width: 100, height: 100, sharpness: 0, meanLuma: 5, contrast: 1 };
    expect(qualityDecision(bad, 'image/jpeg').reasons.sort()).toEqual(['BLURRY', 'LOW_CONTRAST', 'TOO_DARK', 'TOO_SMALL']);
    expect(qualityDecision(bad, 'application/pdf')).toEqual({ ok: true, reasons: [] });
  });
});

describe('countPdfPages', () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  const tiny = (pages: number) =>
    `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${i + 3} 0 R`).join(' ')}] /Count ${pages} >>\nendobj\n` +
    Array.from({ length: pages }, (_, i) => `${i + 3} 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n`).join('') +
    `trailer\n<< /Root 1 0 R >>\n%%EOF`;
  it('counts leaf pages, not the /Pages node or the catalog', () => {
    expect(countPdfPages(enc(tiny(1)))).toBe(1);
    expect(countPdfPages(enc(tiny(3)))).toBe(3);
    expect(countPdfPages(enc(tiny(2).replace(/\/Type \/Page /g, '/Type/Page ')))).toBe(2);
  });
  it('returns null for name escapes, incremental updates, and a page count that disagrees with the tree', () => {
    expect(countPdfPages(enc(tiny(1).replace('/Type /Page ', '/Type /P#61ge ')))).toBeNull();
    expect(countPdfPages(enc(tiny(1).replace('/Type /Catalog', '/T#79pe /Catalog')))).toBeNull();
    expect(countPdfPages(enc(tiny(1) + '\n3 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\nstartxref\n0\n%%EOF'))).toBeNull();
    expect(countPdfPages(enc(tiny(2).replace('/Count 2', '/Count 9')))).toBeNull();
  });
  it('ignores stream bodies (a /Type /Page or # inside a stream is not a page or an escape)', () => {
    const withStream = tiny(2).replace('trailer', '9 0 obj\n<< /Length 30 >>\nstream\n/Type /Page /A#1 /Type /Page\nendstream\nendobj\ntrailer');
    expect(countPdfPages(enc(withStream))).toBe(2);
  });
  it('returns null for object streams, no pages, and garbage', () => {
    expect(countPdfPages(enc(tiny(2) + '\n9 0 obj\n<< /Type /ObjStm /N 1 >>\nendobj'))).toBeNull();
    expect(countPdfPages(enc('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj'))).toBeNull();
    expect(countPdfPages(enc('hello world /Type /Page'))).toBeNull();
    expect(countPdfPages(new Uint8Array(0))).toBeNull();
    expect(countPdfPages(Uint8Array.from({ length: 5000 }, (_, i) => (i * 37) % 256))).toBeNull();
    expect(countPdfPages(Uint8Array.from([...enc('%PDF-1.4\n'), ...Array.from({ length: 5000 }, (_, i) => (i * 37) % 256)]))).toBeNull();
  });
});

describe('budget maths', () => {
  it('estimateCostMicroUsd rounds up', () => {
    expect(estimateCostMicroUsd({ inputTokens: 1_000_000, outputTokens: 0 }, { inputPerMtok: 3_000_000, outputPerMtok: 15_000_000 })).toBe(3_000_000n);
    expect(estimateCostMicroUsd({ inputTokens: 1, outputTokens: 0 }, { inputPerMtok: 1, outputPerMtok: 1 })).toBe(1n);
    expect(estimateCostMicroUsd({ inputTokens: 1000, outputTokens: 500 }, { inputPerMtok: 3_000_000, outputPerMtok: 15_000_000 })).toBe(10_500n);
    expect(estimateCostMicroUsd({ inputTokens: 0, outputTokens: 0 }, { inputPerMtok: 3, outputPerMtok: 15 })).toBe(0n);
  });
  it('refuses negative or fractional tokens and rates', () => {
    expect(() => estimateCostMicroUsd({ inputTokens: -1, outputTokens: 0 }, { inputPerMtok: 1, outputPerMtok: 1 })).toThrow();
    expect(() => estimateCostMicroUsd({ inputTokens: 1.5, outputTokens: 0 }, { inputPerMtok: 1, outputPerMtok: 1 })).toThrow();
    expect(() => estimateCostMicroUsd({ inputTokens: 1, outputTokens: 0 }, { inputPerMtok: -1, outputPerMtok: 1 })).toThrow();
  });
  it('cents to micro-dollars', () => {
    expect(budgetMicroUsdFromCents(1)).toBe(10_000n);
    expect(budgetMicroUsdFromCents(500)).toBe(5_000_000n);
    expect(budgetMicroUsdFromCents(0)).toBe(0n);
    expect(() => budgetMicroUsdFromCents(-1)).toThrow();
  });
  it('canReserve: spent + reserved + worst <= budget', () => {
    expect(canReserve({ spent: 5n, reserved: 3n, budget: 10n }, 2n)).toBe(true);
    expect(canReserve({ spent: 5n, reserved: 3n, budget: 10n }, 3n)).toBe(false);
    expect(canReserve({ spent: 0n, reserved: 0n, budget: 0n }, 1n)).toBe(false);
  });
  it('settle releases the reservation and books the actual, never negative', () => {
    expect(settle({ spent: 5n, reserved: 3n }, 3n, 2n)).toEqual({ spent: 7n, reserved: 0n });
    expect(settle({ spent: 5n, reserved: 3n }, 3n, 0n)).toEqual({ spent: 5n, reserved: 0n });
  });
  it('settle refuses an overrun and an unknown (or already settled) reservation instead of hiding it', () => {
    const code = (fn: () => unknown) => {
      try {
        fn();
        return null;
      } catch (e) {
        return e instanceof BudgetError ? e.code : 'OTHER';
      }
    };
    expect(code(() => settle({ spent: 90n, reserved: 10n }, 10n, 50n))).toBe('OVERRUN');
    expect(code(() => settle({ spent: 5n, reserved: 1n }, 3n, 0n))).toBe('UNKNOWN_RESERVATION');
    expect(code(() => settle({ spent: 5n, reserved: 0n }, 3n, 1n))).toBe('UNKNOWN_RESERVATION');
  });
  it('never exceeds the budget under any interleaving of reserve/settle (1,000 seeded runs)', () => {
    let seed = 20261030;
    const rnd = (n: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % n;
    };
    for (let run = 0; run < 1000; run++) {
      const budget = BigInt(rnd(200));
      let state = { spent: 0n, reserved: 0n };
      const open: Array<{ worst: bigint }> = [];
      for (let step = 0; step < 40; step++) {
        if (open.length === 0 || rnd(2) === 0) {
          const worst = BigInt(1 + rnd(30));
          if (canReserve({ ...state, budget }, worst)) {
            state = { ...state, reserved: state.reserved + worst };
            open.push({ worst });
          }
        } else {
          const [done] = open.splice(rnd(open.length), 1);
          const over = rnd(8) === 0; // a bill above the reservation must be refused loudly, never booked silently
          const actual = over ? done!.worst + BigInt(1 + rnd(20)) : rnd(3) === 0 ? 0n : BigInt(rnd(Number(done!.worst) + 1));
          if (over) {
            expect(() => settle(state, done!.worst, actual)).toThrow(BudgetError);
            state = settle(state, done!.worst, done!.worst); // the caller books at most what it reserved and raises the alarm
          } else {
            state = settle(state, done!.worst, actual);
          }
          if (state.reserved === 0n) expect(() => settle(state, done!.worst, 0n)).toThrow(BudgetError); // double settle
        }
        expect(state.spent + state.reserved).toBeLessThanOrEqual(budget);
        expect(state.spent >= 0n && state.reserved >= 0n).toBe(true);
      }
    }
  });
  it('baghdadMonth uses UTC+3', () => {
    expect(baghdadMonth(new Date('2026-10-31T21:30:00Z'))).toBe('2026-11');
    expect(baghdadMonth(new Date('2026-10-31T20:59:59Z'))).toBe('2026-10');
    expect(baghdadMonth(new Date('2026-12-31T21:00:00Z'))).toBe('2027-01');
    expect(baghdadMonth(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01');
  });
});

describe('intakeFileAcceptable / STORAGE', () => {
  const jpeg = (n: number) => Object.assign(new Uint8Array(n), { 0: 0xff, 1: 0xd8, 2: 0xff });
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0]);
  const webp = new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ');
  const pdf = new TextEncoder().encode('%PDF-1.4 x');
  it('accepts the four types within limits', () => {
    expect(intakeFileAcceptable({ mediaType: 'image/jpeg', bytes: jpeg(100), pages: null })).toEqual({ ok: true });
    expect(intakeFileAcceptable({ mediaType: 'image/png', bytes: png, pages: null })).toEqual({ ok: true });
    expect(intakeFileAcceptable({ mediaType: 'image/webp', bytes: webp, pages: null })).toEqual({ ok: true });
    expect(intakeFileAcceptable({ mediaType: 'application/pdf', bytes: pdf, pages: INTAKE_LIMITS.maxPages })).toEqual({ ok: true });
  });
  it('refuses with a reason', () => {
    expect(intakeFileAcceptable({ mediaType: 'image/gif', bytes: jpeg(10), pages: null })).toEqual({ ok: false, reason: 'UNSUPPORTED_TYPE' });
    expect(intakeFileAcceptable({ mediaType: 'image/jpeg', bytes: new Uint8Array(0), pages: null })).toEqual({ ok: false, reason: 'EMPTY' });
    expect(intakeFileAcceptable({ mediaType: 'image/jpeg', bytes: jpeg(INTAKE_LIMITS.maxBytes + 1), pages: null })).toEqual({ ok: false, reason: 'TOO_LARGE' });
    expect(intakeFileAcceptable({ mediaType: 'image/jpeg', bytes: jpeg(INTAKE_LIMITS.maxBytes), pages: null }).ok).toBe(true);
    expect(intakeFileAcceptable({ mediaType: 'image/png', bytes: jpeg(10), pages: null })).toEqual({ ok: false, reason: 'TYPE_MISMATCH' });
    expect(intakeFileAcceptable({ mediaType: 'application/pdf', bytes: pdf, pages: INTAKE_LIMITS.maxPages + 1 })).toEqual({ ok: false, reason: 'TOO_MANY_PAGES' });
    expect(intakeFileAcceptable({ mediaType: 'application/pdf', bytes: pdf, pages: null })).toEqual({ ok: false, reason: 'PAGES_UNKNOWN' });
    expect(intakeFileAcceptable({ mediaType: 'application/pdf', bytes: pdf, pages: 0 })).toEqual({ ok: false, reason: 'PAGES_UNKNOWN' });
  });
  it('limits are the R5-5 values', () => {
    expect(INTAKE_LIMITS).toEqual({ maxBytes: 8 * 1024 * 1024, maxPages: 10, maxFilesPerBatch: 20 });
  });
  it('STORAGE counts against storageMb, where 0 means none left', () => {
    expect(STORAGE.limitBytes(2)).toBe(2 * 1024 * 1024);
    expect(STORAGE.fits(0, 1024 * 1024, 1)).toBe(true);
    expect(STORAGE.fits(1, 1024 * 1024, 1)).toBe(false);
    expect(STORAGE.fits(0, 1, 0)).toBe(false);
    expect(STORAGE.filesFit(19, 1)).toBe(true);
    expect(STORAGE.filesFit(20, 1)).toBe(false);
  });
});

describe('barcodeForms', () => {
  it('gives every spelling of one trade item, in both directions', () => {
    const ean13 = '6221031002342';
    const gtin = `0${ean13}`;
    expect(barcodeForms(ean13).sort()).toEqual([ean13, gtin].sort());
    expect(barcodeForms(gtin).sort()).toEqual([ean13, gtin].sort());
    expect(barcodeForms('036000291452').sort()).toEqual(['036000291452', '0036000291452', '00036000291452'].sort());
    expect(barcodeForms('96385074').sort()).toEqual(['96385074', '000096385074', '0000096385074', '00000096385074'].sort());
    expect(barcodeForms(`(01)${gtin}(17)280331(10)A1`)).toEqual(expect.arrayContaining([gtin, ean13]));
  });

  it('a number with a wrong check digit, a short number or text stays exactly as written', () => {
    expect(barcodeForms('6221031002340')).toEqual(['6221031002340']);
    expect(barcodeForms('12345')).toEqual(['12345']);
    expect(barcodeForms('ABC-1')).toEqual(['ABC-1']);
    expect(barcodeForms('  ')).toEqual([]);
  });
});
