import { describe, expect, it } from 'vitest';
import { costOfBaseQty } from '@/server/domain/pharmacy/stock';
import {
  addDays,
  baghdadDay,
  baghdadWindow,
  bpOf,
  consolidate,
  marginBp,
  REPORT_MAX_DAYS,
  ReportsError,
  valuedUnits,
} from '@/server/domain/pharmacy/reports-domain';

/** The pure rules behind the pharmacy reports (phase 6, task 4): Baghdad days, range limits, margin maths, valuation, consolidation. */

describe('Baghdad days', () => {
  it('puts 21:30 UTC on the next Baghdad day and 20:59:59 UTC on the same one', () => {
    expect(baghdadDay(new Date('2026-10-31T21:30:00.000Z'))).toBe('2026-11-01');
    expect(baghdadDay(new Date('2026-10-31T20:59:59.999Z'))).toBe('2026-10-31');
    expect(baghdadDay(new Date('2026-10-31T21:00:00.000Z'))).toBe('2026-11-01');
    expect(baghdadDay(new Date('2026-12-31T21:00:00.000Z'))).toBe('2027-01-01');
  });

  it('adds days across month ends and leap days', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('the report window', () => {
  it('is the Baghdad days from..to inclusive, as instants', () => {
    const w = baghdadWindow('2026-11-01', '2026-11-01');
    expect(w.start.toISOString()).toBe('2026-10-31T21:00:00.000Z');
    expect(w.endExclusive.toISOString()).toBe('2026-11-01T21:00:00.000Z');
    expect(w.days).toBe(1);
    expect(baghdadWindow('2026-10-01', '2026-10-31').days).toBe(31);
  });

  it('allows 366 days and refuses 367, and refuses from after to or a date that is not one', () => {
    expect(REPORT_MAX_DAYS).toBe(366);
    expect(baghdadWindow('2028-01-01', '2028-12-31').days).toBe(366);
    const long = () => baghdadWindow('2027-01-01', '2028-01-02');
    expect(long).toThrow(ReportsError);
    expect(() => baghdadWindow('2026-11-02', '2026-11-01')).toThrow(/after/);
    expect(() => baghdadWindow('2026-02-30', '2026-03-01')).toThrow(ReportsError);
    expect(() => baghdadWindow('nope', '2026-03-01')).toThrow(ReportsError);
    try {
      long();
    } catch (e) {
      expect((e as ReportsError).code).toBe('RANGE_TOO_LONG');
    }
  });
});

describe('basis points', () => {
  it('rounds half up, with big integers only', () => {
    expect(bpOf(1n, 3n)).toBe(3333n);
    expect(bpOf(2n, 3n)).toBe(6667n);
    expect(bpOf(1n, 8n)).toBe(1250n);
    expect(bpOf(1n, 16n)).toBe(625n);
    expect(bpOf(1n, 32n)).toBe(313n); // 312.5 rounds up
    expect(bpOf(0n, 5n)).toBe(0n);
    expect(bpOf(5n, 0n)).toBeNull();
    expect(bpOf(5n, -1n)).toBeNull();
  });

  it('margin is (net - cost) / net, estimated, negative when the cost is above the sales', () => {
    expect(marginBp(1000n, 600n)).toBe(4000n);
    expect(marginBp(1000n, 1000n)).toBe(0n);
    expect(marginBp(1000n, 1500n)).toBe(-5000n);
    expect(marginBp(3n, 2n)).toBe(3333n);
    expect(marginBp(0n, 0n)).toBeNull();
    // Half up on the negative side too: -312.5 is -312 (toward plus infinity), -312.6 is -313
    expect(marginBp(32n, 33n)).toBe(-312n);
    expect(marginBp(1000n, 1003n)).toBe(-30n); // -30 exactly
    expect(bpOf(-1n, 32n)).toBe(-312n);
    expect(bpOf(-3n, 64n)).toBe(-469n); // -468.75
    expect(marginBp(10n ** 18n, 4n * 10n ** 17n)).toBe(6000n);
  });
});

describe('valuation', () => {
  it('values available, reserved and quarantine, and keeps damaged out', () => {
    expect(valuedUnits({ available: 10, reserved: 2, quarantine: 3, damaged: 7 })).toBe(15);
  });

  it('uses the one cost rule the sale snapshot uses: floor of cost x units / per', () => {
    expect(costOfBaseQty(705n, 3, 10)).toBe(211n);
    expect(costOfBaseQty(705n, 10, 10)).toBe(705n);
  });
});

describe('consolidation', () => {
  it('sums per-branch totals by currency without ever mixing currencies', () => {
    const total = consolidate([
      { branchId: 'a', currency: 'IQD', values: { net: 100n, count: 2n } },
      { branchId: 'b', currency: 'IQD', values: { net: 250n, count: 3n } },
      { branchId: 'a', currency: 'USD', values: { net: 7n, count: 1n } },
    ]);
    expect(total).toEqual([
      { currency: 'IQD', values: { net: 350n, count: 5n } },
      { currency: 'USD', values: { net: 7n, count: 1n } },
    ]);
  });
});

describe('a date that matches the pattern and is not a date', () => {
  it('is refused as a bad date, never an exception from the Date object', () => {
    for (const bad of ['2026-13-45', '2026-00-10', '2026-02-30', '0000-00-00']) {
      expect(() => baghdadWindow(bad, '2026-12-31'), bad).toThrow(ReportsError);
      expect(() => baghdadWindow('2026-01-01', bad), bad).toThrow(ReportsError);
    }
  });
});
