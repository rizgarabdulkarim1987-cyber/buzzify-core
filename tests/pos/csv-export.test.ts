import { describe, expect, it } from 'vitest';
import { breakdownCsv, toCsv } from '@/server/pos/csv-export';

describe('toCsv', () => {
  it('joins cells with commas and rows with CRLF', () => {
    expect(toCsv([['a', 1], ['b', 2]])).toBe('a,1\r\nb,2\r\n');
  });

  it('quotes cells with commas, quotes and line breaks, doubling the quotes', () => {
    expect(toCsv([['x,y', 'say "hi"', 'two\nlines']])).toBe('"x,y","say ""hi""","two\nlines"\r\n');
  });

  it('neutralises a text cell a spreadsheet would run as a formula', () => {
    for (const bad of ['=HYPERLINK("http://x")', '+1', '-1+1', '@SUM(A1)']) {
      const line = toCsv([[bad]]);
      expect(line.startsWith("\"'") || line.startsWith("'"), bad).toBe(true);
    }
  });

  it('leaves real numbers alone, even negative ones', () => {
    expect(toCsv([[-5000, 0, 1250]])).toBe('-5000,0,1250\r\n');
  });
});

describe('breakdownCsv', () => {
  it('writes one titled section per breakdown with a header row', () => {
    const csv = breakdownCsv({
      byHour: [{ hour: 13, orders: 2, total: 9000 }],
      byItem: [{ name: '=Burger', quantity: 3, total: 9000 }],
      byStaff: [{ userId: 'u1', name: 'Sara', orders: 2, total: 9000 }],
      byMethod: [{ method: 'CASH', orders: 2, total: 9000 }],
    });
    expect(csv).toContain('hour,orders,total\r\n13,2,9000\r\n');
    expect(csv).toContain("name,quantity,total\r\n'=Burger,3,9000\r\n");
    expect(csv).toContain('staff,orders,total\r\nSara,2,9000\r\n');
    expect(csv).toContain('method,orders,total\r\nCASH,2,9000\r\n');
  });
});
