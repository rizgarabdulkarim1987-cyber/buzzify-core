import { describe, expect, it } from 'vitest';
import {
  approveBlockers,
  approveControl,
  approveSignature,
  buildHeaderPatch,
  buildRowPatch,
  duplicateTarget,
  editReason,
  formatAmount,
  headerAckShown,
  headerNeedsAck,
  headerFieldSource,
  historyOf,
  jumpId,
  liveRows,
  matchChipOf,
  mathFigures,
  missingFields,
  reviewCounts,
  reviewShown,
  rowFieldSource,
  rowFormOf,
  rowKeyFor,
  urlFresh,
  zoomStep,
  type ReviewData,
  type ReviewRow,
} from '@/app/pharmacy/_ui/intake-review-logic';

const line = (patch: Partial<ReviewRow['line']> = {}): ReviewRow['line'] => ({
  name: 'Panadol',
  strength: '500 mg',
  form: 'tablet',
  pack: '10 strip',
  quantity: 10,
  bonus: 0,
  unitCost: 1000,
  lineTotal: 10000,
  lot: 'A1',
  expiry: '2027-03',
  barcodeText: null,
  unclear: [],
  freeOfCharge: false,
  ...patch,
});

const row = (patch: Partial<ReviewRow> = {}): ReviewRow => ({
  id: 'r1',
  fileId: 'f1',
  lineNo: 1,
  page: 1,
  version: 1,
  removed: false,
  manual: false,
  line: line(),
  extracted: {},
  edited: {},
  flags: [],
  openFlags: [],
  matchState: 'MATCHED',
  match: { productId: 'p1', unitId: 'u1', name: 'Panadol', strength: '500 mg', form: 'tablet', unitLabel: 'strip' },
  candidates: [],
  reviewed: false,
  note: null,
  acknowledged: { flags: [], mismatch: null },
  ...patch,
});

const data = (patch: { rows?: ReviewRow[]; header?: Partial<ReviewData['header']>; batch?: Partial<ReviewData['batch']>; reasons?: ReviewData['approval']['reasons']; files?: ReviewData['files'] } = {}): ReviewData => ({
  batch: { id: 'b1', status: 'OPEN', version: 3, receiptId: null, supplierId: 's1', supplierName: 'Al Noor', ...patch.batch },
  header: {
    values: { invoiceNumber: 'INV-1', invoiceDate: '2027-01-02', currency: 'IQD', total: 10000, discount: null, tax: null },
    extracted: { invoiceNumber: 'INV-1', currency: 'IQD', total: 10000 },
    edited: {},
    status: 'OK',
    conflicts: [],
    acknowledged: null,
    arithmetic: { status: 'OK', expected: '10000', actual: '10000', difference: '0' },
    ...patch.header,
  },
  files: patch.files ?? [{ id: 'f1', status: 'EXTRACTED', mediaType: 'image/png', pages: 1 }],
  rows: patch.rows ?? [row()],
  approval: { ok: (patch.reasons ?? []).length === 0, reasons: patch.reasons ?? [] },
  verdictToken: 'tok',
});

const ctx = { open: true, mayAi: true, writable: true, branchOk: true, online: true };

describe('formatAmount', () => {
  it('writes IQD in whole dinars and USD in cents, grouped, without Float', () => {
    expect(formatAmount(1250, 'IQD')).toBe('1,250');
    expect(formatAmount(1250, 'USD')).toBe('12.50');
    expect(formatAmount(5, 'USD')).toBe('0.05');
    expect(formatAmount(Number.MAX_SAFE_INTEGER, 'IQD')).toBe('9,007,199,254,740,991');
    expect(formatAmount('-1000', 'IQD')).toBe('-1,000');
  });
  it('is null for a value that was not read and for no currency', () => {
    expect(formatAmount(null, 'IQD')).toBeNull();
    expect(formatAmount(100, null)).toBeNull();
  });
});

