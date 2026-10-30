import { describe, expect, it } from 'vitest';
import { draftOfReceipt, emptyDraft, inputOf, type LineDraft } from '@/app/pharmacy/_ui/receipt-draft';
import type { ReceiptDetail } from '@/server/pharmacy/receipts';
import {
  costVariance,
  emptyPoDraft,
  mergeSuggestions,
  orderLineToReceiptLine,
  poInputOf,
  poSignature,
  poTotals,
  remainingOf,
  attemptKeyFor,
  withVersion,
  supplierUpdateInput,
  emptySupplierDraft,
  supplierInputOf,
  supplierSignature,
  type PoDraft,
  type PoDraftLine,
} from '@/app/pharmacy/_ui/purchasing-logic';

const line = (patch: Partial<PoDraftLine> = {}): PoDraftLine => ({
  key: 'a',
  productId: 'p1',
  productName: 'Paracetamol',
  productMeta: '500 mg',
  units: [
    { id: 'u0', label: 'Tablet', baseQty: 1 },
    { id: 'u1', label: 'Box', baseQty: 20 },
  ],
  unitId: 'u1',
  qty: '10',
  bonus: '0',
  cost: '2500',
  ...patch,
});

const draft = (patch: Partial<PoDraft> = {}): PoDraft => ({ ...emptyPoDraft('key-1', 'IQD'), supplierId: 's1', lines: [line()], ...patch });

describe('poTotals', () => {
  it('adds quantity times unit cost per currency in BigInt, bonus not charged', () => {
    const totals = poTotals(draft({ lines: [line({ qty: '10', bonus: '2', cost: '2500' }), line({ key: 'b', productId: 'p2', qty: '3', cost: '1,000' })] }));
    expect(totals).toEqual([{ currency: 'IQD', totalMinor: 28_000n }]);
  });
  it('uses cents for USD and never rounds through a float', () => {
    const totals = poTotals(draft({ currency: 'USD', lines: [line({ qty: '3', cost: '0.10' }), line({ key: 'b', productId: 'p2', qty: '1', cost: '12.34' })] }));
    expect(totals).toEqual([{ currency: 'USD', totalMinor: 1264n }]);
  });
  it('skips lines that are not yet valid and reports zero for an empty order', () => {
    expect(poTotals(draft({ lines: [line({ qty: 'x' }), line({ key: 'b', cost: '' })] }))).toEqual([{ currency: 'IQD', totalMinor: 0n }]);
    expect(poTotals(draft({ lines: [] }))).toEqual([{ currency: 'IQD', totalMinor: 0n }]);
  });
});

describe('remainingOf', () => {
  it('works out quantity and bonus separately and never goes below zero', () => {
    expect(remainingOf({ qtyOrdered: 10, bonusOrdered: 2, receivedQty: 4, receivedBonus: 2 })).toEqual({ qty: 6, bonus: 0 });
    expect(remainingOf({ qtyOrdered: 10, bonusOrdered: 0, receivedQty: 12, receivedBonus: 0 })).toEqual({ qty: 0, bonus: 0 });
  });
});

describe('poInputOf', () => {
  it('builds the action input with cost as a minor-unit string', () => {
    const built = poInputOf(draft({ expectedOn: '2026-11-05', note: 'hi' }));
    expect(built.problems).toEqual({});
    expect(built.input).toEqual({
      supplierId: 's1',
      currency: 'IQD',
      expectedOn: '2026-11-05',
      note: 'hi',
      lines: [{ productId: 'p1', unitId: 'u1', qtyOrdered: 10, bonusOrdered: 0, unitCostMinor: '2500' }],
    });
  });
  it('names each problem that needs no server', () => {
    const built = poInputOf(draft({ supplierId: '', lines: [line({ qty: '0', bonus: '-1', cost: '12,5' })] }));
    expect(built.input).toBeUndefined();
    expect(built.problems).toMatchObject({ supplierId: 'supplier', 'lines.0.qty': 'qty', 'lines.0.bonus': 'bonus', 'lines.0.cost': 'cost' });
  });
  it('needs at least one line and refuses the same product and unit twice', () => {
    expect(poInputOf(draft({ lines: [] })).problems.lines).toBe('lines');
    const twice = poInputOf(draft({ lines: [line(), line({ key: 'b' })] }));
    expect(twice.problems['lines.1.productId']).toBe('duplicate');
  });
});

describe('poSignature', () => {
  it('is the same for the same request and changes with any field the server would hash', () => {
    const a = poSignature(draft());
    expect(poSignature(draft({ clientKey: 'other', version: 4 }))).toBe(a);
    expect(poSignature(draft({ note: 'x' }))).not.toBe(a);
    expect(poSignature(draft({ lines: [line({ qty: '11' })] }))).not.toBe(a);
    expect(poSignature(draft({ currency: 'USD' }))).not.toBe(a);
  });
});

