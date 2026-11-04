import { describe, expect, it } from 'vitest';
import { average, chartPaths, firstNameOf, greetingOf, periodOf, trendOf } from '@/app/pharmacy/_ui/home-logic';
import { mixAttention } from '@/server/domain/pharmacy/home';

describe('trendOf', () => {
  it('is up, down or flat against yesterday, in whole percent', () => {
    expect(trendOf(120, 100)).toEqual({ pct: 20, direction: 'up' });
    expect(trendOf(80, 100)).toEqual({ pct: 20, direction: 'down' });
    expect(trendOf(100, 100)).toEqual({ pct: 0, direction: 'flat' });
  });

  it('is null when yesterday is 0, so no chip shows (never NaN% or Infinity%)', () => {
    expect(trendOf(5, 0)).toBeNull();
    expect(trendOf(0, 0)).toBeNull();
  });

  it('rounds, and a change that rounds to 0% is flat', () => {
    expect(trendOf(1001, 1000)).toEqual({ pct: 0, direction: 'flat' });
    expect(trendOf(1, 3)).toEqual({ pct: 67, direction: 'down' });
    expect(trendOf(0, 100)).toEqual({ pct: 100, direction: 'down' });
  });
});

describe('average', () => {
  it('is 0 when there is nothing to divide by', () => {
    expect(average(0, 0)).toBe(0);
    expect(average(500, 0)).toBe(0);
  });

  it('rounds to a whole minor unit', () => {
    expect(average(1000, 3)).toBe(333);
    expect(average(1000, 4)).toBe(250);
  });
});

describe('periodOf', () => {
  it('reads 7d, 30d and 12m and falls back to 7d', () => {
    expect(periodOf('30d')).toBe('30d');
    expect(periodOf('12m')).toBe('12m');
    expect(periodOf('7d')).toBe('7d');
    expect(periodOf(undefined)).toBe('7d');
    expect(periodOf(['12m', '30d'])).toBe('12m');
    expect(periodOf('year')).toBe('7d');
  });
});

describe('greetingOf', () => {
  it('follows the hour in Baghdad (UTC+3)', () => {
    expect(greetingOf(new Date('2026-11-04T03:00:00.000Z'))).toBe('morning'); // 06:00
    expect(greetingOf(new Date('2026-11-04T09:00:00.000Z'))).toBe('afternoon'); // 12:00
    expect(greetingOf(new Date('2026-11-04T14:00:00.000Z'))).toBe('evening'); // 17:00
    expect(greetingOf(new Date('2026-11-04T22:30:00.000Z'))).toBe('evening'); // 01:30
  });
});

describe('firstNameOf', () => {
  it('is the first word of the name', () => {
    expect(firstNameOf('Sara Ahmed')).toBe('Sara');
    expect(firstNameOf('  سارة   أحمد ')).toBe('سارة');
    expect(firstNameOf('')).toBe('');
  });
});

describe('chartPaths', () => {
  it('is null when every total is 0 (the empty state)', () => {
    expect(chartPaths([0, 0, 0], 400, 150)).toBeNull();
    expect(chartPaths([], 400, 150)).toBeNull();
  });

  it('spans the width, puts the peak near the top and 0 at the bottom, with no NaN', () => {
    const paths = chartPaths([0, 50, 100], 400, 150)!;
    expect(paths.line).toBe('M0,150 L200,82.5 L400,15');
    expect(paths.area).toBe('M0,150 L200,82.5 L400,15 L400,150 L0,150 Z');
    expect(paths.last).toEqual({ x: 400, y: 15 });
  });

  it('draws one point as a flat line across', () => {
    const paths = chartPaths([10], 400, 150)!;
    expect(paths.line).toBe('M0,15 L400,15');
    expect(paths.line).not.toMatch(/NaN|Infinity/);
  });
});

describe('mixAttention', () => {
  const e = (n: number) => Array.from({ length: n }, (_, i) => ({ kind: 'expiry' as const, productName: `E${i}`, detail: '', days: i, qty: 1, min: null }));
  const l = (n: number) => Array.from({ length: n }, (_, i) => ({ kind: 'lowStock' as const, productName: `L${i}`, detail: '', days: null, qty: 0, min: 5 }));

  it('takes up to six, three of each, and fills from the other when one side is short', () => {
    expect(mixAttention(e(5), l(5)).map((x) => x.productName)).toEqual(['E0', 'E1', 'E2', 'L0', 'L1', 'L2']);
    expect(mixAttention(e(1), l(8)).map((x) => x.productName)).toEqual(['E0', 'L0', 'L1', 'L2', 'L3', 'L4']);
    expect(mixAttention(e(8), l(0)).map((x) => x.productName)).toEqual(['E0', 'E1', 'E2', 'E3', 'E4', 'E5']);
    expect(mixAttention([], [])).toEqual([]);
  });
});
