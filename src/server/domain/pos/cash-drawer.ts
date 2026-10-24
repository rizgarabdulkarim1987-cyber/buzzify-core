function assertInt(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be an integer IQD amount`);
}

function sum(values: number[], name: string): number {
  let total = 0;
  for (const v of values) {
    assertInt(v, name);
    total += v;
  }
  return total;
}

/**
 * Cash that should be in the drawer: opening float plus cash sales minus expenses minus the cash handed back by
 * reversals recorded in the shift. May be negative; never clamped.
 */
export function expectedCash(input: { openingFloat: number; cashSales: number[]; expenses: number[]; cashRefunds: number[] }): number {
  assertInt(input.openingFloat, 'openingFloat');
  return input.openingFloat + sum(input.cashSales, 'cashSales') - sum(input.expenses, 'expenses') - sum(input.cashRefunds, 'cashRefunds');
}

/** Counted minus expected: positive is a surplus, negative a shortage. */
export function cashDifference(counted: number, expected: number): number {
  assertInt(counted, 'counted');
  assertInt(expected, 'expected');
  return counted - expected;
}
