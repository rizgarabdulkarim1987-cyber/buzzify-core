import { describe, expect, it, vi } from 'vitest';
import { costOf, displayUnitsFor, formatQuantity, nameKey, parseQuantity, stockState, unitCostLabel } from '@/server/domain/pos/stock';

describe('parseQuantity', () => {
  it('reads kg, l, g and pieces with every digit set and decimal mark', () => {
    expect(parseQuantity('2.5', 'GRAM', 'kg')).toBe(2500);
    expect(parseQuantity('٢٫٥', 'GRAM', 'kg')).toBe(2500);
    expect(parseQuantity('۲,۵', 'GRAM', 'kg')).toBe(2500);
    expect(parseQuantity('0.001', 'GRAM', 'kg')).toBe(1);
    expect(parseQuantity('750', 'GRAM', 'g')).toBe(750);
    expect(parseQuantity('-3', 'PIECE', 'pcs')).toBe(-3);
    expect(parseQuantity('12', 'MILLILITER', 'l')).toBe(12000);
    expect(parseQuantity('-0', 'PIECE', 'pcs')).toBe(0);
  });

  it('refuses what is ambiguous or too precise', () => {
    for (const text of ['', '1,500', '1.5.0', 'abc', '1e3', ' ', '.5', '5.']) expect(parseQuantity(text, 'GRAM', 'g')).toBeNull();
    expect(parseQuantity('2.5555', 'GRAM', 'kg')).toBeNull();
    expect(parseQuantity('1.5', 'GRAM', 'g')).toBeNull();
    expect(parseQuantity('10001', 'GRAM', 'kg')).toBeNull();
    expect(parseQuantity('2', 'GRAM', 'pcs')).toBeNull();
  });

  it('never uses parseFloat', () => {
    const spy = vi.spyOn(Number, 'parseFloat');
    const global = vi.spyOn(globalThis, 'parseFloat');
    parseQuantity('2.5', 'GRAM', 'kg');
    expect(spy).not.toHaveBeenCalled();
    expect(global).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('lists display units per unit', () => {
    expect(displayUnitsFor('GRAM')).toEqual(['kg', 'g']);
    expect(displayUnitsFor('PIECE')).toEqual(['pcs']);
  });
});

describe('formatQuantity', () => {
  it('shows kg and l from 1000 and keeps small amounts in the base unit', () => {
    expect(formatQuantity(2500, 'GRAM')).toEqual({ value: '2.5', unit: 'kg' });
    expect(formatQuantity(999, 'GRAM')).toEqual({ value: '999', unit: 'g' });
    expect(formatQuantity(-1250, 'MILLILITER')).toEqual({ value: '-1.25', unit: 'l' });
    expect(formatQuantity(7, 'PIECE')).toEqual({ value: '7', unit: 'pcs' });
    expect(formatQuantity(1000, 'GRAM')).toEqual({ value: '1', unit: 'kg' });
  });
});

describe('costOf', () => {
  it('rounds half up in integers', () => {
    expect(costOf(250, { amount: 8000, quantity: 1000 })).toBe(2000);
    expect(costOf(1, { amount: 1000, quantity: 3000 })).toBe(0);
    expect(costOf(3, { amount: 1000, quantity: 2000 })).toBe(2);
    expect(costOf(5, null)).toBeNull();
  });

  it('refuses a result above int32', () => {
    expect(() => costOf(2_000_000_000, { amount: 2_000_000_000, quantity: 1 })).toThrow(RangeError);
  });

  it('labels the unit cost for display', () => {
    expect(unitCostLabel({ amount: 8000, quantity: 1000 }, 'GRAM')).toBe(8000);
    expect(unitCostLabel({ amount: 12000, quantity: 24 }, 'PIECE')).toBe(500);
  });
});

describe('names and state', () => {
  it('matches names by key', () => {
    expect(nameKey('  Tomato   Paste ')).toBe(nameKey('tomato paste'));
    expect(nameKey('طماطة')).toBe('طماطة');
  });
  it('classifies stock', () => {
    expect(stockState(-1, 0)).toBe('negative');
    expect(stockState(0, 0)).toBe('ok');
    expect(stockState(400, 500)).toBe('low');
    expect(stockState(600, 500)).toBe('ok');
  });
});
