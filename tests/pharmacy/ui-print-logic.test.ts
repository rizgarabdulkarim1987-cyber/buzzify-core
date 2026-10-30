import { describe, expect, it } from 'vitest';
import { barsOf } from '@/app/pharmacy/_ui/code128';
import {
  expandLabels,
  labelBarcode,
  labelCss,
  LABEL_BOX,
  MAX_LABELS,
  MAX_PER_ITEM,
  MIN_MODULE_MM,
  pageCss,
  priceText,
  QUIET_MODULES,
  safeQty,
  type LabelItem,
} from '@/app/pharmacy/_ui/print-logic';
import { DEFAULT_WORKSTATION } from '@/server/domain/pharmacy/print-settings';

const fitOf = (text: string, width: number) => {
  const r = labelBarcode(text, width);
  if (!r.ok) throw new Error(r.reason);
  return r;
};
const item = (over: Partial<LabelItem> = {}): LabelItem => ({ key: 'a', productId: 'p1', name: 'Panadol', strength: '500 mg', form: 'tablet', barcode: '5901234123457', lot: null, expiry: null, price: null, qty: 1, ...over });

describe('page CSS', () => {
  it('sets the paper and the margins from the settings, in millimetres', () => {
    expect(pageCss({ ...DEFAULT_WORKSTATION, marginMm: { top: 5, right: 6, bottom: 7, left: 8 } })).toBe('@page { size: A4 portrait; margin: 5mm 6mm 7mm 8mm; }');
    expect(pageCss({ ...DEFAULT_WORKSTATION, paper: 'A5' })).toContain('size: A5 portrait');
  });

  it('sets the page of a label to the label itself, with no margin', () => {
    expect(labelCss('40x25')).toBe('@page { size: 40mm 25mm; margin: 0; }');
    expect(labelCss('50x30')).toBe('@page { size: 50mm 30mm; margin: 0; }');
    expect(labelCss('58')).toBe('@page { size: 58mm 40mm; margin: 0; }');
    expect(LABEL_BOX['58'].widthMm).toBe(58);
  });
});

describe('label quantities', () => {
  it('keeps a quantity to whole labels from 1 to the cap', () => {
    expect(safeQty('3')).toBe(3);
    expect(safeQty(' 12 ')).toBe(12);
    for (const bad of ['', '0', '-1', '1.5', 'abc', '1e3']) expect(safeQty(bad), bad).toBeNull();
    expect(safeQty(String(MAX_PER_ITEM + 1))).toBeNull();
    expect(safeQty(String(MAX_PER_ITEM))).toBe(MAX_PER_ITEM);
  });

  it('repeats each item by its quantity, in order, and stops at the sheet cap', () => {
    const out = expandLabels([item({ key: 'a', qty: 2 }), item({ key: 'b', qty: 3, name: 'Brufen' })]);
    expect(out.labels.map((l) => l.name)).toEqual(['Panadol', 'Panadol', 'Brufen', 'Brufen', 'Brufen']);
    expect(out.truncated).toBe(false);
    const many = expandLabels(Array.from({ length: 10 }, (_, i) => item({ key: `k${i}`, qty: MAX_PER_ITEM })));
    expect(many.labels).toHaveLength(MAX_LABELS);
    expect(many.truncated).toBe(true);
  });
});

describe('label barcode fit', () => {
  it('spreads the bars over the label width less the padding, with quiet zones of ten modules', () => {
    const text = '5901234123457';
    const { modules } = barsOf(text);
    const fit = fitOf(text, 50);
    expect(fit.viewModules).toBe(modules + 2 * QUIET_MODULES);
    expect(fit.moduleMm).toBeCloseTo((50 - 2 * 1.5) / (modules + 2 * QUIET_MODULES), 6);
    expect(fit.widthMm).toBeCloseTo(fit.viewModules * fit.moduleMm, 6);
    expect(fit.fits).toBe(true);
    expect(fit.bars[0]!.x).toBe(QUIET_MODULES);
    // Narrower labels give a narrower module, and a long text no longer fits the smallest label.
    expect(fitOf(text, 40).moduleMm).toBeLessThan(fit.moduleMm);
    expect(fitOf(text, 40).moduleMm).toBeGreaterThanOrEqual(MIN_MODULE_MM);
    expect(fitOf('LOT-0123456789-ABCDEFGHIJ-KLMNOPQRST', 40).fits).toBe(false);
  });

  it('says why when the text cannot be a barcode', () => {
    expect(labelBarcode('', 50)).toMatchObject({ ok: false, reason: 'EMPTY' });
    expect(labelBarcode('é', 50)).toMatchObject({ ok: false, reason: 'CHARSET' });
  });
});

describe('price text', () => {
  it('writes the exact minor units per currency and never a float', () => {
    expect(priceText({ amountMinor: '1500', currency: 'IQD' })).toBe('1,500');
    expect(priceText({ amountMinor: '1250', currency: 'USD' })).toBe('12.50');
    expect(priceText({ amountMinor: '9007199254740993', currency: 'IQD' })).toBe('9,007,199,254,740,993');
    expect(priceText(null)).toBeNull();
  });
});
