import { usdChange, usdNeeded } from '@/server/domain/pos/usd';

/** What the pay dialog does with the amounts typed per method (pure, so the rules are tested without a screen). */

/** The text typed in each method's amount field; a missing or empty field means the method is not used. */
export type LegAmounts = Partial<Record<string, string>>;

export interface DialogLeg {
  method: string;
  amount: number;
  tendered?: number;
  reference?: string;
  tenderedUsd?: number;
  rate?: number;
}

const used = (amounts: LegAmounts): [string, number][] =>
  Object.entries(amounts)
    .map(([method, text]): [string, number] => [method, Number(text ?? '') || 0])
    .filter(([, amount]) => amount > 0);

/** What is still to pay: negative when the amounts go over the bill. */
export function remaining(total: number, amounts: LegAmounts): number {
  return total - used(amounts).reduce((sum, [, amount]) => sum + amount, 0);
}

/** The amounts add up to the bill exactly, so the payment can be taken. */
export function legsReady(total: number, amounts: LegAmounts): boolean {
  return used(amounts).length > 0 && remaining(total, amounts) === 0;
}

/** The whole dollars to take for `amount` dinars at `rate`; null when there is no rate (dollars cannot be taken). */
export function usdDue(amount: number, rate: number): number | null {
  return rate > 0 ? usdNeeded(amount, rate) : null;
}

/** The dinars to give back for the dollars handed over; never negative. */
export const usdBack = usdChange;

/**
 * What reversing a payment hands back for its dollar legs: the dollars the guest handed over go back as dollars, and the dinar
 * change they were given comes back into the dinar drawer (the exact opposite of the sale, as the drawer counts it). Null when
 * the payment took no dollars, or is an old leg stored without them.
 */
export function usdRefund(legs: readonly { method: string; amount: number; tenderedUsd?: number | null; rate?: number | null }[]): { dollars: number; dinarChange: number } | null {
  const usd = legs.filter((leg) => leg.method === 'CASH_USD' && (leg.tenderedUsd ?? 0) > 0);
  if (usd.length === 0) return null;
  return {
    dollars: usd.reduce((sum, leg) => sum + (leg.tenderedUsd ?? 0), 0),
    dinarChange: usd.reduce((sum, leg) => sum + usdChange(leg.tenderedUsd ?? 0, leg.rate ?? 0, leg.amount), 0),
  };
}

/** A reversal is done on a terminal (and only recorded here) unless the payment was cash, in dinars or in dollars. */
export function refundIsTerminal(method: string): boolean {
  return method !== 'CASH' && method !== 'CASH_USD';
}

const USD_NOTES = [10, 20, 50, 100] as const;

/** Quick buttons for the dollars handed over: the exact dollars, then the dollar notes above them, each once. */
export function usdQuick(due: number): number[] {
  if (due <= 0) return [];
  return [due, ...USD_NOTES.filter((note) => note > due)];
}

/** The legs to send: unused methods dropped, cash carrying the cash handed over, dollars the dollars and the rate, others their reference. */
export function toLegs(amounts: LegAmounts, references: Partial<Record<string, string>>, cashTendered: number, usd?: { dollars: number; rate: number }): DialogLeg[] {
  return used(amounts).map(([method, amount]) => {
    if (method === 'CASH') return { method, amount, tendered: cashTendered };
    if (method === 'CASH_USD' && usd) return { method, amount, tenderedUsd: usd.dollars, rate: usd.rate };
    const reference = references[method]?.trim();
    return reference ? { method, amount, reference } : { method, amount };
  });
}

/** Change to give back from the cash handed over, after the cash part of the bill and a tip paid in cash. */
export function cashChange(args: { cash: number; cashTip: number; tendered: number }): number {
  return args.tendered - args.cash - args.cashTip;
}

/** A quick tip button: a percent of the bill. */
export function tipPreset(total: number, percent: number): number {
  return Math.round((total * percent) / 100);
}
