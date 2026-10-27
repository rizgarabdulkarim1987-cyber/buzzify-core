import { localClock } from './schedule';
import type { Catalog, CatalogProduct, CatalogPromotion } from './types';

/**
 * Timed offers (docs/superpowers/specs/2026-10-18-sales-tools-design.md, 6.2): which are live at a moment, the discount
 * a dish gets, and what it then costs. Everything is read in the menu's own time zone. Weekday bits number days from
 * Monday (bit 0), as the daypart schedule does.
 */

/** The local date `YYYY-MM-DD` in `timeZone`. */
export function localDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** The date before a `YYYY-MM-DD` date. */
function dayBefore(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

/** The part of an offer that says when it runs: the till's copy of an offer carries only this. */
export type OfferWindow = Pick<CatalogPromotion, 'daysOfWeek' | 'startsOn' | 'endsOn' | 'startMinute' | 'endMinute'>;

const onDay = (mask: number, day: number) => (mask & (1 << day)) !== 0;

/** Whether the offer runs on that weekday and date (its dates are inclusive and either may be open). */
function runsOn(offer: OfferWindow, day: number, date: string): boolean {
  return (
    onDay(offer.daysOfWeek, day) &&
    (offer.startsOn === null || date >= offer.startsOn) &&
    (offer.endsOn === null || date <= offer.endsOn)
  );
}

/**
 * Whether the offer is live at `now`. Without a daily window it runs all day on its days. A window whose end is not
 * after its start wraps past midnight, and its hours after midnight belong to the day, and the date, it started on.
 */
export function isOfferLive(offer: OfferWindow, now: Date, timeZone: string): boolean {
  const { day, minute } = localClock(now, timeZone);
  const date = localDate(now, timeZone);
  const { startMinute: start, endMinute: end } = offer;
  if (start === null || end === null) return runsOn(offer, day, date);
  if (start < end) return minute >= start && minute < end && runsOn(offer, day, date);
  if (minute >= start) return runsOn(offer, day, date);
  if (minute < end) return runsOn(offer, (day + 6) % 7, dayBefore(date));
  return false;
}

/** The menu's offers live at `now`, in their order. */
export function liveOffers(catalog: Catalog, now: Date): CatalogPromotion[] {
  return catalog.promotions.filter((offer) => isOfferLive(offer, now, catalog.timeZone));
}

const names = (offer: Pick<CatalogPromotion, 'productIds' | 'categoryIds'>, product: Pick<CatalogProduct, 'id' | 'categoryId'>) =>
  offer.productIds.includes(product.id) || offer.categoryIds.includes(product.categoryId);

/** The largest live discount that names the dish or its category, with the step its price rounds to. */
export function discountFor(product: Pick<CatalogProduct, 'id' | 'categoryId'>, live: readonly CatalogPromotion[]): { percent: number; roundTo: number } | null {
  let best: { percent: number; roundTo: number } | null = null;
  for (const offer of live) {
    if (offer.kind !== 'DISCOUNT' || offer.percentOff === null || !names(offer, product)) continue;
    if (best === null || offer.percentOff > best.percent) best = { percent: offer.percentOff, roundTo: offer.roundTo };
  }
  return best;
}

/** The first live special that names the dish or its category. */
export function specialFor(product: CatalogProduct, live: readonly CatalogPromotion[]): CatalogPromotion | null {
  return live.find((offer) => offer.kind === 'SPECIAL' && names(offer, product)) ?? null;
}

/**
 * A regular price with `percent` off, rounded to the nearest `roundTo` (the menu's price step). When that rounding would
 * take the whole discount away (back to the regular price), or the step is larger than the sale price itself, it rounds
 * to the currency's minor unit instead: a live discount always lowers the price it advertises.
 */
export function salePrice(regular: number, percent: number, roundTo: number): number {
  const raw = (regular * (100 - percent)) / 100;
  const step = roundTo > 0 ? roundTo : 1;
  const stepped = Math.round(raw / step) * step;
  const price = (stepped === 0 && raw > 0) || (stepped >= regular && raw < regular) ? Math.round(raw) : stepped;
  return Math.min(regular, Math.max(0, price));
}
