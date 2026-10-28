/** A sale opens the cash drawer when any part of it was paid in cash or in dollars; a card-only sale never does. */
export function drawerShouldKick(legs: readonly { method: string }[]): boolean {
  return legs.some((leg) => leg.method === 'CASH' || leg.method === 'CASH_USD');
}
