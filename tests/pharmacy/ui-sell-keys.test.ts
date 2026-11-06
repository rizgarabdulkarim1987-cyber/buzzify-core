import { describe, expect, it } from 'vitest';
import { cashierKeyOf } from '@/app/pharmacy/_ui/sell-keys';

const free = { inSearch: false, inTextField: false, searchEmpty: true, modalOpen: false };
const search = (empty: boolean) => ({ inSearch: true, inTextField: true, searchEmpty: empty, modalOpen: false });
const cell = { inSearch: false, inTextField: true, searchEmpty: true, modalOpen: false };

describe('cashierKeyOf', () => {
  it('maps the function keys anywhere', () => {
    const table: [string, string][] = [['F2', 'cash'], ['F3', 'credit'], ['F4', 'new'], ['F6', 'unit'], ['F7', 'inquiry'], ['F8', 'hold'], ['F9', 'discount']];
    for (const [key, kind] of table) {
      expect(cashierKeyOf({ key }, free)).toEqual({ kind });
      expect(cashierKeyOf({ key }, search(false))).toEqual({ kind });
      expect(cashierKeyOf({ key }, cell)).toEqual({ kind });
    }
  });

  it('* and / work outside text fields and on an empty search only', () => {
    expect(cashierKeyOf({ key: '*' }, free)).toEqual({ kind: 'unit' });
    expect(cashierKeyOf({ key: '*' }, search(true))).toEqual({ kind: 'unit' });
    expect(cashierKeyOf({ key: '*' }, search(false))).toBeNull();
    expect(cashierKeyOf({ key: '*' }, cell)).toBeNull();
    expect(cashierKeyOf({ key: '/' }, free)).toEqual({ kind: 'focusScan' });
    expect(cashierKeyOf({ key: '/' }, search(true))).toEqual({ kind: 'focusScan' });
    expect(cashierKeyOf({ key: '/' }, search(false))).toBeNull();
    expect(cashierKeyOf({ key: '/' }, cell)).toBeNull();
  });

  it('+, - and Delete change the line outside text fields and from the empty scan field (fix round 2)', () => {
    expect(cashierKeyOf({ key: '+' }, free)).toEqual({ kind: 'qtyUp' });
    expect(cashierKeyOf({ key: '-' }, free)).toEqual({ kind: 'qtyDown' });
    expect(cashierKeyOf({ key: '+' }, search(true))).toEqual({ kind: 'qtyUp' });
    expect(cashierKeyOf({ key: '-' }, search(true))).toEqual({ kind: 'qtyDown' });
    expect(cashierKeyOf({ key: 'Delete' }, search(true))).toEqual({ kind: 'remove' });
    expect(cashierKeyOf({ key: 'Delete' }, search(false))).toBeNull();
    for (const ctx of [search(false), cell]) {
      expect(cashierKeyOf({ key: '+' }, ctx)).toBeNull();
      expect(cashierKeyOf({ key: '-' }, ctx)).toBeNull();
    }
  });

  it('Alt+digit and Alt+arrows switch receipts (RTL: left is next)', () => {
    expect(cashierKeyOf({ key: '3', altKey: true }, free)).toEqual({ kind: 'switch', index: 2 });
    expect(cashierKeyOf({ key: '1', altKey: true }, search(false))).toEqual({ kind: 'switch', index: 0 });
    expect(cashierKeyOf({ key: '6', altKey: true }, free)).toEqual({ kind: 'switch', index: 5 });
    expect(cashierKeyOf({ key: '7', altKey: true }, free)).toBeNull();
    expect(cashierKeyOf({ key: '0', altKey: true }, free)).toBeNull();
    expect(cashierKeyOf({ key: 'ArrowLeft', altKey: true }, free)).toEqual({ kind: 'switchRel', delta: 1 });
    expect(cashierKeyOf({ key: 'ArrowRight', altKey: true }, free)).toEqual({ kind: 'switchRel', delta: -1 });
  });

  it('plain Alt+x and Ctrl/Meta combinations mean nothing', () => {
    expect(cashierKeyOf({ key: 'x', altKey: true }, free)).toBeNull();
    expect(cashierKeyOf({ key: 'F2', ctrlKey: true }, free)).toBeNull();
    expect(cashierKeyOf({ key: 'F2', metaKey: true }, free)).toBeNull();
    expect(cashierKeyOf({ key: '3', ctrlKey: true, altKey: true }, free)).toBeNull();
  });

  it('Enter in the search adds the top result unless Shift is held', () => {
    expect(cashierKeyOf({ key: 'Enter' }, search(false))).toEqual({ kind: 'addTop' });
    expect(cashierKeyOf({ key: 'Enter', shiftKey: true }, search(false))).toBeNull();
    expect(cashierKeyOf({ key: 'Enter' }, free)).toBeNull();
  });

  it('Escape is escape', () => {
    expect(cashierKeyOf({ key: 'Escape' }, free)).toEqual({ kind: 'escape' });
    expect(cashierKeyOf({ key: 'Escape' }, search(false))).toEqual({ kind: 'escape' });
  });

  it('line navigation and removal only outside text fields', () => {
    expect(cashierKeyOf({ key: 'ArrowUp' }, free)).toEqual({ kind: 'lineUp' });
    expect(cashierKeyOf({ key: 'ArrowDown' }, free)).toEqual({ kind: 'lineDown' });
    expect(cashierKeyOf({ key: 'Delete' }, free)).toEqual({ kind: 'remove' });
    expect(cashierKeyOf({ key: 'ArrowUp' }, search(false))).toBeNull();
    expect(cashierKeyOf({ key: 'Delete' }, cell)).toBeNull();
  });

  it('repeat, composing, keyCode 229, defaultPrevented and an open modal return null', () => {
    expect(cashierKeyOf({ key: 'F2', repeat: true }, free)).toBeNull();
    expect(cashierKeyOf({ key: 'F2', isComposing: true }, free)).toBeNull();
    expect(cashierKeyOf({ key: 'F2', keyCode: 229 }, free)).toBeNull();
    expect(cashierKeyOf({ key: 'F2', defaultPrevented: true }, free)).toBeNull();
    expect(cashierKeyOf({ key: 'Enter', defaultPrevented: true }, search(false))).toBeNull();
    expect(cashierKeyOf({ key: 'F2' }, { ...free, modalOpen: true })).toBeNull();
    expect(cashierKeyOf({ key: 'Escape' }, { ...free, modalOpen: true })).toBeNull();
  });

  it('unknown keys are null', () => {
    expect(cashierKeyOf({ key: 'a' }, free)).toBeNull();
    expect(cashierKeyOf({ key: 'F5' }, free)).toBeNull();
  });
});