describe('mergeSuggestions', () => {
  const suggestion = (productId: string, qty: number) => ({
    productId,
    productName: `P ${productId}`,
    baseUnitId: `${productId}-base`,
    baseUnitLabel: 'Tablet',
    available: 1,
    minQty: 10,
    reorderQty: 0,
    suggestedQty: qty,
  });
  it('adds a line per suggested product in the base unit with the suggested quantity', () => {
    const merged = mergeSuggestions([], [suggestion('p9', 40)], 0);
    expect(merged.added).toBe(1);
    expect(merged.lines[0]).toMatchObject({ productId: 'p9', unitId: 'p9-base', qty: '40', bonus: '0', cost: '' });
    expect(merged.lines[0]!.units).toEqual([{ id: 'p9-base', label: 'Tablet', baseQty: 1 }]);
  });
  it('leaves a product already on the order alone and says how many it skipped', () => {
    const merged = mergeSuggestions([line()], [suggestion('p1', 5), suggestion('p2', 7)], 1);
    expect(merged.added).toBe(1);
    expect(merged.skipped).toBe(1);
    expect(merged.lines.map((l) => l.productId)).toEqual(['p1', 'p2']);
    expect(merged.lines[1]!.key).toBe('n2');
  });
});

describe('orderLineToReceiptLine', () => {
  const order = { lineId: 'L1', productId: 'p1', unitId: 'u1', qtyOrdered: 10, bonusOrdered: 2, receivedQty: 4, receivedBonus: 0, unitCostMinor: '2500' };
  it('pre-fills what is still to arrive and the agreed cost', () => {
    expect(orderLineToReceiptLine(order, 'IQD')).toEqual({ purchaseOrderLineId: 'L1', productId: 'p1', unitId: 'u1', qty: '6', bonusQty: '2', cost: '2500', currency: 'IQD' });
  });
  it('leaves the cost empty without cost.view and returns null when nothing is left', () => {
    expect(orderLineToReceiptLine({ ...order, unitCostMinor: undefined }, 'USD')?.cost).toBe('');
    expect(orderLineToReceiptLine({ ...order, receivedQty: 10, receivedBonus: 2 }, 'IQD')).toBeNull();
  });
  it('writes USD cost with cents', () => {
    expect(orderLineToReceiptLine({ ...order, unitCostMinor: '1234' }, 'USD')?.cost).toBe('12.34');
  });
});

describe('costVariance', () => {
  it('compares in the same currency only', () => {
    expect(costVariance({ orderMinor: 2500n, orderCurrency: 'IQD', receivedMinor: 2700n, receivedCurrency: 'IQD' })).toEqual({ kind: 'higher', diffMinor: 200n, currency: 'IQD' });
    expect(costVariance({ orderMinor: 2500n, orderCurrency: 'IQD', receivedMinor: 2000n, receivedCurrency: 'IQD' })).toEqual({ kind: 'lower', diffMinor: 500n, currency: 'IQD' });
    expect(costVariance({ orderMinor: 2500n, orderCurrency: 'IQD', receivedMinor: 2500n, receivedCurrency: 'IQD' }).kind).toBe('same');
    expect(costVariance({ orderMinor: 2500n, orderCurrency: 'IQD', receivedMinor: 2n, receivedCurrency: 'USD' }).kind).toBe('currency');
  });
});

describe('supplier form', () => {
  const filled = { ...emptySupplierDraft('k-1', 'IQD'), name: '  Al Noor  Pharma ', termsDays: '30' };
  it('builds the input with terms as a whole number', () => {
    const built = supplierInputOf(filled);
    expect(built.problems).toEqual({});
    expect(built.input).toMatchObject({ name: '  Al Noor  Pharma ', defaultCurrency: 'IQD', termsDays: 30, phone: '', note: '' });
  });
  it('names the problems that need no server', () => {
    expect(supplierInputOf({ ...filled, name: '   ' }).problems.name).toBe('name');
    expect(supplierInputOf({ ...filled, termsDays: '400' }).problems.termsDays).toBe('terms');
    expect(supplierInputOf({ ...filled, termsDays: '1.5' }).problems.termsDays).toBe('terms');
    expect(supplierInputOf({ ...filled, termsDays: '' }).input).toMatchObject({ termsDays: 0 });
  });
  it('keeps one signature for one request, not counting the key or version', () => {
    const a = supplierSignature(filled);
    expect(supplierSignature({ ...filled, clientKey: 'z', version: 3 })).toBe(a);
    expect(supplierSignature({ ...filled, phone: '0770' })).not.toBe(a);
  });
});

