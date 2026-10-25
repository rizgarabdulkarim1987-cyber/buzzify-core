/**
 * The rules of a guest's QR order, as pure data and functions: how much a table, a restaurant and an address may send,
 * and when a waiting request stops counting.
 */

export const QR_LIMITS = {
  /** Requests of one table waiting for the cashier at the same time. */
  pendingPerTable: 3,
  /** Requests one table may send in any ten minutes, decided or not. */
  perTablePer10Min: 5,
  /** Requests one restaurant may receive in any hour. */
  perRestaurantPerHour: 300,
  /** Submissions one address may make to one restaurant in a minute. */
  perIpPerMinute: 10,
  maxLines: 30,
  maxQuantity: 20,
  maxNote: 300,
  /** A request nobody decided stops counting after this long. */
  expiryMinutes: 60,
} as const;

const MINUTE = 60_000;

/** The time before which a waiting request has expired. */
export function expiryCutoff(now: Date): Date {
  return new Date(now.getTime() - QR_LIMITS.expiryMinutes * MINUTE);
}

/** A waiting request is expired from its sixtieth minute on. */
export function isExpired(createdAt: Date, now: Date): boolean {
  return createdAt.getTime() <= expiryCutoff(now).getTime();
}

/** What the Menu's promotions took off one unit: the price with the chosen options minus the price the guest was quoted. */
export function promoDiscountPerUnit(base: number, optionsTotal: number, quotedUnit: number): number {
  return Math.max(0, base + optionsTotal - quotedUnit);
}