describe('row form and patch', () => {
  it('shows what the line holds as plain text, empty for a value not read', () => {
    const form = rowFormOf(row({ line: line({ unitCost: 1250, expiry: null, lot: null }) }), 'USD');
    expect(form.unitCost).toBe('12.50');
    expect(form.quantity).toBe('10');
    expect(form.expiry).toBe('');
    expect(form.lot).toBe('');
  });
  it('sends only the changed fields, an emptied field as null, amounts as typed', () => {
    const r = row();
    const built = buildRowPatch(r, { quantity: '12', unitCost: '1,100', lot: '', name: ' Panadol ' }, 'IQD');
    expect(built.patch).toEqual({ quantity: '12', unitCost: '1,100', lot: null });
  });
  it('sends nothing when nothing changed', () => {
    expect(buildRowPatch(row(), { quantity: '10', lot: 'A1' }, 'IQD').patch).toEqual({});
  });
});

describe('row keys', () => {
  it('keeps the key while the request is the same and makes a new one when it changes', () => {
    const make = (p: string) => `${p}-new`;
    const first = rowKeyFor(undefined, 'r1', 1, { quantity: '12' }, make);
    expect(first.clientKey).toBe('irow-new');
    const again = rowKeyFor(first, 'r1', 1, { quantity: '12' }, () => 'other');
    expect(again.clientKey).toBe('irow-new');
    const changed = rowKeyFor(first, 'r1', 1, { quantity: '13' }, () => 'other');
    expect(changed.clientKey).toBe('other');
    const newVersion = rowKeyFor(first, 'r1', 2, { quantity: '12' }, () => 'v2');
    expect(newVersion.clientKey).toBe('v2');
  });
  it('signs an approval by version and token', () => {
    expect(approveSignature(3, 'tok')).not.toBe(approveSignature(4, 'tok'));
    expect(approveSignature(3, 'tok')).not.toBe(approveSignature(3, 'tok2'));
  });
});

describe('flags and match', () => {
  it('names the fields a MISSING line lacks', () => {
    const r = row({ matchState: 'UNMATCHED', match: null, line: line({ quantity: null, lot: ' ', expiry: null, unitCost: 0 }) });
    expect(missingFields(r)).toEqual(['product', 'quantity', 'lot', 'expiry', 'cost']);
    expect(missingFields(row({ line: line({ unitCost: null, freeOfCharge: true }) }))).toEqual([]);
  });
  it('gives expected, actual and difference for a math mismatch as text with the currency rules', () => {
    const r = row({ line: line({ quantity: 10, unitCost: 1000, lineTotal: 9000 }) });
    expect(mathFigures(r, 'IQD')).toEqual({ expected: '10,000', actual: '9,000', difference: '-1,000' });
    expect(mathFigures(row({ line: line({ lineTotal: null }) }), 'IQD')).toBeNull();
  });
  it('maps the match state to a chip kind', () => {
    expect(matchChipOf(row())).toBe('matched');
    expect(matchChipOf(row({ matchState: 'CHOSEN' }))).toBe('chosen');
    expect(matchChipOf(row({ matchState: 'AMBIGUOUS' }))).toBe('ambiguous');
    expect(matchChipOf(row({ matchState: 'UNMATCHED', match: null }))).toBe('unmatched');
  });
  it('reports where a value came from', () => {
    expect(rowFieldSource(row({ edited: { fieldSources: { lot: 'barcode' } } }), 'lot')).toBe('barcode');
    expect(rowFieldSource(row({ edited: { lot: 'B2' } }), 'lot')).toBe('edited');
    expect(rowFieldSource(row({ manual: true, edited: { source: 'manual' } }), 'lot')).toBe('manual');
    expect(rowFieldSource(row(), 'lot')).toBe('read');
  });
  it('shows the server the exact flags the line raises, not only the open ones', () => {
    expect(reviewShown(row({ flags: ['EXPIRED', 'MATH_MISMATCH'], openFlags: ['EXPIRED'] }))).toEqual(['EXPIRED', 'MATH_MISMATCH']);
  });
});

