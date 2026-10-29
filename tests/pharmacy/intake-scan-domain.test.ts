import { describe, expect, it } from 'vitest';
import { namesResemble, pickScanTarget, rankMatches, unitByPack, type Candidate } from '@/server/domain/pharmacy/intake';

/** Review of task 9, I1 and I5: the pack unit is never taken silently, and a scan finds its own line. Pure: no database. */

const units = [
  { id: 'u-tab', level: 0, label: 'tablet', baseQty: 1 },
  { id: 'u-strip', level: 1, label: 'strip', baseQty: 10 },
  { id: 'u-box', level: 2, label: 'box', baseQty: 30 },
];
const cand = (extra: Partial<Candidate> = {}): Candidate => ({
  productId: 'p1',
  tradeName: 'Panadol',
  strength: '500 mg',
  form: 'tablet',
  packLabel: '30 box',
  manufacturer: '',
  barcodes: [],
  defaultUnitId: 'u-box',
  units,
  ...extra,
});

describe('unitByPack', () => {
  it('finds the unit the invoice names, by size and name or by name alone', () => {
    expect(unitByPack(units, '30 box')?.id).toBe('u-box');
    expect(unitByPack(units, ' 10  STRIP ')?.id).toBe('u-strip');
    expect(unitByPack(units, 'strip')?.id).toBe('u-strip');
  });
  it('says nothing when the text does not decide', () => {
    expect(unitByPack(units, '')).toBeNull();
    expect(unitByPack(units, '20 box')).toBeNull();
    expect(unitByPack(units, 'bottle')).toBeNull();
    expect(unitByPack([...units, { id: 'u-strip2', level: 1, label: 'strip', baseQty: 14 }], 'strip')).toBeNull();
  });
});

describe('rankMatches: the unit must be decided', () => {
  it('an identity match whose pack text names the unit is MATCHED with that unit', () => {
    const r = rankMatches({ name: 'Panadol', strength: '500 mg', form: 'tablet', pack: '30 box' }, [cand()]);
    expect(r).toMatchObject({ status: 'MATCHED', productId: 'p1', unitId: 'u-box' });
  });
  it('a product with several units and a pack text that names none of them is AMBIGUOUS, never the top unit', () => {
    const r = rankMatches({ name: 'Panadol', strength: '500 mg', form: 'tablet', pack: '30 box' }, [cand({ units: units.filter((u) => u.id !== 'u-box').concat([{ id: 'u-box2', level: 2, label: 'carton', baseQty: 30 }]), packLabel: '30 box' })]);
    expect(r.status).toBe('AMBIGUOUS');
    expect(r.unitId ?? null).toBeNull();
  });
  it('a barcode decides the unit by itself', () => {
    const r = rankMatches({ name: 'x', strength: '', form: '', pack: '', barcode: '6291000000013' }, [cand({ barcodes: [{ code: '6291000000013', unitId: 'u-strip' }] })]);
    expect(r).toMatchObject({ status: 'MATCHED', unitId: 'u-strip' });
  });
});

describe('namesResemble', () => {
  it('shares a word of three letters or more, in any case or script', () => {
    expect(namesResemble('Panadol Extra', 'panadol')).toBe(true);
    expect(namesResemble('أموكسيل 500', 'أموكسيل')).toBe(true);
    expect(namesResemble('Zorbex', 'Panadol')).toBe(false);
    expect(namesResemble('', 'Panadol')).toBe(false);
    expect(namesResemble('mg 5', 'mg 10')).toBe(false);
  });
});

describe('pickScanTarget', () => {
  const rows = [
    { id: 'r1', state: 'MATCHED', productId: 'p2', name: 'Brufen' },
    { id: 'r2', state: 'UNMATCHED', productId: null, name: 'Zorbex' },
    { id: 'r3', state: 'AMBIGUOUS', productId: null, name: 'Panadol 500' },
    { id: 'r4', state: 'CHOSEN', productId: 'p1', name: 'Panadol' },
  ];
  it('takes the first open line whose name resembles the product', () => {
    expect(pickScanTarget(rows, { id: 'p1', tradeName: 'Panadol' })).toEqual({ rowId: 'r3', how: 'open' });
  });
  it('else the line already holding that product', () => {
    expect(pickScanTarget(rows, { id: 'p2', tradeName: 'Brufen Forte' })).toEqual({ rowId: 'r1', how: 'same' });
    expect(pickScanTarget(rows.slice(0, 2), { id: 'p2', tradeName: 'Cetrax' })).toEqual({ rowId: 'r1', how: 'same' });
  });
  it('else none', () => {
    expect(pickScanTarget(rows, { id: 'p9', tradeName: 'Cetrax' })).toBeNull();
  });
});
