import { describe, expect, it } from 'vitest';
import { groupByUrgency, urgencyGroup, urgencyTone } from '@/app/pharmacy/_ui/expiry-groups';
import { expiryBand, urgencyDays, type ExpiryPrecision } from '@/server/domain/pharmacy/expiry';

const b = (daysLeft: number, id = String(daysLeft)) => ({ id, daysLeft });
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe('groupByUrgency', () => {
  it('puts each batch in its group at the boundaries and drops what is more than 90 days away', () => {
    const groups = groupByUrgency([b(-1), b(0), b(30), b(31), b(60), b(61), b(90), b(91), b(400)]);
    expect(ids(groups.expired)).toEqual(['-1']);
    expect(ids(groups.d30)).toEqual(['0', '30']);
    expect(ids(groups.d60)).toEqual(['31', '60']);
    expect(ids(groups.d90)).toEqual(['61', '90']);
  });

  it('sorts each group by days left, soonest first, keeping the order of equal days', () => {
    const groups = groupByUrgency([b(20, 'a'), b(-3, 'x'), b(5, 'b'), b(-40, 'y'), b(20, 'c'), b(75, 'd'), b(62, 'e')]);
    expect(ids(groups.expired)).toEqual(['y', 'x']);
    expect(ids(groups.d30)).toEqual(['b', 'a', 'c']);
    expect(ids(groups.d90)).toEqual(['e', 'd']);
  });

  it('gives four empty groups for no batches', () => {
    expect(groupByUrgency([])).toEqual({ expired: [], d30: [], d60: [], d90: [] });
  });
});

describe('the days a batch is alerted by', () => {
  it('is the days to the expiry date for a DAY-precision batch', () => {
    expect(urgencyDays({ expiryDate: '2026-11-15', expiryPrecision: 'DAY' }, '2026-10-27')).toBe(19);
    expect(urgencyDays({ expiryDate: '2026-10-27', expiryPrecision: 'DAY' }, '2026-10-27')).toBe(0);
    expect(urgencyDays({ expiryDate: '2026-10-26', expiryPrecision: 'DAY' }, '2026-10-27')).toBe(-1);
  });

  it('counts a MONTH-precision batch from the start of its month, never below 0 while it may still be sold', () => {
    const march = { expiryDate: '2027-03-31', expiryPrecision: 'MONTH' as const };
    expect(urgencyDays(march, '2027-01-25')).toBe(35);
    expect(urgencyDays(march, '2027-03-01')).toBe(0);
    expect(urgencyDays(march, '2027-03-31')).toBe(0);
    expect(urgencyDays(march, '2027-04-01')).toBe(-1);
  });

  it('puts every batch in the same group as its alert band, so the Expiry screen, Home and the nav counter agree', () => {
    const start = Date.UTC(2026, 9, 1);
    for (const [expiryDate, expiryPrecision] of [
      ['2027-01-31', 'MONTH'],
      ['2027-02-28', 'MONTH'],
      ['2026-12-15', 'DAY'],
    ] as Array<[string, ExpiryPrecision]>) {
      for (let i = 0; i < 200; i++) {
        const today = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
        const batch = { expiryDate, expiryPrecision };
        const band = expiryBand(batch, today);
        const want = band === 'd180' || band === 'ok' ? null : band;
        expect(urgencyGroup(urgencyDays(batch, today)), `${expiryDate} ${expiryPrecision} on ${today}`).toBe(want);
      }
    }
  });
});

describe('the colour of an urgency', () => {
  it('is red for expired and 30 days, amber for 60, blue for 90', () => {
    expect([-5, 0, 30, 31, 60, 61, 90].map(urgencyTone)).toEqual(['red', 'red', 'red', 'amber', 'amber', 'blue', 'blue']);
  });
});
