import { describe, expect, it } from 'vitest';
import {
  costVariance,
  emptyPoDraft,
  mergeSuggestions,
  orderLineToReceiptLine,
  poInputOf,
  poSignature,
  poTotals,
  remainingOf,
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
    expect(costVariance({ orderMinor: 2500n, orderCurrency: 'IQD', receivedMinor: 2, receivedCurrency: 'USD' }).kind).toBe('currency');
  });
});
