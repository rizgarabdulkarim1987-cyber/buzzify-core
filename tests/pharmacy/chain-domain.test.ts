import { describe, expect, it } from 'vitest';
import { dashboardWindow, rankByNet } from '@/server/domain/pharmacy/chain-domain';
import { bpText, decimalText, exportCells, exportFileName, num } from '@/server/domain/pharmacy/export-sheet';

describe('the dashboard window', () => {
  it('is the last 30 Baghdad days ending today (the instant is read in Baghdad time)', () => {
    // 22:30 UTC on the 27th is 01:30 on the 28th in Baghdad.
    expect(dashboardWindow(new Date('2026-10-27T22:30:00.000Z'))).toEqual({ from: '2026-09-29', to: '2026-10-28' });
    expect(dashboardWindow(new Date('2026-10-27T09:00:00.000Z'))).toEqual({ from: '2026-09-28', to: '2026-10-27' });
  });
  it('crosses a year end and a leap day', () => {
    expect(dashboardWindow(new Date('2028-03-05T09:00:00.000Z'))).toEqual({ from: '2028-02-05', to: '2028-03-05' });
    expect(dashboardWindow(new Date('2027-01-10T09:00:00.000Z'))).toEqual({ from: '2026-12-12', to: '2027-01-10' });
  });
});

describe('rank by net sales', () => {
  it('ranks the highest first, ties share a rank and the next rank is skipped', () => {
    const rows = [
      { key: 'b', net: 500n },
      { key: 'a', net: 900n },
      { key: 'c', net: 500n },
      { key: 'd', net: -10n },
    ];
    expect(rankByNet(rows)).toEqual([
      { key: 'a', net: 900n, rank: 1 },
      { key: 'b', net: 500n, rank: 2 },
      { key: 'c', net: 500n, rank: 2 },
      { key: 'd', net: -10n, rank: 4 },
    ]);
  });
  it('is empty for no rows', () => expect(rankByNet([])).toEqual([]));
});

describe('export numbers and cells', () => {
  it('writes money as exact decimal text in major units', () => {
    expect(decimalText(150_000n, 'IQD')).toBe('150000');
    expect(decimalText(1250n, 'USD')).toBe('12.50');
    expect(decimalText(5n, 'USD')).toBe('0.05');
    expect(decimalText(0n, 'USD')).toBe('0.00');
    expect(decimalText(-5n, 'USD')).toBe('-0.05');
    expect(decimalText(-123456n, 'USD')).toBe('-1234.56');
    expect(decimalText(9_007_199_254_740_993_123n, 'USD')).toBe('90071992547409931.23');
  });
  it('writes basis points as percent with two decimals, exactly', () => {
    expect(bpText(1234)).toBe('12.34');
    expect(bpText(5)).toBe('0.05');
    expect(bpText(-5)).toBe('-0.05');
    expect(bpText(10000)).toBe('100.00');
    expect(bpText(null)).toBe('');
  });
  it('refuses a number cell that is not a number', () => {
    expect(() => num('=1+1')).toThrow();
    expect(() => num('1e3')).toThrow();
    expect(num('-12.50').n).toBe('-12.50');
  });
  it('escapes every text cell that a spreadsheet would read as a formula, and no number', () => {
    const out = exportCells([['=SUM(A1)', '+1', '-1', '@x', '\tx', '\rx', 'plain', num('-12.50'), 'ok']]);
    expect(out).toEqual([["'=SUM(A1)", "'+1", "'-1", "'@x", "'\tx", "'\rx", 'plain', '-12.50', 'ok']]);
  });
});

describe('the file name', () => {
  it('carries the report and the range, nothing else', () => {
    expect(exportFileName('sales', { from: '2026-10-01', to: '2026-10-31' }, 'csv')).toBe('pharmacy-sales-2026-10-01_2026-10-31.csv');
    expect(exportFileName('lowStock', { on: '2026-10-27' }, 'xlsx')).toBe('pharmacy-lowStock-2026-10-27.xlsx');
  });
});
