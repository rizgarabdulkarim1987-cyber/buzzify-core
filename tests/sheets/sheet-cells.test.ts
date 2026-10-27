import { describe, expect, it } from 'vitest';
import { escapeCell, unescapeCell } from '@/server/domain/sheet-cells';

describe('escaping a cell a spreadsheet would read as a formula', () => {
  it.each([
    ['=', '=SUM(A1:A2)'],
    ['+', '+964 750 000 0000'],
    ['-', '-5'],
    ['@', '@cmd'],
    ['a tab', '\tTab first'],
    ['a carriage return', '\rCR first'],
  ])('writes a cell starting with %s as text and reads it back unchanged', (_, cell) => {
    expect(escapeCell(cell)).toBe(`'${cell}`);
    expect(unescapeCell(escapeCell(cell))).toBe(cell);
  });

  it('leaves every other cell as it is, including one that starts with an apostrophe of its own', () => {
    for (const cell of ['Panadol', '', "'quoted", '12', 'a=b']) {
      expect(escapeCell(cell)).toBe(cell);
      expect(unescapeCell(cell)).toBe(cell);
    }
  });

  it('strips one apostrophe only', () => {
    expect(unescapeCell("''=x")).toBe("''=x");
    expect(unescapeCell("'=x")).toBe('=x');
  });
});
