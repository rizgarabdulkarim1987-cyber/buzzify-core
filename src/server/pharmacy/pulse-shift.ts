/** One figure of the shift line: how many and how much (minor units as text). */
export interface ShiftFigure {
  count: number;
  amountMinor: string;
}

/** The cashier's footer line (the prototype's "الوردية — نقدي (n) X · آجل (n) X · بطاقة (n) X · مرتجعات (n) -X"). */
export interface ShiftLine {
  cash: ShiftFigure;
  credit: ShiftFigure;
  card: ShiftFigure;
  transfer: ShiftFigure;
  returns: ShiftFigure;
}

/** The part of `ShiftTotals` (shifts-reads) the line is read from. */
export interface ShiftLineSource {
  cash: { tenderedMinor: string; changeMinor: string };
  payments: { method: string; count: number; amountMinor: string }[];
  returns: { count: number; refundMinor: string };
}

/**
 * The shift line, pure, from the shift's live totals: cash is what was tendered in cash minus the change handed back (what the cash
 * sales took), credit what went on customers' accounts, card and transfer as recorded by hand, returns their count and value. The
 * counts are payments (a credit sale paid partly in cash counts once under each). Null without an open shift.
 */
export function shiftLineOf(totals: ShiftLineSource | undefined | null): ShiftLine | null {
  if (!totals) return null;
  const of = (method: string): ShiftFigure => {
    const row = totals.payments.find((p) => p.method === method);
    return { count: row?.count ?? 0, amountMinor: row?.amountMinor ?? '0' };
  };
  const cash = of('CASH');
  return {
    cash: { count: cash.count, amountMinor: String(BigInt(totals.cash.tenderedMinor) - BigInt(totals.cash.changeMinor)) },
    credit: of('CREDIT'),
    card: of('CARD_MANUAL'),
    transfer: of('TRANSFER_MANUAL'),
    returns: { count: totals.returns.count, amountMinor: totals.returns.refundMinor },
  };
}
