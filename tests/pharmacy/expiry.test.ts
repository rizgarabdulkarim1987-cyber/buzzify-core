import { describe, expect, it } from 'vitest';
import { daysToExpiry, expiryBand, formatExpiry, isExpired, parseExpiry, utcToday } from '@/server/domain/pharmacy/expiry';

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const day = (expiryDate: string) => ({ expiryDate, expiryPrecision: 'DAY' as const });

describe('parseExpiry', () => {
  it('month inputs are stored as the last day of the month', () => {
    expect(parseExpiry('03/2027')).toEqual({ date: '2027-03-31', precision: 'MONTH' });
    expect(parseExpiry('2027-04')).toEqual({ date: '2027-04-30', precision: 'MONTH' });
    expect(parseExpiry('3/2027')).toEqual({ date: '2027-03-31', precision: 'MONTH' });
  });

  it('February ends on the 28th, or the 29th in a leap year', () => {
    expect(parseExpiry('02/2027')?.date).toBe('2027-02-28');
    expect(parseExpiry('02/2028')?.date).toBe('2028-02-29');
    expect(parseExpiry('02/2100')).toBeNull();
  });

  it('every month of every year 2000-2099 ends on its real last day', () => {
    for (let y = 2000; y <= 2099; y++) {
      for (let m = 1; m <= 12; m++) {
        const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
        const mm = String(m).padStart(2, '0');
        expect(parseExpiry(`${mm}/${y}`)).toEqual({ date: `${y}-${mm}-${String(last).padStart(2, '0')}`, precision: 'MONTH' });
      }
    }
  });

  it('a full date keeps DAY precision; leap day and 31 Dec are valid, 29 Feb in a common year is not', () => {
    expect(parseExpiry('2028-02-29')).toEqual({ date: '2028-02-29', precision: 'DAY' });
    expect(parseExpiry('2027-12-31')).toEqual({ date: '2027-12-31', precision: 'DAY' });
    expect(parseExpiry('2027-02-29')).toBeNull();
    expect(parseExpiry('2027-04-31')).toBeNull();
  });

  it('accepts Arabic-Indic and Persian digits', () => {
    expect(parseExpiry('٠٣/٢٠٢٧')).toEqual({ date: '2027-03-31', precision: 'MONTH' });
    expect(parseExpiry('٢٠٢٧-٠٤')).toEqual({ date: '2027-04-30', precision: 'MONTH' });
    expect(parseExpiry('۲۰۲۸-۰۲-۲۹')).toEqual({ date: '2028-02-29', precision: 'DAY' });
    expect(parseExpiry(' 03/2027 ')?.date).toBe('2027-03-31');
  });

  it('refuses anything else', () => {
    const bad = ['', 'abc', '13/2027', '00/2027', '2027-13', '2027-00-10', '03/27', '1999-12', '2100-01', '03-2027', '2027/03', '2027-3', '31/03/2027'];
    for (const text of bad) expect(parseExpiry(text), text).toBeNull();
  });
});

describe('formatExpiry', () => {
  it('MM/YYYY for month, DD/MM/YYYY for day', () => {
    expect(formatExpiry({ expiryDate: '2027-03-31', expiryPrecision: 'MONTH' })).toBe('03/2027');
    expect(formatExpiry({ expiryDate: '2028-02-29', expiryPrecision: 'DAY' })).toBe('29/02/2028');
  });

  it('round-trips through parseExpiry', () => {
    for (const text of ['01/2026', '12/2030', '02/2028']) {
      const p = parseExpiry(text)!;
      expect(formatExpiry({ expiryDate: p.date, expiryPrecision: p.precision })).toBe(text);
    }
  });
});

