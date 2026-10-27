import type { AnyDb } from '@/server/data/tenant-db';
import { entitlementsFor } from '@/server/data/plans';
import { menuPriceStep } from '@/server/domain/bulk-prices';
import { allows } from '@/server/domain/entitlements';
import type { TillOffer } from '@/server/domain/pos/line-offer';

/**
 * The menu's DISCOUNT offers as the till prices with them (docs/superpowers/specs/2026-10-27-pos-menu-offers-design.md):
 * the active promotions of the catalog menu's draft rows, the same rows the till's prices come from, and none when the
 * restaurant's plan does not include timed offers (the gate `servedCatalog` applies for guests).
 */
export interface TillOffers {
  timeZone: string;
  offers: TillOffer[];
}

export async function loadTillOffers(db: AnyDb, restaurantId: string, menuId: string): Promise<TillOffers> {
  const menu = await db.menu.findFirst({ where: { id: menuId, restaurantId }, select: { timezone: true, currency: true, priceStep: true } });
  if (!menu) return { timeZone: 'UTC', offers: [] };
  const empty: TillOffers = { timeZone: menu.timezone, offers: [] };
  if (!allows(await entitlementsFor(db, restaurantId), 'selling.offers')) return empty;
  const rows = await db.promotion.findMany({ where: { menuId, isActive: true, kind: 'DISCOUNT', percentOff: { not: null } }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
  const roundTo = menuPriceStep(menu);
  const offers: TillOffer[] = [];
  for (const row of rows) {
    if (row.percentOff === null) continue;
    offers.push({
      id: row.id,
      percentOff: row.percentOff,
      productIds: row.productIds,
      categoryIds: row.categoryIds,
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      startMinute: row.startMinute,
      endMinute: row.endMinute,
      daysOfWeek: row.daysOfWeek,
      roundTo,
    });
  }
  return { timeZone: menu.timezone, offers };
}

/** How far back a till device's clock is trusted when it replays a line it added offline. */
export const OFFLINE_PRICING_WINDOW_MS = 12 * 60 * 60_000;

/**
 * The moment a line is priced at: the time the cashier tapped the dish on the device (`clientAt`) when that is within
 * the last 12 hours and not in the future, else `now`. An offer that ended while the device was offline is still honoured
 * for the lines tapped while it ran, and a wrong clock cannot reach back further than a shift.
 */
export function pricingMoment(clientAt: Date | undefined, now: Date): Date {
  if (!clientAt || Number.isNaN(clientAt.getTime())) return now;
  const age = now.getTime() - clientAt.getTime();
  return age >= 0 && age <= OFFLINE_PRICING_WINDOW_MS ? clientAt : now;
}