describe('counts and blockers', () => {
  const flagged = [
    row({ id: 'a', lineNo: 1, flags: ['MISSING'], openFlags: ['MISSING'] }),
    row({ id: 'b', lineNo: 2, flags: ['MISSING', 'EXPIRED'], openFlags: ['MISSING', 'EXPIRED'] }),
    row({ id: 'c', lineNo: 3, removed: true, flags: [], openFlags: [] }),
  ];
  it('ignores removed lines', () => {
    expect(liveRows(flagged).map((r) => r.id)).toEqual(['a', 'b']);
    expect(reviewCounts(data({ rows: flagged }))).toEqual({ rows: 2, removed: 1, openFlags: 3, flaggedRows: 2, reviewed: 0 });
  });
  it('groups the server reasons by flag with the first line to jump to (reasons count live lines only)', () => {
    const d = data({
      rows: flagged,
      reasons: [
        { code: 'OPEN_FLAG', rowIndex: 0, flag: 'MISSING' },
        { code: 'OPEN_FLAG', rowIndex: 1, flag: 'MISSING' },
        { code: 'OPEN_FLAG', rowIndex: 1, flag: 'EXPIRED' },
        { code: 'HEADER_MISMATCH' },
      ],
    });
    const blockers = approveBlockers(d);
    expect(blockers).toEqual([
      { kind: 'flag', flag: 'MISSING', count: 2, rowId: 'a', lineNo: 1 },
      { kind: 'flag', flag: 'EXPIRED', count: 1, rowId: 'b', lineNo: 2 },
      { kind: 'header' },
    ]);
  });
  it('adds the things the server asks for that the reasons do not carry: supplier, currency, invoice number', () => {
    const d = data({ batch: { supplierId: null }, header: { values: { invoiceNumber: ' ', invoiceDate: null, currency: null, total: null, discount: null, tax: null } } });
    expect(approveBlockers(d).map((b) => b.kind)).toEqual(['supplier', 'currency', 'number']);
  });
  it('lists a header discount or tax that is not acknowledged as its own blocker', () => {
    const d = data({ reasons: [{ code: 'HEADER_ADJUSTMENT' }] });
    expect(approveBlockers(d)).toEqual([{ kind: 'adjustment' }]);
  });
  it('lists no rows, and files still being read', () => {
    const d = data({ rows: [], reasons: [{ code: 'NO_ROWS' }, { code: 'FILES_STILL_PROCESSING', files: 2 }] });
    expect(approveBlockers(d)).toEqual([{ kind: 'noRows' }, { kind: 'processing', files: 2 }]);
  });
});

describe('who may do what', () => {
  it('gives the first reason an edit is not possible', () => {
    expect(editReason(ctx)).toBe(false);
    expect(editReason({ ...ctx, writable: false })).toBe('readOnly');
    expect(editReason({ ...ctx, branchOk: false })).toBe('branch');
    expect(editReason({ ...ctx, open: false })).toBe('closed');
    expect(editReason({ ...ctx, mayAi: false })).toBe('noAi');
    expect(editReason({ ...ctx, online: false })).toBe('offline');
  });
  it('lets a role without ai.use approve a clean batch, but never a blocked one', () => {
    const clean = data();
    expect(approveControl(clean, { ...ctx, mayAi: false })).toBe(false);
    expect(approveControl(data({ reasons: [{ code: 'NO_ROWS' }], rows: [] }), ctx)).toBe('blocked');
    expect(approveControl(clean, { ...ctx, writable: false })).toBe('readOnly');
    expect(approveControl(clean, { ...ctx, online: false })).toBe('offline');
    expect(approveControl(data({ batch: { status: 'APPROVED' } }), { ...ctx, open: false })).toBe('closed');
  });
});

