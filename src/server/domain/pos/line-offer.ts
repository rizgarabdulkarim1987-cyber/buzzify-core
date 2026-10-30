import { isOfferLive, salePrice, type OfferWindow } from '@/server/domain/offers';
import type { CatalogProduct, CatalogPromotion } from '@/server/domain/types';

/**
 * The menu's timed discounts at the till (docs/superpowers/specs/2026-10-27-pos-menu-offers-design.md). Pure, so the
 * server that prices a line and the offline device that previews it read the same rule.
 */

/** The part of a DISCOUNT offer the till needs: who it names, how much it takes off, and when it runs. */
export type TillOffer = OfferWindow & Pick<CatalogPromotion, 'id' | 'percentOff' | 'productIds' | 'categoryIds' | 'roundTo'> & { percentOff: number };

/** The DISCOUNT offers of a menu's promotions, in the shape the till keeps. */
export function tillOffersOf(promotions: readonly CatalogPromotion[]): TillOffer[] {
  const offers: TillOffer[] = [];
  for (const p of promotions) {
    if (p.kind !== 'DISCOUNT' || p.percentOff === null) continue;
    offers.push({
      id: p.id,
      percentOff: p.percentOff,
      productIds: p.productIds,
      categoryIds: p.categoryIds,
      startsOn: p.startsOn,
      endsOn: p.endsOn,
      startMinute: p.startMinute,
      endMinute: p.endMinute,
      daysOfWeek: p.daysOfWeek,
      roundTo: p.roundTo,
    });
  }
  return offers;
}

export interface LineOffer {
  percent: number;
  roundTo: number;
}

/** The largest offer live at `now` (in `timeZone`) that names the dish or its category, as the menu shows it. */
export function tillOfferFor(
  product: Pick<CatalogProduct, 'id' | 'categoryId'>,
  offers: readonly TillOffer[],
  now: Date,
  timeZone: string,
): LineOffer | null {
  let best: LineOffer | null = null;
  for (const offer of offers) {
    if (!offer.productIds.includes(product.id) && !offer.categoryIds.includes(product.categoryId)) continue;
    if (!isOfferLive(offer, now, timeZone)) continue;
    if (best === null || offer.percentOff > best.percent) best = { percent: offer.percentOff, roundTo: offer.roundTo };
  }
  return best;
}

/** What the offer takes off one unit whose regular price (size and options included) is `unitRegular`, in whole IQD. */
export function offerPerUnit(unitRegular: number, offer: LineOffer | null): number {
  if (!offer || unitRegular <= 0) return 0;
  return Math.max(0, unitRegular - salePrice(unitRegular, offer.percent, offer.roundTo));
}

/** The same in one step: the live offer for the dish applied to a unit price. */
export function tillOfferPerUnit(
  product: Pick<CatalogProduct, 'id' | 'categoryId'>,
  unitRegular: number,
  offers: readonly TillOffer[],
  now: Date,
  timeZone: string,
): number {
  return offerPerUnit(unitRegular, tillOfferFor(product, offers, now, timeZone));
}
