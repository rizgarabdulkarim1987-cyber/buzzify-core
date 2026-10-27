import { describe, expect, it } from 'vitest';
import { allocateFefo, fefoOrder, sellableStock, toBase, type FefoBatch } from '@/server/domain/pharmacy/stock';

describe('toBase', () => {
  it('multiplies whole quantities (generated)', () => {
    for (const baseQty of [1, 2, 10, 12, 100, 1000]) {
      for (let qty = 0; qty <= 200; qty += 13) expect(toBase(qty, baseQty)).toBe(qty * baseQty);
    }
  });

  it('refuses a result beyond the safe integers; the boundary itself passes', () => {
    expect(toBase(Number.MAX_SAFE_INTEGER, 1)).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => toBase(Number.MAX_SAFE_INTEGER, 2)).toThrow(RangeError);
    expect(() => toBase(2 ** 40, 2 ** 14)).toThrow(RangeError);
    expect(toBase(2 ** 26, 2 ** 26)).toBe(2 ** 52);
  });

  it('refuses fractions, negatives, NaN, and a baseQty below 1', () => {
    for (const q of [1.5, -1, NaN, Infinity]) expect(() => toBase(q, 10)).toThrow(RangeError);
    for (const b of [0, -1, 2.5, NaN]) expect(() => toBase(3, b)).toThrow(RangeError);
  });
});

describe('sellableStock', () => {
  const buckets = { available: 40, reserved: 5, quarantine: 3, damaged: 2 };
  const today = '2027-03-15';

  it('is only the available bucket for an active, unexpired batch', () => {
    expect(sellableStock(buckets, { status: 'ACTIVE', expiryDate: '2027-12-31' }, today)).toBe(40);
  });

  it('the expiry day still sells, the day after does not', () => {
    expect(sellableStock(buckets, { status: 'ACTIVE', expiryDate: today }, today)).toBe(40);
    expect(sellableStock(buckets, { status: 'ACTIVE', expiryDate: '2027-03-14' }, today)).toBe(0);
  });

  it('a recalled or blocked batch sells nothing', () => {
    expect(sellableStock(buckets, { status: 'RECALLED', expiryDate: '2027-12-31' }, today)).toBe(0);
    expect(sellableStock(buckets, { status: 'BLOCKED', expiryDate: '2027-12-31' }, today)).toBe(0);
  });

  it('reserved, quarantine and damaged never count', () => {
    const only = { available: 0, reserved: 9, quarantine: 9, damaged: 9 };
    expect(sellableStock(only, { status: 'ACTIVE', expiryDate: '2027-12-31' }, today)).toBe(0);
  });
});

const b = (id: string, lot: string, expiryDate: string, expiryPrecision: 'DAY' | 'MONTH' = 'DAY'): FefoBatch => ({
  id,
  lot,
  expiryDate,
  expiryPrecision,
});

describe('fefoOrder', () => {
  it('earliest expiry, then lot, then id', () => {
    const list = [b('3', 'B', '2027-05-01'), b('2', 'B', '2027-04-01'), b('1', 'A', '2027-05-01'), b('0', 'B', '2027-05-01')];
    expect(list.sort(fefoOrder).map((x) => x.id)).toEqual(['2', '1', '0', '3']);
  });

  it('a MONTH expiry sorts by its month end, after a DAY expiry inside that month', () => {
    const month = b('m', 'A', '2027-03-31', 'MONTH');
    const early = b('d', 'Z', '2027-03-10');
    const late = b('l', 'A', '2027-04-01');
    expect([late, month, early].sort(fefoOrder).map((x) => x.id)).toEqual(['d', 'm', 'l']);
  });

  it('is a consistent total order over generated batches', () => {
    const all: FefoBatch[] = [];
    for (let i = 0; i < 40; i++) {
      all.push(b(String(i % 7), String.fromCharCode(65 + (i % 3)), `2027-0${1 + (i % 4)}-${10 + (i % 2)}`));
    }
    const sorted = [...all].sort(fefoOrder);
    for (let i = 1; i < sorted.length; i++) expect(fefoOrder(sorted[i - 1]!, sorted[i]!)).toBeLessThanOrEqual(0);
    expect(fefoOrder(all[0]!, all[0]!)).toBe(0);
  });
});

describe('allocateFefo', () => {
  const batches = [
    { ...b('c', 'L3', '2027-09-01'), sellable: 50 },
    { ...b('a', 'L1', '2027-04-01'), sellable: 10 },
    { ...b('z', 'L0', '2027-05-01'), sellable: 0 },
    { ...b('b', 'L2', '2027-06-01'), sellable: 20 },
  ];

  it('takes from the earliest first and spills over', () => {
    expect(allocateFefo(batches, 25)).toEqual({
      ok: true,
      allocations: [
        { batchId: 'a', qty: 10 },
        { batchId: 'b', qty: 15 },
      ],
    });
  });

  it('an exact fit, and zero needed, allocate cleanly', () => {
    expect(allocateFefo(batches, 80)).toMatchObject({ ok: true });
    expect(allocateFefo(batches, 0)).toEqual({ ok: true, allocations: [] });
  });

  it('reports the shortfall and what could be taken', () => {
    expect(allocateFefo(batches, 100)).toEqual({
      ok: false,
      shortfall: 20,
      allocations: [
        { batchId: 'a', qty: 10 },
        { batchId: 'b', qty: 20 },
        { batchId: 'c', qty: 50 },
      ],
    });
  });

  it('does not mutate its input and the allocations always add up (generated)', () => {
    const copy = JSON.parse(JSON.stringify(batches));
    for (let need = 0; need <= 90; need += 3) {
      const r = allocateFefo(batches, need);
      const taken = r.allocations.reduce((s, x) => s + x.qty, 0);
      expect(taken).toBe(r.ok ? need : need - r.shortfall);
      expect(r.allocations.every((x) => x.qty > 0)).toBe(true);
    }
    expect(batches).toEqual(copy);
  });

  it('refuses an invalid quantity', () => {
    expect(() => allocateFefo(batches, -1)).toThrow(RangeError);
    expect(() => allocateFefo(batches, 1.5)).toThrow(RangeError);
  });
});