describe('header', () => {
  it('tells where each header value came from', () => {
    const d = data({ header: { edited: { total: 5 }, conflicts: ['invoiceDate'], values: { invoiceNumber: 'INV-1', invoiceDate: null, currency: 'IQD', total: 5, discount: null, tax: null } } });
    expect(headerFieldSource(d.header, 'total')).toBe('edited');
    expect(headerFieldSource(d.header, 'invoiceDate')).toBe('conflict');
    expect(headerFieldSource(d.header, 'invoiceNumber')).toBe('read');
    expect(headerFieldSource(d.header, 'tax')).toBe('notRead');
  });
  it('builds a patch of changed fields, the supplier apart', () => {
    const d = data();
    expect(buildHeaderPatch(d, { invoiceNumber: 'INV-2', total: '10000', tax: '' })).toEqual({ invoiceNumber: 'INV-2' });
    expect(buildHeaderPatch(d, { supplierId: 's2', currency: 'USD' })).toEqual({ supplierId: 's2', currency: 'USD' });
    expect(buildHeaderPatch(d, { supplierId: '' })).toEqual({ supplierId: null });
  });
  it('shows the exact difference and currency the acknowledgement is bound to', () => {
    const d = data({ header: { status: 'MISMATCH', arithmetic: { status: 'MISMATCH', expected: '9000', actual: '10000', difference: '1000' } } });
    expect(headerAckShown(d)).toEqual({ difference: '1000', currency: 'IQD' });
    expect(headerAckShown(data())).toBeNull();
  });
  it('shows the discount and tax too when the invoice has either, and the difference only when there is one', () => {
    const adjustment = { discount: '500', tax: '0', acknowledged: null };
    const only = data({ header: { adjustment } });
    expect(headerAckShown(only)).toEqual({ difference: null, currency: 'IQD', discount: '500', tax: '0' });
    const both = data({ header: { status: 'MISMATCH', arithmetic: { status: 'MISMATCH', expected: '9700', actual: '9000', difference: '-700' }, adjustment } });
    expect(headerAckShown(both)).toEqual({ difference: '-700', currency: 'IQD', discount: '500', tax: '0' });
  });
  it('asks for the reason while either part is not acknowledged', () => {
    const open = { discount: '500', tax: '0', acknowledged: null };
    expect(headerNeedsAck(data())).toBe(false);
    expect(headerNeedsAck(data({ header: { adjustment: open } }))).toBe(true);
    expect(headerNeedsAck(data({ header: { adjustment: { ...open, acknowledged: { reason: 'checked' } } } }))).toBe(false);
    const mismatch = { status: 'MISMATCH', arithmetic: { status: 'MISMATCH', expected: '9000', actual: '10000', difference: '1000' } } as const;
    expect(headerNeedsAck(data({ header: mismatch }))).toBe(true);
    expect(headerNeedsAck(data({ header: { ...mismatch, acknowledged: { reason: 'checked', difference: '1000' } } }))).toBe(false);
    expect(headerNeedsAck(data({ header: { ...mismatch, acknowledged: { reason: 'checked', difference: '1000' }, adjustment: open } }))).toBe(true);
  });
});

describe('the original and the rest', () => {
  it('treats a signed link as stale a little before it expires', () => {
    expect(urlFresh(1_000, 1_000 + 3 * 60_000)).toBe(true);
    expect(urlFresh(1_000, 1_000 + 4 * 60_000 + 1)).toBe(false);
  });
  it('steps the zoom between fixed sizes and stops at the ends', () => {
    expect(zoomStep(100, 'in')).toBe(150);
    expect(zoomStep(100, 'out')).toBe(75);
    expect(zoomStep(300, 'in')).toBe(300);
    expect(zoomStep(50, 'out')).toBe(50);
  });
  it('counts what was done to a closed batch without values', () => {
    const rows = [
      row({ id: 'a', edited: { quantity: 3 } }),
      row({ id: 'b', removed: true, edited: { removed: true } }),
      row({ id: 'c', manual: true, edited: { source: 'manual' }, reviewed: true }),
    ];
    expect(historyOf(rows)).toEqual({ lines: 3, edited: 1, removed: 1, added: 1, reviewed: 1 });
  });
  it('turns a duplicate refusal into a link target', () => {
    expect(duplicateTarget({ phCode: 'DUPLICATE_INVOICE', existingInvoiceId: 'i9' })).toEqual({ kind: 'invoice', id: 'i9' });
    expect(duplicateTarget({ phCode: 'DUPLICATE_INVOICE', batchId: 'b9' })).toEqual({ kind: 'batch', id: 'b9' });
    expect(duplicateTarget({ phCode: 'OTHER' })).toBeNull();
    expect(duplicateTarget(undefined)).toBeNull();
  });
  it('names the element a blocker jumps to', () => {
    expect(jumpId('abc')).toBe('review-row-abc');
  });
});
