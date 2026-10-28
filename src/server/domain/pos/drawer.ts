/** A sale opens the cash drawer when any part of it was paid in cash or in dollars; a card-only sale never does. */
export function drawerShouldKick(legs: readonly { method: string }[]): boolean {
  return legs.some((leg) => leg.method === 'CASH' || leg.method === 'CASH_USD');
}

/** What one print of a receipt does: a copy never opens the drawer; an original does when the sale took cash. Retrying a failed print repeats the same kind. */
export function receiptPrintOptions(copy: boolean, legs: readonly { method: string }[]): { copy: boolean; drawer: boolean } {
  return { copy, drawer: !copy && drawerShouldKick(legs) };
}

/** A refund hands cash back from the drawer, so it opens when any part of the payment being reversed was cash or dollars, whichever leg was larger. */
export function refundOpensDrawer(legs: readonly { method: string }[]): boolean {
  return drawerShouldKick(legs);
}
