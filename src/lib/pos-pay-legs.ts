/** What the pay dialog does with the amounts typed per method (pure, so the rules are tested without a screen). */

/** The text typed in each method's amount field; a missing or empty field means the method is not used. */
export type LegAmounts = Partial<Record<string, string>>;

export interface DialogLeg {
  method: string;
  amount: number;
  tendered?: number;
  reference?: string;
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

/** The legs to send: unused methods dropped, cash carrying the cash handed over, others their reference. */
export function toLegs(amounts: LegAmounts, references: Partial<Record<string, string>>, cashTendered: number): DialogLeg[] {
  return used(amounts).map(([method, amount]) => {
    if (method === 'CASH') return { method, amount, tendered: cashTendered };
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
