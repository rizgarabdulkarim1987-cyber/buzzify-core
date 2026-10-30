import { describe, expect, it } from 'vitest';
import {
  bpPercent,
  chainHref,
  exportParams,
  filterMessageKey,
  formatMinor,
  LONG_RANGE_DAYS,
  marginNotices,
  parseChainFilters,
  parseFilters,
  PRESETS,
  presetRange,
  rangeDays,
  REPORT_SPECS,
  reportHref,
  specOf,
  specOfSlug,
  transfersNotices,
  valuationNotices,
  visibleReports,
} from '@/app/pharmacy/_ui/reports-logic';
import { MARGIN_GROUPS, SALES_GROUPS } from '@/server/pharmacy/reports-inputs';
import { VALUATION_GROUPS } from '@/server/pharmacy/reports-stock';
import { TRANSFER_STATUSES } from '@/server/pharmacy/reports-ledger';
import { EXPORT_REPORTS } from '@/server/pharmacy/report-exports';
import { baghdadWindow, REPORT_MAX_DAYS } from '@/server/domain/pharmacy/reports-domain';

// 2026-11-03 21:30 UTC is already 2026-11-04 00:30 in Baghdad (UTC+3): the day turns three hours before UTC's.
const NOW = new Date('2026-11-03T21:30:00.000Z');
const BRANCHES = ['b1', 'b2'];
const ctx = { now: NOW, branchIds: BRANCHES };
const sales = specOf('sales');