describe('isExpired and daysToExpiry', () => {
  it('the expiry day is still sellable, the day after is expired', () => {
    for (const d of ['2027-12-31', '2028-02-29', '2027-03-01', '2026-10-27']) {
      expect(isExpired(day(d), d)).toBe(false);
      expect(isExpired(day(d), addDays(d, 1))).toBe(true);
      expect(isExpired(day(d), addDays(d, -1))).toBe(false);
      expect(daysToExpiry(day(d), d)).toBe(0);
      expect(daysToExpiry(day(d), addDays(d, 1))).toBe(-1);
    }
  });

  it('daysToExpiry matches generated offsets across year ends and leap days', () => {
    for (const start of ['2027-12-20', '2028-02-20', '2026-10-27']) {
      for (let n = -400; n <= 400; n += 7) {
        expect(daysToExpiry(day(addDays(start, n)), start)).toBe(n);
      }
    }
  });

  it('utcToday uses the UTC calendar day', () => {
    expect(utcToday(new Date('2027-03-01T00:30:00+03:00'))).toBe('2027-02-28');
    expect(utcToday(new Date('2027-12-31T23:59:59.999Z'))).toBe('2027-12-31');
  });
});

describe('expiryBand', () => {
  it('DAY bands are inclusive at 30, 60, 90 and 180 days', () => {
    const today = '2027-01-01';
    const band = (n: number) => expiryBand(day(addDays(today, n)), today);
    expect(band(-1)).toBe('expired');
    expect(band(0)).toBe('d30');
    expect(band(30)).toBe('d30');
    expect(band(31)).toBe('d60');
    expect(band(60)).toBe('d60');
    expect(band(61)).toBe('d90');
    expect(band(90)).toBe('d90');
    expect(band(91)).toBe('d180');
    expect(band(180)).toBe('d180');
    expect(band(181)).toBe('ok');
  });

  it('a DAY band never gets worse as the expiry moves later (monotone)', () => {
    const order = ['expired', 'd30', 'd60', 'd90', 'd180', 'ok'];
    let last = 0;
    for (let n = -40; n <= 400; n++) {
      const idx = order.indexOf(expiryBand(day(addDays('2027-01-15', n)), '2027-01-15'));
      expect(idx).toBeGreaterThanOrEqual(last);
      last = idx;
    }
  });

  it('a MONTH band is never later than the same stored date with DAY precision', () => {
    const order = ['expired', 'd30', 'd60', 'd90', 'd180', 'ok'];
    for (let n = -40; n <= 400; n += 3) {
      const today = addDays('2027-01-15', n);
      for (const date of ['2027-03-31', '2027-06-30', '2028-02-29']) {
        const m = order.indexOf(expiryBand({ expiryDate: date, expiryPrecision: 'MONTH' }, today));
        const d = order.indexOf(expiryBand(day(date), today));
        expect(m).toBeLessThanOrEqual(d);
      }
    }
  });

  it('MONTH precision alerts from the start of the last month but sells to its end', () => {
    const march = { expiryDate: '2027-03-31', expiryPrecision: 'MONTH' as const };
    expect(expiryBand(march, '2027-03-01')).toBe('d30');
    expect(isExpired(march, '2027-03-01')).toBe(false);
    expect(expiryBand(march, '2027-03-31')).toBe('d30');
    expect(isExpired(march, '2027-03-31')).toBe(false);
    expect(expiryBand(march, '2027-04-01')).toBe('expired');
    // counted from 1 March, not 31 March
    expect(expiryBand(march, '2027-01-30')).toBe('d30');
    expect(expiryBand(march, '2027-01-29')).toBe('d60');
    expect(expiryBand(day('2027-03-31'), '2027-01-30')).toBe('d60');
  });

  it('MONTH february in a leap year', () => {
    const feb = { expiryDate: '2028-02-29', expiryPrecision: 'MONTH' as const };
    expect(expiryBand(feb, '2028-01-02')).toBe('d30');
    expect(expiryBand(feb, '2028-02-29')).toBe('d30');
    expect(expiryBand(feb, '2028-03-01')).toBe('expired');
  });
});
