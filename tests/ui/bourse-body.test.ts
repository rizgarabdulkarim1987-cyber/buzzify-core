import { describe, expect, it } from 'vitest';
import type { MenuProductView } from '@/server/data/menu-view';
import { bourseChange, tickerProducts, tickerSeconds } from '@/ui/template/bodies/BourseBody';

const dish = (id: string, sale?: { percentOff: number; regularPrice: number }) =>
  ({ id, name: id, displayPrice: 1000, ...(sale ?? {}) }) as unknown as MenuProductView;

describe('the market page (kind bourse)', () => {
  it('shows a dish’s real discount as its change, and nothing for a dish not on sale', () => {
    expect(bourseChange({ percentOff: 20, regularPrice: 1250 })).toBe(20);
    expect(bourseChange({})).toBe(0);
    // A discount with no regular price showing (the price did not go down) is not a move.
    expect(bourseChange({ percentOff: 20 })).toBe(0);
  });

  it('runs the dishes on sale first on the tape, then the rest in menu order, capped', () => {
    const byCategory = new Map([
      ['a', [dish('a1'), dish('a2', { percentOff: 10, regularPrice: 1100 })]],
      ['b', [dish('b1', { percentOff: 25, regularPrice: 1300 }), dish('b2')]],
    ]);
    const categories = [{ id: 'a' }, { id: 'b' }];
    expect(tickerProducts(categories, byCategory).map((product) => product.id)).toEqual(['a2', 'b1', 'a1', 'b2']);
    expect(tickerProducts(categories, byCategory, 3).map((product) => product.id)).toEqual(['a2', 'b1', 'a1']);
    expect(tickerProducts([{ id: 'b' }], byCategory).map((product) => product.id)).toEqual(['b1', 'b2']);
    expect(tickerProducts([], byCategory)).toEqual([]);
  });

  it('gives the tape time to read every name', () => {
    expect(tickerSeconds(2)).toBe(20);
    expect(tickerSeconds(10)).toBe(35);
  });
});
