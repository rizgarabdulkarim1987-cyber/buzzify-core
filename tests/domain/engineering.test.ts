import { describe, expect, it } from 'vitest';
import { classifyDishes } from '@/server/domain/engineering';

const row = (productId: string, cost: number | null, sessions: number, price = 1000) => ({ productId, price, cost, sessions });

describe('classifyDishes', () => {
  it('puts popular, profitable dishes first and splits four dishes into one of each class', () => {
    const result = classifyDishes([row('dog', 800, 5), row('puzzle', 200, 5), row('plowhorse', 800, 40), row('star', 200, 40)]);
    expect(result.map((d) => [d.productId, d.dishClass])).toEqual([
      ['star', 'STAR'],
      ['plowhorse', 'PLOWHORSE'],
      ['puzzle', 'PUZZLE'],
      ['dog', 'DOG'],
    ]);
    expect(result[0]).toEqual({ productId: 'star', sessions: 40, price: 1000, cost: 200, margin: 800, dishClass: 'STAR' });
  });

  it('leaves a dish without a cost as NEEDS_COST, outside the average margin', () => {
    const result = classifyDishes([row('star', 200, 40), row('plowhorse', 800, 40), row('puzzle', 200, 5), row('dog', 800, 5), row('unknown', null, 100)]);
    expect(Object.fromEntries(result.map((d) => [d.productId, d.dishClass]))).toEqual({
      star: 'STAR',
      plowhorse: 'PLOWHORSE',
      puzzle: 'PUZZLE',
      dog: 'DOG',
      unknown: 'NEEDS_COST',
    });
    expect(result.at(-1)).toMatchObject({ productId: 'unknown', margin: null });
  });

  it('with no guest sessions at all, nobody is popular: costed dishes split by margin alone', () => {
    const result = classifyDishes([row('rich', 200, 0), row('thin', 800, 0)]);
    expect(result.map((d) => [d.productId, d.dishClass])).toEqual([
      ['rich', 'PUZZLE'],
      ['thin', 'DOG'],
    ]);
  });

  it('a dish is popular at 70% of an equal share', () => {
    // Ten dishes: an equal share is 10%, so 7% is popular and 6% is not.
    const rows = [row('at', 200, 7), row('below', 200, 6), ...Array.from({ length: 8 }, (_, i) => row(`d${i}`, 200, 87 / 8))];
    const classes = Object.fromEntries(classifyDishes(rows).map((d) => [d.productId, d.dishClass]));
    expect(classes.at).toBe('STAR');
    expect(classes.below).toBe('PUZZLE');
  });

  it('returns nothing for no dishes', () => {
    expect(classifyDishes([])).toEqual([]);
  });
});
