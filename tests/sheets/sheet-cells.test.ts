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

describe('escaping the lookalike and padded starts of a formula (report 5b)', () => {
  it.each([['＝'], ['＋'], ['－'], ['＠']])('writes a cell starting with the full-width %j as text and reads it back', (lead) => {
    const cell = `${lead}SUM(A1)`;
    expect(escapeCell(cell)).toBe(`'${cell}`);
    expect(unescapeCell(escapeCell(cell))).toBe(cell);
  });

  const PADS = [' ', '  ', ' ', '　', '\n', '\t ', ' \n'];
  const FORMULAS = ['=', '+', '-', '@', '＝'];
  it.each(PADS.flatMap((pad) => FORMULAS.map((formula) => [pad, formula] as const)))('writes a cell with %j in front of %j as text', (pad, formula) => {
    const cell = `${pad}${formula}cmd`;
    expect(escapeCell(cell)).toBe(`'${cell}`);
    expect(unescapeCell(escapeCell(cell))).toBe(cell);
  });

  it('writes a cell that starts with a line feed as text', () => {
    expect(escapeCell('\nabc')).toBe("'\nabc");
    expect(unescapeCell(escapeCell('\nabc'))).toBe('\nabc');
  });

  it('leaves ordinary text, padded ordinary text and a formula character later in the cell alone', () => {
    for (const cell of ['Panadol', ' Panadol', ' Panadol', 'a=b', 'x -5', '', "'quoted", ' 5 mg', 'Ｗide']) {
      expect(escapeCell(cell)).toBe(cell);
    }
  });
});