describe('a second save in one visit', () => {
  it('uses the version the first save returned, so there is no false conflict', () => {
    const first = { ...emptySupplierDraft('k', 'IQD'), name: 'Al Noor', version: 1 };
    expect(supplierUpdateInput(first, 's1')).toMatchObject({ supplierId: 's1', expectedVersion: 1 });
    // The server answered version 2: the draft is re-based on it and the next save sends 2, not 1.
    const after = withVersion(first, 2);
    expect(after.name).toBe('Al Noor');
    expect(supplierUpdateInput(after, 's1')!.expectedVersion).toBe(2);
    expect(supplierUpdateInput(withVersion(after, 3), 's1')!.expectedVersion).toBe(3);
  });
});

describe('attemptKeyFor', () => {
  const make = (prefix: string) => `${prefix}-new`;
  it('reuses the saved key while the request is unchanged and replaces it after an edit', () => {
    const first = attemptKeyFor({ clientKey: 'po-old', keySig: undefined }, 'sig-a', 'po', make);
    expect(first).toEqual({ clientKey: 'po-new', keySig: 'sig-a' });
    const retry = attemptKeyFor(first, 'sig-a', 'po', () => 'po-other');
    expect(retry).toEqual(first);
    const edited = attemptKeyFor(first, 'sig-b', 'po', () => 'po-third');
    expect(edited).toEqual({ clientKey: 'po-third', keySig: 'sig-b' });
  });
});

describe('receipt drafts and the order', () => {
  const line = (patch: Partial<LineDraft> = {}): LineDraft => ({
    key: 'l1',
    productId: 'p1',
    productName: 'P',
    productMeta: '',
    units: [{ id: 'u1', label: 'Box', baseQty: 1 }],
    unitId: 'u1',
    qty: '5',
    bonusQty: '0',
    lot: 'L1',
    expiry: '2030-01-31',
    cost: '2500',
    currency: 'IQD',
    freeOfCharge: false,
    acceptExpired: false,
    ...patch,
  });
  const base = () => ({ ...emptyDraft('key', '2026-10-28'), supplierName: 'Acme', reference: 'R1', note: 'n' });

  it('sends exactly the unchanged input for a draft without an order', () => {
    const built = inputOf({ ...base(), lines: [line()] });
    expect(built.problems).toEqual({});
    expect(built.input).toEqual({
      supplierName: 'Acme',
      reference: 'R1',
      receivedOn: '2026-10-28',
      note: 'n',
      lines: [
        { productId: 'p1', unitId: 'u1', qty: 5, bonusQty: 0, lot: 'L1', expiry: '2030-01-31', unitCostMinor: '2500', currency: 'IQD', freeOfCharge: false, acceptExpired: false },
      ],
    });
    expect(Object.keys(built.input!)).not.toContain('purchaseOrderId');
    expect(Object.keys((built.input!.lines as object[])[0]!)).not.toContain('purchaseOrderLineId');
  });

  it('carries the order, the supplier and each order line when the draft names an order', () => {
    const built = inputOf({ ...base(), supplierId: 's1', purchaseOrderId: 'o1', purchaseOrderNumber: 'PO-1', lines: [line({ purchaseOrderLineId: 'ol1' })] });
    expect(built.input).toMatchObject({ supplierId: 's1', purchaseOrderId: 'o1' });
    expect((built.input!.lines as Array<Record<string, unknown>>)[0]).toMatchObject({ purchaseOrderLineId: 'ol1' });
  });

  it('keeps the order ids when a saved receipt becomes a draft again', () => {
    const receipt = {
      id: 'r1', number: null, status: 'DRAFT', branchId: 'b', supplierName: 'Acme', supplierId: 's1', purchaseOrderId: 'o1', purchaseOrderNumber: 'PO-1',
      reference: '', receivedOn: '2026-10-28', lineCount: 1, version: 3, createdAt: '', note: '', confirmedAt: null,
      lines: [{ lineNo: 1, productId: 'p1', productName: 'P', unitId: 'u1', unitLabel: 'Box', qty: 5, bonusQty: 0, baseQty: 5, lot: 'L1', expiryDate: '2030-01-31', expiryPrecision: 'DAY', freeOfCharge: false, acceptExpired: false, batchId: null, purchaseOrderLineId: 'ol1', unitCostMinor: '2500', currency: 'IQD' }],
    } as unknown as ReceiptDetail;
    const draft = draftOfReceipt(receipt, {}, 'IQD');
    expect(draft).toMatchObject({ purchaseOrderId: 'o1', purchaseOrderNumber: 'PO-1', supplierId: 's1' });
    expect(draft.lines[0]).toMatchObject({ purchaseOrderLineId: 'ol1' });
    const plain = draftOfReceipt({ ...receipt, purchaseOrderId: null, supplierId: null, lines: [{ ...receipt.lines[0]!, purchaseOrderLineId: null }] } as unknown as ReceiptDetail, {}, 'IQD');
    expect(Object.keys(plain)).not.toContain('purchaseOrderId');
    expect(Object.keys(plain.lines[0]!)).not.toContain('purchaseOrderLineId');
  });
});
