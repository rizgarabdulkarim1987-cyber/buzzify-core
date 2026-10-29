/**
 * The rules of the order and view counts on dish cards (docs/superpowers/specs/2026-10-30-menu-dish-counts-design.md):
 * which visits count as a view, and when a dish may show its numbers. Pure, so the ingest and the menu share one answer.
 */

/** Views one address (a salted hash, never the raw IP) may add to one dish in one day: a shared café Wi-Fi is not punished, a cleared browser cannot inflate. */
export const VIEW_IP_LIMIT = 3;

const NOT_A_GUEST = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|headless|lighthouse/i;

/** False for a missing user agent, and for bots, crawlers and link-preview fetchers: they open dishes but are not guests. */
export function isCountableAgent(userAgent: string | null): boolean {
  if (userAgent === null || userAgent.trim() === '') return false;
  return !NOT_A_GUEST.test(userAgent);
}

/** Whether a dish opening adds a view: this device has not counted for the dish today and its address is under the limit. */
export function viewCounts(input: { deviceSeen: boolean; addressViews: number }): boolean {
  return !input.deviceSeen && input.addressViews < VIEW_IP_LIMIT;
}

/** A dish shows its numbers only from its first paid order. */
export function showsCounts(orders: number): boolean {
  return orders > 0;
}
