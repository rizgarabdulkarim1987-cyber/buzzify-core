import { describe, expect, it } from 'vitest';
import { filterQuery, parseStockFilter, productCount, stockState, STOCK_FILTERS } from '@/app/pharmacy/_ui/stock-logic';
import { getStudioTranslator } from '@/studio/messages';
import type { BatchView, ProductBalance } from '@/server/pharmacy/stock-reads';

const bucket = (over: Partial<BatchView['buckets'][number]> = {}) => ({ branchId: 'b1', available: 10, reserved: 0, quarantine: 0, damaged: 0, sellable: 10, ...over });
const batch = (over: Partial<BatchView> = {}): BatchView => ({
  batchId: 'x',
  lot: 'L1',
  expiryDate: '2028-03-31',
  expiryPrecision: 'DAY',
  status: 'ACTIVE',
  expired: false,
  buckets: [bucket()],
  ...over,
});
const product = (over: Partial<ProductBalance> = {}): ProductBalance => ({
  productId: 'p1',
  tradeName: 'Panadol',
  strength: '',
  form: '',
  active: true,
  genericName: '',
  barcode: null,
  baseUnit: 'tablet',
  price: null,
  branches: [{ ...bucket(), minQty: 0 }],
  batches: [batch()],
  ...over,
});
const TODAY = '2026-10-27';

describe('the stock filter', () => {
  it('reads all, low, expiring and out from ?filter=, and anything else as all', () => {
    expect(STOCK_FILTERS).toEqual(['all', 'low', 'expiring', 'out']);
    expect(parseStockFilter('low')).toBe('low');
    expect(parseStockFilter('expiring')).toBe('expiring');
    expect(parseStockFilter('out')).toBe('out');
    for (const raw of [undefined, '', 'all', 'LOW', 'nope', ['low']]) expect(parseStockFilter(raw as string | undefined), String(raw)).toBe('all');
  });

  it('maps each filter to the stock query option', () => {
    expect(filterQuery('all')).toEqual({});
    expect(filterQuery('low')).toEqual({ lowStock: true });
    expect(filterQuery('expiring')).toEqual({ expiring: true });
    expect(filterQuery('out')).toEqual({ outOfStock: true });
  });
});

describe('the state of a row', () => {
  it('is out when nothing is sellable in the branches shown', () => {
    expect(stockState(product({ branches: [{ ...bucket({ available: 5, sellable: 0 }), minQty: 0 }] }), TODAY)).toBe('out');
    expect(stockState(product({ branches: [], batches: [] }), TODAY)).toBe('out');
  });

  it('is low when a branch is below its minimum, ahead of expiring', () => {
    const soon = batch({ expiryDate: '2026-12-01' });
    expect(stockState(product({ branches: [{ ...bucket({ sellable: 4 }), minQty: 10 }], batches: [soon] }), TODAY)).toBe('low');
  });

  it('is expiring when a batch with stock expires within 90 days, and fine otherwise', () => {
    expect(stockState(product({ batches: [batch({ expiryDate: '2026-12-01' })] }), TODAY)).toBe('expiring');
    // An expired batch is not "expiring"; neither is a soon batch with nothing left in it.
    expect(stockState(product({ batches: [batch({ expiryDate: '2026-10-01', expired: true }), batch({ batchId: 'y' })] }), TODAY)).toBe('ok');
    expect(stockState(product({ batches: [batch({ expiryDate: '2026-12-01', buckets: [bucket({ available: 0, sellable: 0 })] }), batch({ batchId: 'y' })] }), TODAY)).toBe('ok');
    expect(stockState(product(), TODAY)).toBe('ok');
  });
});

describe('the product count', () => {
  it('says the number with grouping and the right plural in each language', () => {
    const en = getStudioTranslator('en');
    expect(productCount(en, 1)).toBe('1 product');
    expect(productCount(en, 1003)).toBe('1,003 products');
    expect(productCount(en, 0)).toBe('0 products');
    const ar = getStudioTranslator('ar');
    expect(productCount(ar, 1)).toBe('منتج واحد');
    expect(productCount(ar, 2)).toBe('منتجان');
    expect(productCount(ar, 3)).toBe('3 منتجات');
    expect(productCount(ar, 11)).toBe('11 منتجًا');
    expect(productCount(ar, 100)).toBe('100 منتج');
    expect(productCount(ar, 1003)).toBe('1,003 منتجات');
    expect(productCount(ar, 0)).toBe('لا منتجات');
    const ckb = getStudioTranslator('ckb');
    expect(productCount(ckb, 1)).toBe('1 بەرهەم');
    expect(productCount(ckb, 1003)).toBe('1,003 بەرهەم');
  });
});
