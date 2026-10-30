import { describe, expect, it } from 'vitest';
import { evenGroups, partTotalOf, toggleLine, unpaidLineIds } from '@/lib/pos-split';

const line = (id: string, lineTotal: number, extra: Partial<{ paid: boolean; cancelled: boolean }> = {}) => ({ id, lineTotal, paid: false, cancelled: false, ...extra });
const none = { invoiceDiscount: 0, service: 0, tax: 0, deliveryFee: 0 };

describe('split bill model', () => {
  const lines = [line('a', 6000), line('b', 5000), line('c', 4000), line('d', 3000), line('p', 9000, { paid: true }), line('x', 2000, { cancelled: true })];

  it('offers only live lines that are not paid yet', () => {
    expect(unpaidLineIds(lines)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('toggles a line in and out of the selection', () => {
    expect(toggleLine([], 'a')).toEqual(['a']);
    expect(toggleLine(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('proposes groups of lines as close as possible in value', () => {
    const groups = evenGroups(lines, 2);
    expect(groups).toHaveLength(2);
    const value = (ids: string[]) => ids.reduce((sum, id) => sum + lines.find((l) => l.id === id)!.lineTotal, 0);
    expect(groups.flat().sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(Math.abs(value(groups[0]!) - value(groups[1]!))).toBeLessThanOrEqual(2000);
  });

  it('never makes an empty group while there are lines to give', () => {
    expect(evenGroups([line('a', 100), line('b', 100)], 4).every((g) => g.length > 0)).toBe(true);
  });

  it('prices the selection with its share of the discount, service and tax', () => {
    const full = { subtotal: 15000, invoiceDiscount: 1500, service: 1350, tax: 743, deliveryFee: 0, total: 15593 };
    const three = [line('a', 5000), line('b', 5000), line('c', 5000)];
    expect(partTotalOf(full, none, three, ['a'])).toBe(5000 - 500 + 450 + 248);
    expect(partTotalOf(full, none, three, ['a', 'b', 'c'])).toBe(15593);
    expect(partTotalOf(full, none, three, [])).toBe(0);
  });
});