describe('presets follow the server rules (inclusive Baghdad days, at most 366)', () => {
  const table: Array<[(typeof PRESETS)[number], string, string]> = [
    ['today', '2026-11-04', '2026-11-04'],
    ['yesterday', '2026-11-03', '2026-11-03'],
    ['thisMonth', '2026-11-01', '2026-11-04'],
    ['lastMonth', '2026-10-01', '2026-10-31'],
    ['last30', '2026-10-06', '2026-11-04'],
  ];
  for (const [preset, from, to] of table) {
    it(`${preset}: ${from}..${to}`, () => {
      expect(presetRange(preset, NOW)).toEqual({ from, to });
      // The server accepts it, and counts the same number of days.
      const w = baghdadWindow(from, to);
      expect(rangeDays(from, to)).toBe(w.days);
      expect(w.days).toBeLessThanOrEqual(REPORT_MAX_DAYS);
    });
  }
  it('last 30 days is 30 inclusive days, today included', () => {
    const r = presetRange('last30', NOW);
    expect(rangeDays(r.from, r.to)).toBe(30);
  });
  it('last month across a year boundary and a leap February', () => {
    expect(presetRange('lastMonth', new Date('2027-01-15T09:00:00Z'))).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(presetRange('lastMonth', new Date('2028-03-02T09:00:00Z'))).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
  it('every preset is valid on every day of a leap year', () => {
    for (let d = 0; d < 366; d += 1) {
      const now = new Date(Date.UTC(2028, 0, 1, 12) + d * 86_400_000);
      for (const p of PRESETS) {
        const r = presetRange(p, now);
        expect(() => baghdadWindow(r.from, r.to)).not.toThrow();
      }
    }
  });
});

describe('parseFilters', () => {
  it('defaults to the last 30 days, all branches, the default grouping', () => {
    const { filters, problems } = parseFilters(sales, {}, ctx);
    expect(problems).toEqual([]);
    expect(filters).toMatchObject({ from: '2026-10-06', to: '2026-11-04', branchId: null, currency: null, groupBy: 'day', pages: 1 });
  });
  it('reads a full query', () => {
    const { filters, problems } = parseFilters(sales, { from: '2026-01-01', to: '2026-01-31', branch: 'b2', currency: 'USD', group: 'product', pages: '3' }, ctx);
    expect(problems).toEqual([]);
    expect(filters).toMatchObject({ from: '2026-01-01', to: '2026-01-31', branchId: 'b2', currency: 'USD', groupBy: 'product', pages: 3 });
  });
  it('366 days is the longest range; 367 is refused on the end date', () => {
    expect(parseFilters(sales, { from: '2026-01-01', to: '2027-01-01' }, ctx).problems).toEqual([]);
    expect(parseFilters(sales, { from: '2026-01-01', to: '2027-01-02' }, ctx).problems).toEqual([{ field: 'to', code: 'tooLong' }]);
    expect(() => baghdadWindow('2026-01-01', '2027-01-02')).toThrow();
  });
  it('bad and reversed dates name the field', () => {
    expect(parseFilters(sales, { from: '2026-13-45', to: '2026-01-31' }, ctx).problems).toEqual([{ field: 'from', code: 'badDate' }]);
    expect(parseFilters(sales, { from: '2026-01-01', to: 'tomorrow' }, ctx).problems).toEqual([{ field: 'to', code: 'badDate' }]);
    expect(parseFilters(sales, { from: '2026-02-01', to: '2026-01-31' }, ctx).problems).toEqual([{ field: 'from', code: 'fromAfterTo' }]);
  });
  it('keeps what was typed so the form can show it', () => {
    expect(parseFilters(sales, { from: 'abc', to: '2026-01-31' }, ctx).filters.from).toBe('abc');
  });
  it('a branch that is not the person is refused, not used', () => {
    const r = parseFilters(sales, { branch: 'someone-elses' }, ctx);
    expect(r.problems).toEqual([{ field: 'branch', code: 'foreignBranch' }]);
    expect(r.filters.branchId).toBeNull();
  });
  it('an unknown grouping, currency or status is a problem', () => {
    expect(parseFilters(sales, { group: 'moon' }, ctx).problems).toEqual([{ field: 'groupBy', code: 'badChoice' }]);
    expect(parseFilters(sales, { currency: 'EUR' }, ctx).problems).toEqual([{ field: 'currency', code: 'badChoice' }]);
    expect(parseFilters(specOf('transfers'), { status: 'LOST' }, ctx).problems).toEqual([{ field: 'status', code: 'badChoice' }]);
  });
  it('first value of a repeated parameter; pages capped', () => {
    expect(parseFilters(sales, { group: ['branch', 'user'] }, ctx).filters.groupBy).toBe('branch');
    expect(parseFilters(sales, { pages: '999' }, ctx).filters.pages).toBe(20);
    expect(parseFilters(sales, { pages: 'x' }, ctx).filters.pages).toBe(1);
  });
  it('an as-of-today report has no dates and ignores them', () => {
    const r = parseFilters(specOf('expiry'), { from: 'junk', to: 'junk', currency: 'USD' }, ctx);
    expect(r.problems).toEqual([]);
    expect(r.filters.currency).toBeNull();
  });
  it('a stored branch is accepted only from the allowed list', () => {
    expect(parseFilters(sales, { branch: 'b1' }, { now: NOW, branchIds: ['b1'] }).problems).toEqual([]);
    expect(parseFilters(sales, { branch: 'b2' }, { now: NOW, branchIds: ['b1'] }).problems).toEqual([{ field: 'branch', code: 'foreignBranch' }]);
  });
  it('every problem has a message key', () => {
    expect(filterMessageKey({ field: 'to', code: 'tooLong' })).toBe('pharmacy.reports.filter.problem.tooLong');
  });
});

describe('url round trip', () => {
  it('serialising then parsing gives the same filters, for every report', () => {
    for (const spec of REPORT_SPECS) {
      const first = parseFilters(spec, { from: '2026-02-01', to: '2026-02-28', branch: 'b1', currency: 'IQD', ...(spec.groups ? { group: spec.groups[spec.groups.length - 1] } : {}), ...(spec.statuses ? { status: spec.statuses[0] } : {}), pages: '2' }, ctx);
      expect(first.problems).toEqual([]);
      const href = reportHref(spec, first.filters);
      const query = Object.fromEntries(new URL(href, 'http://x').searchParams);
      expect(parseFilters(spec, query, ctx).filters).toEqual(first.filters);
      expect(href.startsWith(`/pharmacy/reports/${spec.slug}`)).toBe(true);
    }
  });
  it('the defaults are not carried in the address except the dates', () => {
    const { filters } = parseFilters(sales, {}, ctx);
    const q = new URL(reportHref(sales, filters), 'http://x').searchParams;
    expect([...q.keys()].sort()).toEqual(['from', 'to']);
  });
  it('changing a filter goes back to the first page', () => {
    const { filters } = parseFilters(sales, { pages: '4' }, ctx);
    expect(reportHref(sales, filters, { group: 'branch' })).not.toContain('pages=');
    expect(reportHref(sales, filters, { pages: '5' })).toContain('pages=5');
  });
});

describe('report registry', () => {
  it('groups match the server', () => {
    expect([...specOf('sales').groups!]).toEqual([...SALES_GROUPS]);
    expect([...specOf('margin').groups!]).toEqual([...MARGIN_GROUPS]);
    expect([...specOf('stockValuation').groups!]).toEqual([...VALUATION_GROUPS]);
    expect([...specOf('transfers').statuses!]).toEqual([...TRANSFER_STATUSES]);
  });
  it('every report has an export name the server knows', () => {
    for (const spec of REPORT_SPECS) expect(EXPORT_REPORTS).toContain(spec.id);
    expect(EXPORT_REPORTS).toContain('chain');
  });
  it('slugs are unique and found again', () => {
    expect(new Set(REPORT_SPECS.map((s) => s.slug)).size).toBe(REPORT_SPECS.length);
    for (const spec of REPORT_SPECS) expect(specOfSlug(spec.slug)).toBe(spec);
    expect(specOfSlug('nope')).toBeNull();
  });
  it('margin is listed only with both margin permissions', () => {
    expect(visibleReports({ profit: true, cost: true }).map((s) => s.id)).toContain('margin');
    expect(visibleReports({ profit: true, cost: false }).map((s) => s.id)).not.toContain('margin');
    expect(visibleReports({ profit: false, cost: true }).map((s) => s.id)).not.toContain('margin');
    expect(visibleReports({ profit: false, cost: false })).toHaveLength(8);
  });
});

describe('export parameters carry the same filters as the screen', () => {
  it('maps the screen filters onto the server input', () => {
    const { filters } = parseFilters(sales, { from: '2026-02-01', to: '2026-02-28', currency: 'USD', group: 'user', branch: 'b2' }, ctx);
    expect(exportParams(sales, filters, 'xlsx')).toEqual({ report: 'sales', format: 'xlsx', from: '2026-02-01', to: '2026-02-28', groupBy: 'user', currency: 'USD', branch: 'b2' });
  });
  it('leaves out what the report does not have', () => {
    const { filters } = parseFilters(specOf('expiry'), { branch: 'b1' }, ctx);
    expect(exportParams(specOf('expiry'), filters, 'csv')).toEqual({ report: 'expiry', format: 'csv', branch: 'b1' });
  });
  it('the transfers status travels', () => {
    const { filters } = parseFilters(specOf('transfers'), { status: 'SENT', from: '2026-02-01', to: '2026-02-02' }, ctx);
    expect(exportParams(specOf('transfers'), filters, 'csv')).toMatchObject({ report: 'transfers', status: 'SENT' });
  });
});

describe('chain filters', () => {
  it('default to the last 30 days', () => {
    expect(parseChainFilters({}, NOW)).toEqual({ filters: { from: '2026-10-06', to: '2026-11-04', currency: null }, problems: [] });
  });
  it('refuse a bad or too long range', () => {
    expect(parseChainFilters({ from: '2026-01-01', to: '2027-01-02' }, NOW).problems).toEqual([{ field: 'to', code: 'tooLong' }]);
    expect(parseChainFilters({ from: 'x' }, NOW).problems[0]).toEqual({ field: 'from', code: 'badDate' });
  });
  it('the address round trips', () => {
    const { filters } = parseChainFilters({ from: '2026-02-01', to: '2026-02-28', currency: 'IQD' }, NOW);
    const q = Object.fromEntries(new URL(chainHref(filters), 'http://x').searchParams);
    expect(parseChainFilters(q, NOW).filters).toEqual(filters);
  });
});

describe('long ranges', () => {
  it('over 90 days earns the hint, exactly 90 does not', () => {
    expect(LONG_RANGE_DAYS).toBe(90);
    expect(rangeDays('2026-01-01', '2026-03-31')).toBe(90);
    expect(rangeDays('2026-01-01', '2026-04-01')).toBe(91);
  });
});

describe('formatMinor (exact from strings, per currency exponent)', () => {
  it('IQD has no decimals, USD has two', () => {
    expect(formatMinor('1234567', 'IQD')).toBe('1,234,567 IQD');
    expect(formatMinor('1234567', 'USD')).toBe('12,345.67 USD');
    expect(formatMinor('5', 'USD')).toBe('0.05 USD');
    expect(formatMinor('0', 'IQD')).toBe('0 IQD');
  });
  it('is exact beyond 2^53 (no float)', () => {
    expect(formatMinor('9007199254740993', 'IQD')).toBe('9,007,199,254,740,993 IQD');
    expect(formatMinor('900719925474099301', 'USD')).toBe('9,007,199,254,740,993.01 USD');
  });
  it('negative amounts keep the sign in front', () => {
    expect(formatMinor('-1500', 'IQD')).toBe('-1,500 IQD');
    expect(formatMinor('-5', 'USD')).toBe('-0.05 USD');
  });
  it('accepts a bigint', () => {
    expect(formatMinor(250n, 'USD')).toBe('2.50 USD');
  });
});

describe('bpPercent', () => {
  it('writes basis points as a percent exactly', () => {
    expect(bpPercent(1234)).toBe('12.34%');
    expect(bpPercent(5)).toBe('0.05%');
    expect(bpPercent(-250)).toBe('-2.50%');
    expect(bpPercent(null)).toBeNull();
  });
});

describe('notices come from the report fields', () => {
  const margin = (over: Record<string, unknown>) => ({ incompleteCostRows: 0, mixedCurrencyRows: 0, excluded: [], ...over }) as never;
  it('margin is always estimated; left-out lines are named with counts', () => {
    expect(marginNotices(margin({})).map((n) => n.key)).toEqual(['margin.estimated']);
    const n = marginNotices(margin({ incompleteCostRows: 3, mixedCurrencyRows: 2 }));
    expect(n).toContainEqual({ key: 'margin.costMissing', tone: 'warn', count: 3 });
    expect(n).toContainEqual({ key: 'margin.otherCurrency', tone: 'warn', count: 2 });
  });
  it('valuation warns only when incomplete', () => {
    expect(valuationNotices({ totals: { valuationComplete: true, noCostRows: 0 } } as never).map((n) => n.key)).toEqual(['valuation.reserved']);
    expect(valuationNotices({ totals: { valuationComplete: false, noCostRows: 4 } } as never)).toContainEqual({ key: 'valuation.incomplete', tone: 'warn', count: 4 });
    // Without cost.view the keys are absent: no claim either way.
    expect(valuationNotices({ totals: {} } as never).map((n) => n.key)).toEqual(['valuation.reserved']);
  });
  it('transfers always carry the scope note', () => {
    expect(transfersNotices({ scope: 'transfers-touching-the-branches-shown' } as never).map((n) => n.key)).toEqual(['transfers.scope']);
  });
});
