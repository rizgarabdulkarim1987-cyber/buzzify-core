import { describe, expect, it } from 'vitest';
import {
  approveControl,
  baseFigures,
  emptyReviewDraft,
  formatAmount,
  headerFieldSource,
  nextOpenId,
  openRowIds,
  reviewShown,
  unitForPack,
  unsavedParts,
  type ReviewData,
  type ReviewRow,
} from '@/app/pharmacy/_ui/intake-review-logic';

/** Review of task 9: I1 (explicit pack unit), I2 (approve with unsaved edits), I4 (conflict tag), I6 (open items), and the cheap minors. Pure. */

const units = [
  { id: 'u-tab', label: 'tablet', baseQty: 1, level: 0 },
  { id: 'u-strip', label: 'strip', baseQty: 10, level: 1 },
  { id: 'u-box', label: 'box', baseQty: 30, level: 2 },
];
const row = (id: string, patch: Partial<ReviewRow> = {}): ReviewRow =>
  ({
    id,
    fileId: 'f',
    lineNo: Number(id.slice(1)),
    page: 1,
    version: 1,
    removed: false,
    manual: false,
    line: { name: 'Panadol', strength: null, form: null, pack: '10 strip', quantity: 4, bonus: 1, unitCost: 1000, lineTotal: 4000, lot: 'A', expiry: '2027-03', barcodeText: null, unclear: [], freeOfCharge: false },
    extracted: {},
    edited: {},
    flags: [],
    openFlags: [],
    matchState: 'CHOSEN',
    match: { productId: 'p', unitId: 'u-strip', name: 'Panadol', strength: '', form: '', unitLabel: 'strip', units },
    candidates: [],
    reviewed: false,
    note: null,
    acknowledged: { flags: [], mismatch: null },
    ...patch,
  }) as ReviewRow;

describe('unitForPack', () => {
  it('preselects the unit the invoice names and nothing when it does not decide', () => {
    expect(unitForPack(units, '10 strip')?.id).toBe('u-strip');
    expect(unitForPack(units, 'Box')?.id).toBe('u-box');
    expect(unitForPack(units, '')).toBeNull();
    expect(unitForPack(units, '12 strip')).toBeNull();
  });
});

describe('baseFigures: the quantity in base units, so a 10x error is visible', () => {
  it('multiplies by the unit size', () => {
    expect(baseFigures(row('r1'))).toEqual({ perPack: 10, unitLabel: 'strip', base: '40', bonusBase: '10' });
    expect(baseFigures(row('r1', { match: { productId: 'p', unitId: 'u-box', name: 'P', strength: '', form: '', unitLabel: 'box', units } }))).toMatchObject({ perPack: 30, base: '120' });
  });
  it('is null when there is no unit or no quantity', () => {
    expect(baseFigures(row('r1', { match: null }))).toBeNull();
    expect(baseFigures(row('r1', { line: { ...row('r1').line, quantity: null } }))).toBeNull();
  });
});

describe('approveControl with unsaved work', () => {
  const data = { batch: { status: 'OPEN' }, approval: { reasons: [] }, rows: [], files: [], header: { conflicts: [], values: { currency: 'IQD', invoiceNumber: 'X' }, arithmetic: null } } as unknown as ReviewData;
  const ctx = { open: true, mayAi: true, writable: true, branchOk: true, online: true };
  it('is disabled while something typed is not saved or a write is running', () => {
    expect(approveControl(data, { ...ctx, unsaved: true })).toBe('unsaved');
    expect(approveControl(data, { ...ctx, writing: true })).toBe('writing');
    expect(approveControl(data, ctx)).toBe(false);
  });
});

describe('unsavedParts', () => {
  it('names the lines and the header that hold unsaved work', () => {
    const draft = { ...emptyReviewDraft(), forms: { r2: { lot: 'x' }, r5: { lot: 'y' } }, header: { total: '1' } };
    expect(unsavedParts(draft, [row('r2'), row('r5'), row('r9')])).toEqual({ lines: [2, 5], header: true });
    expect(unsavedParts(emptyReviewDraft(), [])).toEqual({ lines: [], header: false });
  });
});

describe('headerFieldSource: a typed value ends the conflict', () => {
  const header = { conflicts: ['invoiceNumber'], edited: { invoiceNumber: 'A' }, extracted: { invoiceNumber: 'B' } } as unknown as ReviewData['header'];
  it('reads as edited once a person set it, as conflict before', () => {
    expect(headerFieldSource(header, 'invoiceNumber')).toBe('edited');
    expect(headerFieldSource({ ...header, edited: {} } as ReviewData['header'], 'invoiceNumber')).toBe('conflict');
  });
});

describe('open items: filter and next', () => {
  const rows = [row('r1'), row('r2', { openFlags: ['MISSING'] }), row('r3'), row('r4', { openFlags: ['MODEL_UNCLEAR'] }), row('r5', { removed: true, openFlags: ['MISSING'] })];
  it('lists the lines with an open item or an open form, not removed ones', () => {
    expect(openRowIds(rows, {})).toEqual(['r2', 'r4']);
    expect(openRowIds(rows, { r3: { lot: 'x' } })).toEqual(['r2', 'r3', 'r4']);
  });
  it('goes to the next one after the current line and wraps', () => {
    expect(nextOpenId(rows, null, {})).toBe('r2');
    expect(nextOpenId(rows, 'r2', {})).toBe('r4');
    expect(nextOpenId(rows, 'r4', {})).toBe('r2');
    expect(nextOpenId(rows, 'r3', {})).toBe('r4');
    expect(nextOpenId([row('r1')], null, {})).toBeNull();
  });
});

describe('reviewShown sends the flags as the server raised them', () => {
  it('keeps a flag code this screen does not know', () => {
    expect(reviewShown(row('r1', { flags: ['NEW_FLAG', 'MISSING'] }))).toEqual(['MISSING', 'NEW_FLAG']);
  });
});

describe('no amount without a currency', () => {
  it('shows nothing rather than IQD', () => {
    expect(formatAmount(1250, null)).toBeNull();
    expect(formatAmount(1250, 'IQD')).not.toBeNull();
  });
});
