import { describe, expect, it } from 'vitest';
import { priceOf } from '@/server/domain/catalog';
import { discountFor, isOfferLive, liveOffers, salePrice, specialFor } from '@/server/domain/offers';
import type { CatalogPromotion } from '@/server/domain/types';
import { at, IDS, makeCatalog } from './fixtures';

const TZ = 'Asia/Baghdad';
/** Weekday bits as the daypart schedule numbers them: Monday is bit 0, so Thursday is bit 3. */
const THURSDAY = 1 << 3;
const FRIDAY = 1 << 4;

function offer(overrides: Partial<CatalogPromotion> = {}): CatalogPromotion {
  return {
    id: 'o-1',
    kind: 'DISCOUNT',
    percentOff: 20,
    productIds: [IDS.burger],
    categoryIds: [],
    startsOn: null,
    endsOn: null,
    startMinute: null,
    endMinute: null,
    daysOfWeek: 127,
    roundTo: 5,
    translations: { en: { title: 'Offer' } },
    sortOrder: 0,
    ...overrides,
  };
}

const catalog = makeCatalog();
const burger = catalog.products.find((p) => p.id === IDS.burger)!;
const espresso = catalog.products.find((p) => p.id === IDS.espresso)!;

describe('isOfferLive', () => {
  it('a happy hour 17:00 to 19:00 is live at 18:00 and not at 19:00', () => {
    const happyHour = offer({ startMinute: 17 * 60, endMinute: 19 * 60 });
    expect(isOfferLive(happyHour, at(16, 59), TZ)).toBe(false);
    expect(isOfferLive(happyHour, at(18), TZ)).toBe(true);
    expect(isOfferLive(happyHour, at(19), TZ)).toBe(false);
  });

  it('a 22:00 to 02:00 offer on Thursdays is live on Friday at 01:00 and not on Thursday at 01:00', () => {
    const late = offer({ startMinute: 22 * 60, endMinute: 2 * 60, daysOfWeek: THURSDAY });
    expect(isOfferLive(late, at(23), TZ)).toBe(true);
    // Friday 01:00 is still the Thursday night.
    expect(isOfferLive(late, at(25), TZ)).toBe(true);
    // Thursday 01:00 belongs to the Wednesday night.
    expect(isOfferLive(late, at(1), TZ)).toBe(false);
    expect(isOfferLive(late, at(26), TZ)).toBe(false);
  });

  it('reads its dates in the menu time zone, both ends included', () => {
    const oneDay = offer({ startsOn: '2026-10-15', endsOn: '2026-10-15' });
    expect(isOfferLive(oneDay, at(0, 30), TZ)).toBe(true);
    expect(isOfferLive(oneDay, at(23, 59), TZ)).toBe(true);
    expect(isOfferLive(oneDay, at(24), TZ)).toBe(false);
    expect(isOfferLive(offer({ endsOn: '2026-10-14' }), at(12), TZ)).toBe(false);
    expect(isOfferLive(offer({ startsOn: '2026-10-16' }), at(12), TZ)).toBe(false);
  });

  it('counts the hours after midnight toward the date the night started', () => {
    const lastNight = offer({ startMinute: 22 * 60, endMinute: 2 * 60, endsOn: '2026-10-15' });
    expect(isOfferLive(lastNight, at(25), TZ)).toBe(true);
    expect(isOfferLive(lastNight, at(24 + 23), TZ)).toBe(false);
  });

  it('numbers weekdays from Monday, as the daypart schedule does', () => {
    expect(isOfferLive(offer({ daysOfWeek: THURSDAY }), at(12), TZ)).toBe(true);
    expect(isOfferLive(offer({ daysOfWeek: FRIDAY }), at(12), TZ)).toBe(false);
  });
});

describe('liveOffers', () => {
  it('keeps the live offers in their order', () => {
    const promotions = [offer({ id: 'a' }), offer({ id: 'b', endsOn: '2026-10-01' }), offer({ id: 'c', kind: 'SPECIAL', percentOff: null })];
    expect(liveOffers(makeCatalog({ promotions }), at(12)).map((o) => o.id)).toEqual(['a', 'c']);
  });
});

describe('discountFor', () => {
  it('takes the largest live discount, and a category discount reaches its dishes', () => {
    const live = [
      offer({ percentOff: 10 }),
      offer({ id: 'o-2', percentOff: 25, productIds: [], categoryIds: [burger.categoryId], roundTo: 250 }),
      offer({ id: 'o-3', kind: 'SPECIAL', percentOff: null }),
    ];
    expect(discountFor(burger, live)).toEqual({ percent: 25, roundTo: 250 });
    expect(discountFor(espresso, live)).toBeNull();
  });
});

describe('specialFor', () => {
  it('names the first special of a dish and ignores discounts', () => {
    const live = [offer(), offer({ id: 's-1', kind: 'SPECIAL', percentOff: null }), offer({ id: 's-2', kind: 'SPECIAL', percentOff: null })];
    expect(specialFor(burger, live)?.id).toBe('s-1');
    expect(specialFor(espresso, live)).toBeNull();
  });
});

describe('salePrice', () => {
  it('rounds to the step of the menu and never goes above the regular price', () => {
    expect(salePrice(1250, 20, 250)).toBe(1000);
    expect(salePrice(300, 15, 5)).toBe(255);
    expect(salePrice(12_250, 15, 250)).toBe(10_500);
    expect(salePrice(1000, 5, 250)).toBe(1000);
  });

  it('falls back to minor units when the step is larger than the sale price', () => {
    expect(salePrice(30, 50, 250)).toBe(15);
    expect(salePrice(0, 50, 5)).toBe(0);
  });
});

describe('priceOf', () => {
  it('gives the sale price, the regular price and the cost', () => {
    expect(priceOf(burger, null, [], [offer()])).toEqual({ price: 720, regular: 900, cost: 310 });
    expect(priceOf(burger, null, [], [])).toEqual({ price: 900, regular: 900, cost: 310 });
    expect(priceOf(espresso, null, [], [offer()])).toEqual({ price: 300, regular: 300, cost: 45 });
  });
});
