import { describe, expect, it } from 'vitest';
import { offerPerUnit, tillOfferFor, tillOfferPerUnit, type TillOffer } from '@/server/domain/pos/line-offer';
import { computeTotals, lineDiscount, lineTotal } from '@/server/domain/pos/totals';

const WEEK = 0b1111111;
const offer = (over: Partial<TillOffer> = {}): TillOffer => ({
  id: 'o1',
  percentOff: 20,
  productIds: ['burger'],
  categoryIds: [],
  startsOn: null,
  endsOn: null,
  startMinute: null,
  endMinute: null,
  daysOfWeek: WEEK,
  roundTo: 250,
  ...over,
});
const burger = { id: 'burger', categoryId: 'mains' };
const cola = { id: 'cola', categoryId: 'drinks' };
// 2026-10-27 is a Tuesday; Baghdad is UTC+3, so 09:00Z is noon there.
const noon = new Date('2026-10-27T09:00:00Z');
const TZ = 'Asia/Baghdad';

describe('tillOfferFor (the live offers a till line gets)', () => {
  it('names the dish', () => {
    expect(tillOfferFor(burger, [offer()], noon, TZ)).toEqual({ percent: 20, roundTo: 250 });
  });

  it('names the dish through its category', () => {
    expect(tillOfferFor(burger, [offer({ productIds: [], categoryIds: ['mains'] })], noon, TZ)).toEqual({ percent: 20, roundTo: 250 });
  });

  it('gives nothing to a dish no offer names', () => {
    expect(tillOfferFor(cola, [offer()], noon, TZ)).toBeNull();
  });

  it('takes the largest of two live offers', () => {
    const best = tillOfferFor(burger, [offer({ percentOff: 10 }), offer({ id: 'o2', percentOff: 30, productIds: [], categoryIds: ['mains'] })], noon, TZ);
    expect(best?.percent).toBe(30);
  });

  it('ignores an offer that is not live: wrong day, ended, outside its daily window', () => {
    const wednesdayOnly = offer({ daysOfWeek: 1 << 2 });
    const ended = offer({ endsOn: '2026-10-26' });
    const evening = offer({ startMinute: 18 * 60, endMinute: 23 * 60 });
    for (const o of [wednesdayOnly, ended, evening]) expect(tillOfferFor(burger, [o], noon, TZ)).toBeNull();
  });

  it('reads the daily window in the menu time zone, not the server one', () => {
    const lunch = offer({ startMinute: 11 * 60, endMinute: 14 * 60 });
    expect(tillOfferFor(burger, [lunch], new Date('2026-10-27T09:00:00Z'), TZ)).not.toBeNull();
    expect(tillOfferFor(burger, [lunch], new Date('2026-10-27T11:30:00Z'), TZ)).toBeNull();
  });
});

describe('offerPerUnit', () => {
  it('is what the sale price takes off the whole unit, options and size included', () => {
    // 5,000 + 1,000 (size) + 500 (option) = 6,500; 20% off = 5,200, rounded to the 250 step = 5,250
    expect(offerPerUnit(6500, { percent: 20, roundTo: 250 })).toBe(1250);
  });

  it('rounds the sale price to the menu step, like the menu does', () => {
    // 4,100 less 15% = 3,485 -> 3,500 at a 250 step
    expect(offerPerUnit(4100, { percent: 15, roundTo: 250 })).toBe(600);
  });

  it('never takes the whole discount away when rounding (a live offer always lowers the price)', () => {
    expect(offerPerUnit(1000, { percent: 5, roundTo: 1000 })).toBe(50);
  });

  it('is zero without an offer', () => {
    expect(offerPerUnit(5000, null)).toBe(0);
  });

  it('agrees with tillOfferPerUnit end to end', () => {
    expect(tillOfferPerUnit(burger, 5000, [offer()], noon, TZ)).toBe(1000);
    expect(tillOfferPerUnit(cola, 5000, [offer()], noon, TZ)).toBe(0);
  });
});

describe('the offer in the money rules', () => {
  const line = { unitPrice: 5000, optionsTotal: 1000, quantity: 3, promoPerUnit: 1200 };

  it('is part of the line discount and comes off the line total', () => {
    expect(lineDiscount(line)).toBe(3600);
    expect(lineTotal(line)).toBe(18000 - 3600);
  });

  it('a manual percent discount applies to the already-discounted price (no double count)', () => {
    // gross 18,000; offer 3,600; 10% of the remaining 14,400 = 1,440
    const both = { ...line, discount: { kind: 'PERCENT' as const, value: 10 } };
    expect(lineDiscount(both)).toBe(3600 + 1440);
    expect(lineTotal(both)).toBe(18000 - 3600 - 1440);
  });

  it('a manual amount discount is capped by what is left after the offer', () => {
    const both = { ...line, discount: { kind: 'AMOUNT' as const, value: 99999 } };
    expect(lineTotal(both)).toBe(0);
    expect(lineDiscount(both)).toBe(18000);
  });

  it('follows the quantity', () => {
    expect(lineDiscount({ ...line, quantity: 1 })).toBe(1200);
  });

  it('is clamped to the gross when an option was removed after the offer was frozen', () => {
    expect(lineTotal({ unitPrice: 500, optionsTotal: 0, quantity: 1, promoPerUnit: 900 })).toBe(0);
  });

  it('no offer leaves every old line as it was', () => {
    expect(lineTotal({ unitPrice: 5000, optionsTotal: 0, quantity: 2, discount: { kind: 'PERCENT', value: 10 } })).toBe(9000);
  });

  it('feeds the order subtotal', () => {
    const totals = computeTotals([line, { unitPrice: 2000, optionsTotal: 0, quantity: 1 }], undefined, { serviceRatePercent: 0, taxRatePercent: 0 });
    expect(totals.subtotal).toBe(14400 + 2000);
  });
});
